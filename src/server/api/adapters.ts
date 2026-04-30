/**
 * Adapters API — IM Adapter 配置读写
 *
 * GET  /api/adapters  → 返回配置（敏感字段脱敏）
 * PUT  /api/adapters  → 更新配置（浅合并），返回更新后的脱敏配置
 */

import { adapterService } from '../services/adapterService.js'
import { jarvisService } from '../services/jarvisService.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { parseAdapterWebhook, type AdapterInboundAction } from '../services/adapterWebhookParsers.js'
import { listJarvisQueue, updateJarvisQueueItem } from '../../jarvis/queue.js'

const ALLOWED_TOP_KEYS = new Set([
  'serverUrl',
  'defaultProjectDir',
  'telegram',
  'feishu',
  'dingtalk',
  'wecom',
  'pairing',
])

export async function handleAdaptersApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const action = segments[2]
    const channel = segments[3]

    if (req.method === 'GET') {
      const config = await adapterService.getConfig()
      return Response.json(config)
    }

    if (req.method === 'POST' && action === 'inbound') {
      return await handleInboundAdapterMessage(req, channel)
    }

    if (req.method === 'POST' && action === 'webhook') {
      return await handleNativeAdapterWebhook(req, channel)
    }

    if (req.method === 'PUT') {
      const body = (await req.json()) as Record<string, unknown>
      // Basic validation: only allow known top-level keys
      for (const key of Object.keys(body)) {
        if (!ALLOWED_TOP_KEYS.has(key)) {
          throw ApiError.badRequest(`Unknown config key: ${key}`)
        }
      }
      await adapterService.updateConfig(body)
      const config = await adapterService.getConfig()
      return Response.json(config)
    }

    throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
  } catch (error) {
    return errorResponse(error)
  }
}

type InboundMessageBody = {
  userId?: string | number
  displayName?: string
  text?: string
  projectDir?: string
  model?: string
  runNow?: boolean
  action?: AdapterInboundAction
}

async function handleNativeAdapterWebhook(
  req: Request,
  channel: string | undefined,
): Promise<Response> {
  if (!isInboundChannel(channel)) {
    throw ApiError.badRequest('channel must be telegram, feishu, dingtalk, or wecom')
  }
  const rawBody = await req.text()
  const config = await adapterService.getRawConfig()
  let parsed
  try {
    parsed = parseAdapterWebhook({
      channel,
      rawBody,
      headers: req.headers,
      config,
    })
  } catch (error) {
    throw new ApiError(401, error instanceof Error ? error.message : String(error), 'ADAPTER_SIGNATURE_INVALID')
  }
  return handleInboundAdapterPayload(channel, parsed)
}

async function handleInboundAdapterMessage(
  req: Request,
  channel: string | undefined,
): Promise<Response> {
  if (!isInboundChannel(channel)) {
    throw ApiError.badRequest('channel must be telegram, feishu, dingtalk, or wecom')
  }

  const body = (await req.json()) as InboundMessageBody
  return handleInboundAdapterPayload(channel, body)
}

async function handleInboundAdapterPayload(
  channel: 'telegram' | 'feishu' | 'dingtalk' | 'wecom',
  body: InboundMessageBody,
): Promise<Response> {
  const text = body.text?.trim()
  if (!text) throw ApiError.badRequest('text is required')
  await assertAdapterUserAllowed(channel, body.userId)

  if (body.action) {
    return handleInboundAdapterAction(channel, body)
  }

  const goal = [
    `IM source: ${channel}`,
    `User: ${body.displayName || body.userId || 'unknown'}`,
    body.projectDir ? `Preferred project: ${body.projectDir}` : '',
    '',
    text,
  ].filter(Boolean).join('\n')
  const status = await jarvisService.submitGoal(goal, 75)

  return Response.json({
    ok: true,
    channel,
    jarvis: true,
    status,
  }, { status: 202 })
}

async function handleInboundAdapterAction(
  channel: 'telegram' | 'feishu' | 'dingtalk' | 'wecom',
  body: InboundMessageBody,
): Promise<Response> {
  const action = body.action!
  if (action.type === 'status' || action.type === 'queue') {
    const items = await listJarvisQueue()
    return Response.json({
      ok: true,
      channel,
      action,
      queue: {
        pending: items.filter(item => item.status === 'pending').length,
        running: items.filter(item => item.status === 'running').length,
        paused: items.filter(item => item.status === 'paused').length,
        failed: items.filter(item => item.status === 'failed').length,
        completed: items.filter(item => item.status === 'completed').length,
      },
      items: action.type === 'queue' ? items.slice(0, 20) : undefined,
    })
  }

  if (action.type === 'checkpoint') {
    const items = await listJarvisQueue()
    const item = action.targetId
      ? items.find(entry => entry.id === action.targetId)
      : items.find(entry => entry.status === 'running' || entry.status === 'pending')
    return Response.json({
      ok: true,
      channel,
      action,
      checkpoint: item?.checkpoint ?? null,
      item,
    })
  }

  if (action.type === 'pause' || action.type === 'resume' || action.type === 'approve') {
    const items = await listJarvisQueue()
    const target = action.targetId
      ? items.find(entry => entry.id === action.targetId)
      : items.find(entry => entry.status === 'running' || entry.status === 'pending' || entry.status === 'paused')
    if (!target) throw ApiError.notFound('No Jarvis queue item found for action')
    const item = await updateJarvisQueueItem(target.id, {
      status: action.type === 'pause' ? 'paused' : 'pending',
      approvalState: action.type === 'approve' ? 'approved' : target.approvalState,
      checkpoint: `${action.type} requested from ${channel} by ${body.displayName || body.userId || 'user'}.`,
    })
    return Response.json({ ok: true, channel, action, item })
  }

  throw ApiError.badRequest('Unsupported adapter action')
}

function isInboundChannel(
  channel: string | undefined,
): channel is 'telegram' | 'feishu' | 'dingtalk' | 'wecom' {
  return channel === 'telegram' || channel === 'feishu' || channel === 'dingtalk' || channel === 'wecom'
}

async function assertAdapterUserAllowed(
  channel: 'telegram' | 'feishu' | 'dingtalk' | 'wecom',
  userId: string | number | undefined,
): Promise<void> {
  const config = await adapterService.getRawConfig()
  const section = config[channel]
  const allowed = section?.allowedUsers ?? []
  const paired = section?.pairedUsers ?? []
  if (allowed.length === 0 && paired.length === 0) return
  if (userId === undefined) throw ApiError.badRequest('userId is required')
  const normalized = String(userId)
  const allowedSet = new Set(allowed.map(String))
  const pairedSet = new Set(paired.map(user => String(user.userId)))
  if (!allowedSet.has(normalized) && !pairedSet.has(normalized)) {
    throw new ApiError(403, `User is not allowed for ${channel}`, 'ADAPTER_USER_DENIED')
  }
}

import { jarvisService } from '../services/jarvisService.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import type { JarvisModeConfig } from '../../jarvis/types.js'
import { getJarvisAutostartStatus, setJarvisAutostart } from '../../jarvis/autostart.js'
import {
  appendJarvisEvent,
  readJarvisConfig,
  updateJarvisCloudToken,
  updateJarvisConfig,
  verifyJarvisCloudToken,
} from '../../jarvis/store.js'
import {
  claimNextJarvisTask,
  enqueueJarvisTask,
  listJarvisQueue,
  updateJarvisQueueItem,
} from '../../jarvis/queue.js'

export async function handleJarvisApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const method = req.method
    const action = segments[2]

    if (method === 'GET' && !action) {
      return Response.json(await jarvisService.getStatus())
    }

    if (method === 'PUT' && action === 'config') {
      const body = (await parseJsonBody(req)) as Partial<JarvisModeConfig>
      return Response.json(await jarvisService.updateConfig(body))
    }

    if (method === 'POST' && action === 'start') {
      return Response.json(await jarvisService.updateConfig({ enabled: true }))
    }

    if (method === 'POST' && action === 'stop') {
      return Response.json(await jarvisService.updateConfig({ enabled: false }))
    }

    if (method === 'POST' && action === 'tick') {
      const event = await jarvisService.tick('manual')
      const status = await jarvisService.getStatus()
      return Response.json({ event, status })
    }

    if (method === 'POST' && action === 'task') {
      const body = await parseJsonBody(req)
      const goal = typeof body.goal === 'string'
        ? body.goal.trim()
        : typeof body.prompt === 'string'
          ? body.prompt.trim()
          : ''
      if (!goal) throw ApiError.badRequest('goal is required')
      const status = await jarvisService.submitGoal(
        goal,
        typeof body.priority === 'number' ? body.priority : undefined,
        isJarvisSource(body.source) ? body.source : 'web',
      )
      return Response.json({ status }, { status: 202 })
    }

    if (method === 'GET' && action === 'queue') {
      return Response.json({ items: await listJarvisQueue() })
    }

    if (method === 'POST' && action === 'queue') {
      const body = await parseJsonBody(req)
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
      if (!prompt) throw ApiError.badRequest('prompt is required')
      const status = await jarvisService.submitGoal(
        prompt,
        typeof body.priority === 'number' ? body.priority : undefined,
      )
      return Response.json({ status }, { status: 202 })
    }

    if (method === 'POST' && action === 'queue-action') {
      const body = await parseJsonBody(req)
      const id = typeof body.id === 'string' ? body.id : ''
      const queueAction = body.action
      if (!id || !['pause', 'resume', 'approve', 'checkpoint', 'delete'].includes(String(queueAction))) {
        throw ApiError.badRequest('id and action=pause|resume|approve|checkpoint|delete are required')
      }
      if (queueAction === 'delete') {
        const result = await jarvisService.deleteQueueItem(id)
        if (!result.item) throw ApiError.notFound(`Queue item not found: ${id}`)
        return Response.json(result)
      }
      if (queueAction === 'checkpoint') {
        const item = (await listJarvisQueue()).find(entry => entry.id === id)
        if (!item) throw ApiError.notFound(`Queue item not found: ${id}`)
        return Response.json({
          item,
          checkpoint: item.checkpoint ?? null,
          status: await jarvisService.getStatus(),
        })
      }
      if (queueAction === 'approve') {
        const currentStatus = await jarvisService.getStatus()
        const approval = currentStatus.approvals
          .find(entry => entry.taskId === id && entry.status === 'pending')
        if (approval) {
          const status = await jarvisService.resolveApproval(approval.id, 'approved')
          return Response.json({
            item: status.queueItems?.find(entry => entry.id === id) ?? null,
            status,
          })
        }
      }
      const patch = {
        status: queueAction === 'pause' ? 'paused' as const : 'pending' as const,
        checkpoint: `${queueAction} from API`,
        ...(queueAction === 'approve' ? { approvalState: 'approved' as const } : {}),
      }
      const item = await updateJarvisQueueItem(id, patch)
      if (!item) {
        throw ApiError.notFound(`Queue item not found: ${id}`)
      }
      if (queueAction === 'approve') {
        await appendJarvisEvent({
          type: 'approval',
          title: 'Jarvis task approved',
          message: `${item.title || item.id} approved from API.`,
        })
      }
      return Response.json({ item, status: await jarvisService.getStatus() })
    }

    if (method === 'POST' && action === 'approval') {
      const body = await parseJsonBody(req)
      const id = typeof body.id === 'string' ? body.id : ''
      const decision = String(body.decision || body.status || '')
      if (!id || (decision !== 'approved' && decision !== 'rejected')) {
        throw ApiError.badRequest('id and decision=approved|rejected are required')
      }
      const status = await jarvisService.resolveApproval(
        id,
        decision,
        typeof body.note === 'string' ? body.note : undefined,
      )
      return Response.json({ status })
    }

    if (method === 'GET' && action === 'autostart') {
      return Response.json(await getJarvisAutostartStatus())
    }

    if (method === 'PUT' && action === 'autostart') {
      const body = await parseJsonBody(req)
      return Response.json(await setJarvisAutostart(body.enabled === true))
    }

    if (method === 'GET' && action === 'cloud') {
      const config = await readJarvisConfig()
      return Response.json({ cloud: config.cloud })
    }

    if (method === 'PUT' && action === 'cloud') {
      const body = await parseJsonBody(req)
      const current = await readJarvisConfig()
      const cloud = {
        ...current.cloud,
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        ...(typeof body.endpoint === 'string' ? { endpoint: body.endpoint.trim() || undefined } : {}),
        ...(typeof body.runnerId === 'string' && body.runnerId.trim() ? { runnerId: body.runnerId.trim() } : {}),
        ...(typeof body.syncQueue === 'boolean' ? { syncQueue: body.syncQueue } : {}),
        ...(typeof body.heartbeatIntervalMs === 'number' ? { heartbeatIntervalMs: body.heartbeatIntervalMs } : {}),
      }
      if (typeof body.token === 'string') {
        await updateJarvisCloudToken(body.token)
        cloud.tokenSet = Boolean(body.token.trim())
      }
      const status = await jarvisService.updateConfig({ cloud })
      return Response.json({ cloud: status.cloud })
    }

    if (method === 'POST' && action === 'cloud-heartbeat') {
      await requireCloudAuth(req)
      const body = await parseJsonBody(req)
      const runnerId = typeof body.runnerId === 'string' ? body.runnerId : 'cloud-runner'
      const runnerStatus = typeof body.status === 'string' ? body.status : 'running'
      const current = await readJarvisConfig()
      await updateJarvisConfig({
        cloud: {
          ...current.cloud,
          lastHeartbeatAt: new Date().toISOString(),
          lastRunnerStatus: runnerStatus,
        },
      })
      const event = await appendJarvisEvent({
        type: 'heartbeat',
        title: 'Jarvis cloud runner heartbeat',
        message: `${runnerId}: ${runnerStatus}`,
      })
      return Response.json({ ok: true, event })
    }

    if (method === 'POST' && action === 'cloud-claim') {
      await requireCloudAuth(req)
      const item = await claimNextJarvisTask()
      return Response.json({ item })
    }

    if (method === 'POST' && action === 'cloud-report') {
      await requireCloudAuth(req)
      const body = await parseJsonBody(req)
      const id = typeof body.id === 'string' ? body.id : ''
      if (!id) throw ApiError.badRequest('id is required')
      const nextStatus = ['pending', 'running', 'paused', 'completed', 'failed'].includes(String(body.status))
        ? body.status as 'pending' | 'running' | 'paused' | 'completed' | 'failed'
        : undefined
      const item = await updateJarvisQueueItem(id, {
        ...(nextStatus ? { status: nextStatus } : {}),
        checkpoint: typeof body.checkpoint === 'string' ? body.checkpoint : undefined,
        error: typeof body.error === 'string' ? body.error : undefined,
        runId: typeof body.runId === 'string' ? body.runId : undefined,
      })
      if (!item) throw ApiError.notFound(`Queue item not found: ${id}`)
      await appendJarvisEvent({
        type: nextStatus === 'completed' ? 'checkpoint' : nextStatus === 'failed' ? 'error' : 'heartbeat',
        severity: nextStatus === 'failed' ? 'error' : 'info',
        title: 'Jarvis cloud runner report',
        message: `${item.id}: ${item.status}`,
      })
      return Response.json({ item })
    }

    throw new ApiError(
      405,
      `Method ${method} not allowed on /api/jarvis${action ? `/${action}` : ''}`,
      'METHOD_NOT_ALLOWED',
    )
  } catch (error) {
    return errorResponse(error)
  }
}

function isJarvisSource(value: unknown): value is 'desktop' | 'web' | 'cli' | 'telegram' | 'feishu' | 'dingtalk' | 'wecom' {
  return (
    value === 'desktop' ||
    value === 'web' ||
    value === 'cli' ||
    value === 'telegram' ||
    value === 'feishu' ||
    value === 'dingtalk' ||
    value === 'wecom'
  )
}

async function requireCloudAuth(req: Request): Promise<void> {
  if (!(await verifyJarvisCloudToken(req.headers.get('authorization')))) {
    throw new ApiError(401, 'Invalid Jarvis cloud runner token', 'UNAUTHORIZED')
  }
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

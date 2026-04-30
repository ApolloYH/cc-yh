import * as crypto from 'node:crypto'
import type { AdapterFileConfig } from './adapterService.js'

export type AdapterInboundAction =
  | { type: 'pause'; targetId?: string }
  | { type: 'resume'; targetId?: string }
  | { type: 'checkpoint'; targetId?: string }
  | { type: 'approve'; targetId?: string }
  | { type: 'status'; targetId?: string }
  | { type: 'queue'; targetId?: string }

export type ParsedAdapterInbound = {
  userId?: string | number
  displayName?: string
  text: string
  runNow?: boolean
  action?: AdapterInboundAction
}

export function parseAdapterWebhook(input: {
  channel: 'telegram' | 'feishu' | 'dingtalk' | 'wecom'
  rawBody: string
  headers: Headers
  config: AdapterFileConfig
}): ParsedAdapterInbound {
  verifyAdapterSignature(input)
  const body = input.rawBody ? JSON.parse(input.rawBody) as Record<string, unknown> : {}
  const parsed = parseByChannel(input.channel, body)
  return {
    ...parsed,
    runNow: typeof body.runNow === 'boolean' ? body.runNow : parsed.runNow,
    action: parseAdapterAction(parsed.text),
  }
}

export function parseAdapterAction(text: string): AdapterInboundAction | undefined {
  const trimmed = text.trim()
  const match = trimmed.match(/^\/(pause|resume|checkpoint|approve|status|queue)(?:\s+(\S+))?/i)
  if (!match) return undefined
  return {
    type: match[1]!.toLowerCase() as AdapterInboundAction['type'],
    targetId: match[2],
  }
}

export function verifyDingTalkSignature(params: {
  timestamp: string
  sign: string
  secret: string
}): boolean {
  const expected = crypto
    .createHmac('sha256', params.secret)
    .update(`${params.timestamp}\n${params.secret}`)
    .digest('base64')
  return timingSafeEqual(decodeURIComponent(params.sign), expected)
}

export function verifyWeComSignature(params: {
  token: string
  timestamp: string
  nonce: string
  signature: string
  body?: string
}): boolean {
  const source = [params.token, params.timestamp, params.nonce, params.body ?? '']
    .sort()
    .join('')
  const expected = crypto.createHash('sha1').update(source).digest('hex')
  return timingSafeEqual(params.signature, expected)
}

function verifyAdapterSignature(input: {
  channel: 'telegram' | 'feishu' | 'dingtalk' | 'wecom'
  rawBody: string
  headers: Headers
  config: AdapterFileConfig
}): void {
  if (input.channel === 'dingtalk') {
    const secret = input.config.dingtalk?.robotSecret ?? input.config.dingtalk?.clientSecret
    const timestamp =
      input.headers.get('timestamp') ??
      input.headers.get('x-dingtalk-timestamp') ??
      ''
    const sign =
      input.headers.get('sign') ??
      input.headers.get('x-dingtalk-signature') ??
      ''
    if (secret && (!timestamp || !sign || !verifyDingTalkSignature({ timestamp, sign, secret }))) {
      throw new Error('dingtalk_signature_invalid')
    }
  }

  if (input.channel === 'wecom') {
    const token = input.config.wecom?.secret
    const timestamp = input.headers.get('timestamp') ?? input.headers.get('x-wecom-timestamp') ?? ''
    const nonce = input.headers.get('nonce') ?? input.headers.get('x-wecom-nonce') ?? ''
    const signature = input.headers.get('msg_signature') ?? input.headers.get('signature') ?? ''
    if (token && signature && !verifyWeComSignature({
      token,
      timestamp,
      nonce,
      signature,
      body: input.rawBody,
    })) {
      throw new Error('wecom_signature_invalid')
    }
  }
}

function parseByChannel(
  channel: 'telegram' | 'feishu' | 'dingtalk' | 'wecom',
  body: Record<string, unknown>,
): ParsedAdapterInbound {
  switch (channel) {
    case 'telegram':
      return parseTelegram(body)
    case 'feishu':
      return parseFeishu(body)
    case 'dingtalk':
      return parseDingTalk(body)
    case 'wecom':
      return parseWeCom(body)
  }
}

function parseTelegram(body: Record<string, unknown>): ParsedAdapterInbound {
  const message = asRecord(body.message) ?? asRecord(body.edited_message)
  const callback = asRecord(body.callback_query)
  const source = callback ? asRecord(callback.message) : message
  const from = asRecord(callback?.from) ?? asRecord(message?.from)
  return {
    userId: readStringOrNumber(from?.id),
    displayName: [from?.first_name, from?.last_name].filter(Boolean).join(' ') || readString(from?.username),
    text: readString(callback?.data) || readString(message?.text) || readString(source?.text),
  }
}

function parseFeishu(body: Record<string, unknown>): ParsedAdapterInbound {
  const event = asRecord(body.event) ?? body
  const sender = asRecord(event.sender)
  const senderId = asRecord(sender?.sender_id)
  const message = asRecord(event.message)
  const content = readString(message?.content)
  return {
    userId: readString(senderId?.open_id) || readString(senderId?.user_id),
    displayName: readString(sender?.sender_name),
    text: extractFeishuText(content) || readString(event.text),
  }
}

function parseDingTalk(body: Record<string, unknown>): ParsedAdapterInbound {
  const text = asRecord(body.text)
  return {
    userId: readString(body.senderStaffId) || readString(body.senderId),
    displayName: readString(body.senderNick),
    text: readString(text?.content) || readString(body.content),
  }
}

function parseWeCom(body: Record<string, unknown>): ParsedAdapterInbound {
  const text = asRecord(body.text)
  return {
    userId: readString(body.FromUserName) || readString(body.fromUserName),
    displayName: readString(body.UserName) || readString(body.userName),
    text: readString(text?.content) || readString(body.Content) || readString(body.content),
  }
}

function extractFeishuText(content: string): string {
  if (!content) return ''
  try {
    const parsed = JSON.parse(content) as { text?: unknown }
    return readString(parsed.text)
  } catch {
    return content
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readStringOrNumber(value: unknown): string | number | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value
  return undefined
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

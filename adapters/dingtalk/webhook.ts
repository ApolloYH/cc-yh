import * as crypto from 'node:crypto'

export type DingTalkMarkdownMessage = {
  msgtype: 'markdown'
  markdown: {
    title: string
    text: string
  }
}

export function buildDingTalkRobotWebhookUrl(
  webhook: string,
  secret: string,
  timestamp = Date.now(),
): string {
  if (!secret) return webhook

  const url = new URL(webhook)
  const stringToSign = `${timestamp}\n${secret}`
  const sign = crypto
    .createHmac('sha256', secret)
    .update(stringToSign)
    .digest('base64')

  url.searchParams.set('timestamp', String(timestamp))
  url.searchParams.set('sign', sign)
  return url.toString()
}

export function formatDingTalkMarkdown(title: string, text: string): DingTalkMarkdownMessage {
  return {
    msgtype: 'markdown',
    markdown: {
      title,
      text,
    },
  }
}

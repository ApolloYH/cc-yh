export type WeComMarkdownMessage = {
  msgtype: 'markdown'
  markdown: {
    content: string
  }
}

export type WeComTextMessage = {
  msgtype: 'text'
  text: {
    content: string
    mentioned_list?: string[]
    mentioned_mobile_list?: string[]
  }
}

export function buildWeComRobotWebhookUrl(webhookKeyOrUrl: string): string {
  if (/^https?:\/\//i.test(webhookKeyOrUrl)) return webhookKeyOrUrl
  return `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(webhookKeyOrUrl)}`
}

export function formatWeComMarkdown(content: string): WeComMarkdownMessage {
  return {
    msgtype: 'markdown',
    markdown: {
      content,
    },
  }
}

export function formatWeComText(
  content: string,
  mentionedList: string[] = [],
  mentionedMobileList: string[] = [],
): WeComTextMessage {
  const text: WeComTextMessage['text'] = { content }

  if (mentionedList.length > 0) {
    text.mentioned_list = mentionedList
  }
  if (mentionedMobileList.length > 0) {
    text.mentioned_mobile_list = mentionedMobileList
  }

  return {
    msgtype: 'text',
    text,
  }
}

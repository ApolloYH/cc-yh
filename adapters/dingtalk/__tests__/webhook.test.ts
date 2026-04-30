import { describe, expect, it } from 'bun:test'
import {
  buildDingTalkRobotWebhookUrl,
  formatDingTalkMarkdown,
} from '../webhook.js'

describe('DingTalk webhook helpers', () => {
  it('adds DingTalk robot signature query params', () => {
    const signed = buildDingTalkRobotWebhookUrl(
      'https://oapi.dingtalk.com/robot/send?access_token=abc',
      'SECabc123',
      1700000000000,
    )
    const url = new URL(signed)

    expect(url.searchParams.get('access_token')).toBe('abc')
    expect(url.searchParams.get('timestamp')).toBe('1700000000000')
    expect(url.searchParams.get('sign')).toBe('N5P09a4+p1AMJIJWnIvQd2Yxw9+fu/oEBnPrjCcsLXk=')
  })

  it('leaves unsigned webhooks unchanged when no secret is configured', () => {
    const webhook = 'https://oapi.dingtalk.com/robot/send?access_token=abc'
    expect(buildDingTalkRobotWebhookUrl(webhook, '')).toBe(webhook)
  })

  it('formats markdown robot messages', () => {
    expect(formatDingTalkMarkdown('Task Done', '**ok**')).toEqual({
      msgtype: 'markdown',
      markdown: {
        title: 'Task Done',
        text: '**ok**',
      },
    })
  })
})

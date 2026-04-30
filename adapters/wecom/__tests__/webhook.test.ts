import { describe, expect, it } from 'bun:test'
import {
  buildWeComRobotWebhookUrl,
  formatWeComMarkdown,
  formatWeComText,
} from '../webhook.js'

describe('WeCom webhook helpers', () => {
  it('builds a robot webhook URL from a key', () => {
    expect(buildWeComRobotWebhookUrl('abc 123')).toBe(
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc%20123',
    )
  })

  it('keeps a full webhook URL unchanged', () => {
    const url = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc'
    expect(buildWeComRobotWebhookUrl(url)).toBe(url)
  })

  it('formats markdown messages', () => {
    expect(formatWeComMarkdown('**ok**')).toEqual({
      msgtype: 'markdown',
      markdown: {
        content: '**ok**',
      },
    })
  })

  it('formats text messages with optional mentions', () => {
    expect(formatWeComText('done', ['zhangsan'], ['13800000000'])).toEqual({
      msgtype: 'text',
      text: {
        content: 'done',
        mentioned_list: ['zhangsan'],
        mentioned_mobile_list: ['13800000000'],
      },
    })
  })
})

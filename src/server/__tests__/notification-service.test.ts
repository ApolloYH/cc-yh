import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { sendMarkdownNotification } from '../services/notificationService.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalFetch: typeof globalThis.fetch

describe('notificationService generic markdown channels', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-service-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalFetch = globalThis.fetch
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('sends Jarvis/Away markdown to DingTalk and WeCom robots', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'adapters.json'),
      JSON.stringify({
        dingtalk: {
          robotWebhook: 'https://oapi.dingtalk.com/robot/send?access_token=dt',
          robotSecret: '',
        },
        wecom: {
          webhookKey: 'wc',
        },
      }),
      'utf-8',
    )

    const calls: Array<{ url: string; body: unknown }> = []
    globalThis.fetch = (async (url, init) => {
      calls.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      return new Response('{}', { status: 200 })
    }) as typeof fetch

    await sendMarkdownNotification({
      title: 'Checkpoint',
      markdown: '**Checkpoint**\n\nok',
      channels: ['dingtalk', 'wecom'],
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.url).toContain('dingtalk.com/robot/send')
    expect(calls[0]?.body).toMatchObject({
      msgtype: 'markdown',
      markdown: { title: 'Checkpoint' },
    })
    expect(calls[1]?.url).toContain('qyapi.weixin.qq.com/cgi-bin/webhook/send?key=wc')
    expect(calls[1]?.body).toMatchObject({
      msgtype: 'markdown',
      markdown: { content: '**Checkpoint**\n\nok' },
    })
  })
})

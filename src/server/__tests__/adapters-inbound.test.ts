import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { handleAdaptersApi } from '../api/adapters.js'
import { adapterService } from '../services/adapterService.js'
import { enqueueJarvisTask, listJarvisQueue } from '../../jarvis/queue.js'

let tmpDir = ''
let oldConfigDir: string | undefined
let oldDisableMainModel: string | undefined

describe('adapter inbound API', () => {
  beforeEach(async () => {
    oldConfigDir = process.env.CLAUDE_CONFIG_DIR
    oldDisableMainModel = process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-inbound-'))
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION = '1'
  })

  afterEach(async () => {
    if (oldConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = oldConfigDir
    if (oldDisableMainModel === undefined) delete process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION
    else process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION = oldDisableMainModel
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('turns an allowed DingTalk inbound message into Jarvis transcript messages', async () => {
    await adapterService.updateConfig({
      dingtalk: {
        allowedUsers: ['user-1'],
      },
    })

    const url = new URL('http://localhost/api/adapters/inbound/dingtalk')
    const response = await handleAdaptersApi(
      new Request(url, {
        method: 'POST',
        body: JSON.stringify({
          userId: 'user-1',
          displayName: 'Alice',
          text: '请分析 C:\\Users\\y1513\\Desktop\\demo 这个项目的结构',
          runNow: false,
        }),
      }),
      url,
      ['api', 'adapters', 'inbound', 'dingtalk'],
    )
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.ok).toBe(true)
    expect(body.channel).toBe('dingtalk')
    expect(body.jarvis).toBe(true)
    expect(body.messages.some((message: any) => message.role === 'user' && message.message.includes('demo'))).toBe(true)
    expect(body.messages.some((message: any) => message.role === 'jarvis')).toBe(true)
  })

  it('rejects denied users for inbound messages', async () => {
    await adapterService.updateConfig({
      wecom: {
        allowedUsers: ['allowed'],
      },
    })

    const url = new URL('http://localhost/api/adapters/inbound/wecom')
    const response = await handleAdaptersApi(
      new Request(url, {
        method: 'POST',
        body: JSON.stringify({
          userId: 'blocked',
          text: 'run task',
          runNow: false,
        }),
      }),
      url,
      ['api', 'adapters', 'inbound', 'wecom'],
    )

    expect(response.status).toBe(403)
  })

  it('parses native Telegram webhook actions for Jarvis checkpoints', async () => {
    const item = await enqueueJarvisTask({
      prompt: 'continue away work',
      checkpoint: 'Last checkpoint from queue',
    })
    const url = new URL('http://localhost/api/adapters/webhook/telegram')
    const response = await handleAdaptersApi(
      new Request(url, {
        method: 'POST',
        body: JSON.stringify({
          message: {
            from: { id: 42, first_name: 'Ada' },
            text: `/checkpoint ${item.id}`,
          },
        }),
      }),
      url,
      ['api', 'adapters', 'webhook', 'telegram'],
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.action.type).toBe('checkpoint')
    expect(body.checkpoint).toBe('Last checkpoint from queue')
  })

  it('verifies DingTalk native webhook signatures', async () => {
    const secret = 'ding-secret'
    await adapterService.updateConfig({
      dingtalk: {
        robotSecret: secret,
      },
    })
    const timestamp = String(Date.now())
    const sign = encodeURIComponent(
      crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}\n${secret}`)
        .digest('base64'),
    )
    const url = new URL('http://localhost/api/adapters/webhook/dingtalk')
    const response = await handleAdaptersApi(
      new Request(url, {
        method: 'POST',
        headers: { timestamp, sign },
        body: JSON.stringify({
          senderStaffId: 'user-1',
          senderNick: 'Alice',
          text: { content: 'summarize status' },
          runNow: false,
        }),
      }),
      url,
      ['api', 'adapters', 'webhook', 'dingtalk'],
    )

    expect(response.status).toBe(202)
  })
})

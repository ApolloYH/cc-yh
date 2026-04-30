import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { adapterService } from '../services/adapterService.js'

let tmpDir: string
let oldConfigDir: string | undefined

beforeEach(async () => {
  oldConfigDir = process.env.CLAUDE_CONFIG_DIR
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-service-test-'))
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  if (oldConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = oldConfigDir
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('adapterService channel config', () => {
  it('masks DingTalk and WeCom secrets', async () => {
    await adapterService.updateConfig({
      dingtalk: {
        clientSecret: 'dingtalk-client-secret',
        robotWebhook: 'https://oapi.dingtalk.com/robot/send?access_token=abc',
        robotSecret: 'dingtalk-robot-secret',
      },
      wecom: {
        secret: 'wecom-secret',
        webhookKey: 'wecom-webhook-key',
      },
    })

    const config = await adapterService.getConfig()

    expect(config.dingtalk?.clientSecret).toBe('****cret')
    expect(config.dingtalk?.robotWebhook).toBe('****=abc')
    expect(config.dingtalk?.robotSecret).toBe('****cret')
    expect(config.wecom?.secret).toBe('****cret')
    expect(config.wecom?.webhookKey).toBe('****-key')
  })

  it('preserves masked DingTalk and WeCom values during updates', async () => {
    await adapterService.updateConfig({
      dingtalk: {
        clientSecret: 'dingtalk-client-secret',
        robotWebhook: 'https://oapi.dingtalk.com/robot/send?access_token=abc',
        robotSecret: 'dingtalk-robot-secret',
        allowedUsers: ['old'],
      },
      wecom: {
        secret: 'wecom-secret',
        webhookKey: 'wecom-webhook-key',
        allowedUsers: ['old'],
      },
    })

    await adapterService.updateConfig({
      dingtalk: {
        clientSecret: '****cret',
        robotWebhook: '****=abc',
        robotSecret: '****cret',
        allowedUsers: ['new'],
      },
      wecom: {
        secret: '****cret',
        webhookKey: '****-key',
        allowedUsers: ['new'],
      },
    })

    const raw = await adapterService.getRawConfig()

    expect(raw.dingtalk?.clientSecret).toBe('dingtalk-client-secret')
    expect(raw.dingtalk?.robotWebhook).toBe('https://oapi.dingtalk.com/robot/send?access_token=abc')
    expect(raw.dingtalk?.robotSecret).toBe('dingtalk-robot-secret')
    expect(raw.dingtalk?.allowedUsers).toEqual(['new'])
    expect(raw.wecom?.secret).toBe('wecom-secret')
    expect(raw.wecom?.webhookKey).toBe('wecom-webhook-key')
    expect(raw.wecom?.allowedUsers).toEqual(['new'])
  })
})

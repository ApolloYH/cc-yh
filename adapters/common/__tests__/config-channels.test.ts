import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadConfig } from '../config.js'

const ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'DINGTALK_CLIENT_ID',
  'DINGTALK_CLIENT_SECRET',
  'DINGTALK_ROBOT_WEBHOOK',
  'DINGTALK_ROBOT_SECRET',
  'WECOM_CORP_ID',
  'WECOM_AGENT_ID',
  'WECOM_SECRET',
  'WECOM_WEBHOOK_KEY',
] as const

let tmpDir: string
let oldEnv: Partial<Record<(typeof ENV_KEYS)[number], string>>

beforeEach(async () => {
  oldEnv = {}
  for (const key of ENV_KEYS) {
    oldEnv[key] = process.env[key]
    delete process.env[key]
  }

  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-config-test-'))
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const value = oldEnv[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('adapter channel config', () => {
  it('loads DingTalk and WeCom config from adapters.json', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'adapters.json'),
      JSON.stringify({
        dingtalk: {
          clientId: 'dt-client',
          clientSecret: 'dt-secret',
          robotWebhook: 'https://oapi.dingtalk.com/robot/send?access_token=abc',
          robotSecret: 'dt-robot-secret',
          allowedUsers: ['user-a'],
          pairedUsers: [{ userId: 'user-b', displayName: 'User B', pairedAt: 1 }],
          defaultWorkDir: 'C:/work/dingtalk',
        },
        wecom: {
          corpId: 'corp',
          agentId: 'agent',
          secret: 'wc-secret',
          webhookKey: 'wc-key',
          allowedUsers: ['user-c'],
          pairedUsers: [{ userId: 'user-d', displayName: 'User D', pairedAt: 2 }],
          defaultWorkDir: 'C:/work/wecom',
        },
      }),
      'utf-8',
    )

    const config = loadConfig()

    expect(config.dingtalk.clientId).toBe('dt-client')
    expect(config.dingtalk.clientSecret).toBe('dt-secret')
    expect(config.dingtalk.robotWebhook).toContain('access_token=abc')
    expect(config.dingtalk.robotSecret).toBe('dt-robot-secret')
    expect(config.dingtalk.allowedUsers).toEqual(['user-a'])
    expect(config.dingtalk.pairedUsers).toHaveLength(1)
    expect(config.dingtalk.defaultWorkDir).toBe('C:/work/dingtalk')

    expect(config.wecom.corpId).toBe('corp')
    expect(config.wecom.agentId).toBe('agent')
    expect(config.wecom.secret).toBe('wc-secret')
    expect(config.wecom.webhookKey).toBe('wc-key')
    expect(config.wecom.allowedUsers).toEqual(['user-c'])
    expect(config.wecom.pairedUsers).toHaveLength(1)
    expect(config.wecom.defaultWorkDir).toBe('C:/work/wecom')
  })

  it('allows environment variables to override channel secrets', () => {
    process.env.DINGTALK_CLIENT_SECRET = 'env-dt-secret'
    process.env.DINGTALK_ROBOT_SECRET = 'env-robot-secret'
    process.env.WECOM_SECRET = 'env-wc-secret'
    process.env.WECOM_WEBHOOK_KEY = 'env-wc-key'

    const config = loadConfig()

    expect(config.dingtalk.clientSecret).toBe('env-dt-secret')
    expect(config.dingtalk.robotSecret).toBe('env-robot-secret')
    expect(config.wecom.secret).toBe('env-wc-secret')
    expect(config.wecom.webhookKey).toBe('env-wc-key')
  })
})

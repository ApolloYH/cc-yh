/**
 * Adapter 配置加载
 *
 * 优先级：环境变量 > ~/.claude-yh/adapters.json > 默认值
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

export type PairedUser = {
  userId: string | number
  displayName: string
  pairedAt: number
}

export type PairingState = {
  code: string | null
  expiresAt: number | null
  createdAt: number | null
}

export type TelegramConfig = {
  botToken: string
  allowedUsers: number[]
  pairedUsers: PairedUser[]
  defaultWorkDir: string
}

export type FeishuConfig = {
  appId: string
  appSecret: string
  encryptKey: string
  verificationToken: string
  allowedUsers: string[]
  pairedUsers: PairedUser[]
  defaultWorkDir: string
  streamingCard: boolean
}

export type DingTalkConfig = {
  clientId: string
  clientSecret: string
  robotWebhook: string
  robotSecret: string
  allowedUsers: string[]
  pairedUsers: PairedUser[]
  defaultWorkDir: string
}

export type WeComConfig = {
  corpId: string
  agentId: string
  secret: string
  webhookKey: string
  allowedUsers: string[]
  pairedUsers: PairedUser[]
  defaultWorkDir: string
}

export type AdapterConfig = {
  serverUrl: string
  defaultProjectDir: string
  pairing: PairingState
  telegram: TelegramConfig
  feishu: FeishuConfig
  dingtalk: DingTalkConfig
  wecom: WeComConfig
}

function getConfigPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude-yh')
  return path.join(configDir, 'adapters.json')
}

function loadFile(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'))
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.warn(`[Config] Failed to parse ${getConfigPath()}, using defaults`)
    }
    return {}
  }
}

function normalizeProxyUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

function parseWindowsProxyServer(value: string): { http?: string; https?: string } {
  const trimmed = value.trim()
  if (!trimmed) return {}

  if (!trimmed.includes('=')) {
    const proxy = normalizeProxyUrl(trimmed)
    return proxy ? { http: proxy, https: proxy } : {}
  }

  const result: { http?: string; https?: string } = {}
  for (const segment of trimmed.split(';')) {
    const [rawScheme, rawTarget] = segment.split('=', 2)
    const scheme = rawScheme?.trim().toLowerCase()
    const target = rawTarget?.trim()
    if (!scheme || !target) continue
    const proxy = normalizeProxyUrl(target)
    if (!proxy) continue
    if (scheme === 'http') result.http = proxy
    if (scheme === 'https') result.https = proxy
  }

  if (!result.http && result.https) result.http = result.https
  if (!result.https && result.http) result.https = result.http
  return result
}

function applyWindowsSystemProxyEnv(): void {
  if (process.platform !== 'win32') return
  if (
    process.env.HTTP_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.ALL_PROXY ||
    process.env.http_proxy ||
    process.env.https_proxy ||
    process.env.all_proxy
  ) {
    return
  }

  try {
    const output = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )

    const proxyEnableMatch = output.match(/ProxyEnable\s+REG_DWORD\s+0x([0-9a-fA-F]+)/)
    const proxyServerMatch = output.match(/ProxyServer\s+REG_SZ\s+(.+)/)

    if (!proxyEnableMatch || parseInt(proxyEnableMatch[1]!, 16) !== 1) return
    if (!proxyServerMatch) return

    const proxy = parseWindowsProxyServer(proxyServerMatch[1]!)
    if (!proxy.http && !proxy.https) return

    if (proxy.http) {
      process.env.HTTP_PROXY = proxy.http
      process.env.http_proxy = proxy.http
    }
    if (proxy.https) {
      process.env.HTTPS_PROXY = proxy.https
      process.env.https_proxy = proxy.https
    }

    console.log(
      `[Config] Using Windows system proxy${proxy.http || proxy.https ? `: ${proxy.https ?? proxy.http}` : ''}`,
    )
  } catch {
    // Ignore system proxy detection failures and fall back to direct access.
  }
}

export function loadConfig(): AdapterConfig {
  applyWindowsSystemProxyEnv()
  const file = loadFile()
  const tg = file.telegram ?? {}
  const fs_ = file.feishu ?? {}
  const dingtalk = file.dingtalk ?? {}
  const wecom = file.wecom ?? {}
  const pairing = file.pairing ?? {}

  return {
    serverUrl: process.env.ADAPTER_SERVER_URL || file.serverUrl || 'ws://127.0.0.1:3456',
    defaultProjectDir: file.defaultProjectDir || '',
    pairing: {
      code: pairing.code ?? null,
      expiresAt: pairing.expiresAt ?? null,
      createdAt: pairing.createdAt ?? null,
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || tg.botToken || '',
      allowedUsers: tg.allowedUsers ?? [],
      pairedUsers: tg.pairedUsers ?? [],
      defaultWorkDir: tg.defaultWorkDir || process.cwd(),
    },
    feishu: {
      appId: process.env.FEISHU_APP_ID || fs_.appId || '',
      appSecret: process.env.FEISHU_APP_SECRET || fs_.appSecret || '',
      encryptKey: process.env.FEISHU_ENCRYPT_KEY || fs_.encryptKey || '',
      verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || fs_.verificationToken || '',
      allowedUsers: fs_.allowedUsers ?? [],
      pairedUsers: fs_.pairedUsers ?? [],
      defaultWorkDir: fs_.defaultWorkDir || process.cwd(),
      streamingCard: fs_.streamingCard ?? false,
    },
    dingtalk: {
      clientId: process.env.DINGTALK_CLIENT_ID || dingtalk.clientId || '',
      clientSecret:
        process.env.DINGTALK_CLIENT_SECRET || dingtalk.clientSecret || '',
      robotWebhook:
        process.env.DINGTALK_ROBOT_WEBHOOK || dingtalk.robotWebhook || '',
      robotSecret:
        process.env.DINGTALK_ROBOT_SECRET || dingtalk.robotSecret || '',
      allowedUsers: dingtalk.allowedUsers ?? [],
      pairedUsers: dingtalk.pairedUsers ?? [],
      defaultWorkDir: dingtalk.defaultWorkDir || process.cwd(),
    },
    wecom: {
      corpId: process.env.WECOM_CORP_ID || wecom.corpId || '',
      agentId: process.env.WECOM_AGENT_ID || wecom.agentId || '',
      secret: process.env.WECOM_SECRET || wecom.secret || '',
      webhookKey: process.env.WECOM_WEBHOOK_KEY || wecom.webhookKey || '',
      allowedUsers: wecom.allowedUsers ?? [],
      pairedUsers: wecom.pairedUsers ?? [],
      defaultWorkDir: wecom.defaultWorkDir || process.cwd(),
    },
  }
}

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { ProviderService } from '../../server/services/providerService.js'
import type { ApiFormat } from '../../server/types/provider.js'

type MainModelConfig = {
  baseUrl: string
  apiKey: string
  apiFormat: ApiFormat
  model: string
  source: 'claude-yh-provider' | 'settings' | 'env'
}

export type MainModelTextResult = {
  content: string
  model: string
  source: MainModelConfig['source']
}

export async function callConfiguredMainModel(params: {
  systemPrompt: string
  userPrompt: string
  maxTokens?: number
  timeoutMs?: number
}): Promise<MainModelTextResult | null> {
  if (process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION === '1') {
    return null
  }
  const config = await resolveMainModelConfig()
  if (!config) return null

  const response = await fetch(buildModelUrl(config.baseUrl, config.apiFormat), {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify(buildBody(config, params)),
    signal: AbortSignal.timeout(params.timeoutMs ?? 120_000),
  })
  if (!response.ok) return null

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null
  const content = extractText(payload, config.apiFormat)
  if (!content.trim()) return null

  return {
    content,
    model: config.model,
    source: config.source,
  }
}

export function parseJsonFromModelText(value: string): Record<string, unknown> | null {
  const trimmed = value.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const raw = fenced ? fenced[1].trim() : trimmed
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null
    } catch {
      return null
    }
  }
}

async function resolveMainModelConfig(): Promise<MainModelConfig | null> {
  const providerService = new ProviderService()
  const { providers, activeId } = await providerService.listProviders().catch(() => ({ providers: [], activeId: null }))
  const active = activeId ? providers.find(provider => provider.id === activeId) : null
  if (active?.apiKey && active.baseUrl && active.models?.main) {
    return {
      baseUrl: active.baseUrl,
      apiKey: active.apiKey,
      apiFormat: active.apiFormat ?? 'anthropic',
      model: active.models.main,
      source: 'claude-yh-provider',
    }
  }

  const env = await readSettingsEnv()
  const settingsConfig = configFromEnv(env, 'settings')
  if (settingsConfig) return settingsConfig

  return configFromEnv(process.env, 'env')
}

function configFromEnv(
  env: Record<string, string | undefined>,
  source: 'settings' | 'env',
): MainModelConfig | null {
  const apiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY
  const model = env.ANTHROPIC_MODEL
    || env.ANTHROPIC_DEFAULT_SONNET_MODEL
    || env.ANTHROPIC_DEFAULT_OPUS_MODEL
    || env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  if (!apiKey || !model) return null

  return {
    baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    apiKey,
    apiFormat: inferApiFormat(env),
    model,
    source,
  }
}

async function readSettingsEnv(): Promise<Record<string, string | undefined>> {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude-yh')
  try {
    const raw = await fs.readFile(path.join(configDir, 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const env = parsed.env
    if (!env || typeof env !== 'object' || Array.isArray(env)) return {}
    return env as Record<string, string | undefined>
  } catch {
    return {}
  }
}

function inferApiFormat(env: Record<string, string | undefined>): ApiFormat {
  if (env.CLAUDE_CODE_COMPAT_PROVIDER === 'openai') {
    return env.CLAUDE_CODE_OPENAI_COMPAT_MODE === 'responses'
      ? 'openai_responses'
      : 'openai_chat'
  }
  return 'anthropic'
}

function buildModelUrl(baseUrl: string, apiFormat: ApiFormat): string {
  const base = baseUrl.replace(/\/+$/, '')
  if (apiFormat === 'openai_chat') return appendV1(base, 'chat/completions')
  if (apiFormat === 'openai_responses') return appendV1(base, 'responses')
  return appendV1(base, 'messages')
}

function appendV1(base: string, endpoint: string): string {
  return /\/v1$/i.test(base) ? `${base}/${endpoint}` : `${base}/v1/${endpoint}`
}

function buildHeaders(config: MainModelConfig): Record<string, string> {
  if (config.apiFormat === 'anthropic') {
    return {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    }
  }
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${config.apiKey}`,
  }
}

function buildBody(
  config: MainModelConfig,
  params: {
    systemPrompt: string
    userPrompt: string
    maxTokens?: number
  },
): Record<string, unknown> {
  const maxTokens = params.maxTokens ?? 1200
  if (config.apiFormat === 'openai_chat') {
    return {
      model: config.model,
      max_tokens: maxTokens,
      temperature: 0.2,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
    }
  }
  if (config.apiFormat === 'openai_responses') {
    return {
      model: config.model,
      max_output_tokens: maxTokens,
      temperature: 0.2,
      instructions: params.systemPrompt,
      input: params.userPrompt,
    }
  }
  return {
    model: config.model,
    max_tokens: maxTokens,
    temperature: 0.2,
    system: params.systemPrompt,
    messages: [
      { role: 'user', content: params.userPrompt },
    ],
  }
}

function extractText(
  payload: Record<string, unknown> | null,
  apiFormat: ApiFormat,
): string {
  if (!payload) return ''
  if (apiFormat === 'openai_chat') {
    const choice = Array.isArray(payload.choices)
      ? payload.choices[0] as { message?: { content?: unknown } } | undefined
      : undefined
    return typeof choice?.message?.content === 'string' ? choice.message.content : ''
  }
  if (apiFormat === 'openai_responses') {
    if (typeof payload.output_text === 'string') return payload.output_text
    if (Array.isArray(payload.output)) {
      return payload.output
        .flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const content = (item as { content?: unknown }).content
          if (!Array.isArray(content)) return []
          return content.map(block => {
            if (!block || typeof block !== 'object') return ''
            const record = block as { text?: unknown; type?: unknown }
            return typeof record.text === 'string' ? record.text : ''
          })
        })
        .filter(Boolean)
        .join('\n')
    }
    return ''
  }
  if (!Array.isArray(payload.content)) return ''
  return payload.content
    .map(block => {
      if (!block || typeof block !== 'object') return ''
      const record = block as { text?: unknown }
      return typeof record.text === 'string' ? record.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

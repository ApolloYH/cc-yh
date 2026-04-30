/**
 * Provider Service — preset-based provider configuration
 *
 * Storage: ~/.claude-yh/settings.json
 * - claudeYhProviders: saved provider index
 * - env: active provider env vars consumed by the CLI
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ApiError } from '../middleware/errorHandler.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import { anthropicToOpenaiChat } from '../proxy/transform/anthropicToOpenaiChat.js'
import { anthropicToOpenaiResponses } from '../proxy/transform/anthropicToOpenaiResponses.js'
import { openaiChatToAnthropic } from '../proxy/transform/openaiChatToAnthropic.js'
import { openaiResponsesToAnthropic } from '../proxy/transform/openaiResponsesToAnthropic.js'
import type { AnthropicRequest, AnthropicResponse } from '../proxy/transform/types.js'
import type {
  SavedProvider,
  ProvidersIndex,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderInput,
  ProviderTestResult,
  ProviderTestStepResult,
  ApiFormat,
} from '../types/provider.js'
import { ProvidersIndexSchema } from '../types/provider.js'

const MANAGED_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_COMPAT_PROVIDER',
  'CLAUDE_CODE_OPENAI_COMPAT_MODE',
] as const

const DEFAULT_INDEX: ProvidersIndex = { activeId: null, providers: [] }
const PROVIDERS_SETTINGS_KEY = 'claudeYhProviders'

function normalizeEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const env: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') env[key] = raw
  }
  return env
}

function hasManagedEnv(env: Record<string, string>): boolean {
  return MANAGED_ENV_KEYS.some(
    (key) => typeof env[key] === 'string' && env[key].trim().length > 0,
  )
}

type AuthStatusSource = 'claude-yh-provider' | 'original-settings' | 'env' | 'none'

type EffectiveProviderInfo = {
  name: string
  baseUrl?: string
  apiFormat: ApiFormat
  modelId?: string
  readOnly: boolean
  source: Exclude<AuthStatusSource, 'none'>
}

const PROVIDER_NAME_HINTS: Array<{ name: string; keywords: string[] }> = [
  { name: 'MiniMax', keywords: ['minimax', 'minimaxi'] },
  { name: 'DeepSeek', keywords: ['deepseek'] },
  { name: 'Kimi', keywords: ['moonshot', 'kimi'] },
  { name: 'Zhipu GLM', keywords: ['bigmodel', 'zhipu', 'glm'] },
  { name: 'Anthropic Claude', keywords: ['anthropic', 'claude'] },
  { name: 'OpenAI', keywords: ['openai'] },
]

function normalizeBaseUrl(baseUrl?: string): string | undefined {
  const trimmed = baseUrl?.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/\/+$/, '').toLowerCase()
}

function inferApiFormatFromEnv(env: Record<string, string | undefined>): ApiFormat {
  if (env.CLAUDE_CODE_COMPAT_PROVIDER === 'openai') {
    return env.CLAUDE_CODE_OPENAI_COMPAT_MODE === 'responses'
      ? 'openai_responses'
      : 'openai_chat'
  }
  return 'anthropic'
}

function inferProviderName(baseUrl: string | undefined, apiFormat: ApiFormat): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized) {
    const preset = PROVIDER_PRESETS.find((candidate) => {
      if (!candidate.baseUrl || candidate.id === 'official' || candidate.id === 'custom') {
        return false
      }
      return normalizeBaseUrl(candidate.baseUrl) === normalized
    })
    if (preset) return preset.name

    for (const hint of PROVIDER_NAME_HINTS) {
      if (hint.keywords.some((keyword) => normalized.includes(keyword))) {
        return hint.name
      }
    }

    try {
      const host = new URL(normalized).hostname.replace(/^www\./, '')
      if (host) return host
    } catch {
      // Ignore malformed URLs and fall back below.
    }
  }

  return apiFormat === 'anthropic' ? 'Anthropic Compatible' : 'OpenAI Compatible'
}

function resolveEffectiveProvider(
  env: Record<string, string | undefined>,
  source: Exclude<AuthStatusSource, 'none'>,
): EffectiveProviderInfo {
  const apiFormat = inferApiFormatFromEnv(env)
  const baseUrl = env.ANTHROPIC_BASE_URL?.trim()
  const modelId = env.ANTHROPIC_MODEL?.trim()

  return {
    name: inferProviderName(baseUrl, apiFormat),
    ...(baseUrl ? { baseUrl } : {}),
    apiFormat,
    ...(modelId ? { modelId } : {}),
    readOnly: source !== 'claude-yh-provider',
    source,
  }
}

export class ProviderService {
  private static serverPort = 3456

  static setServerPort(port: number): void {
    ProviderService.serverPort = port
  }

  static getServerPort(): number {
    return ProviderService.serverPort
  }
  private getConfigDir(): string {
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude-yh')
  }

  private getLegacyClaudeYhDir(): string {
    return path.join(this.getConfigDir(), 'claude-yh')
  }

  private getLegacyIndexPath(): string {
    return path.join(this.getLegacyClaudeYhDir(), 'providers.json')
  }

  private getLegacySettingsPath(): string {
    return path.join(this.getLegacyClaudeYhDir(), 'settings.json')
  }

  private getSettingsPath(): string {
    return path.join(this.getConfigDir(), 'settings.json')
  }

  private async readJsonFile(filePath: string): Promise<Record<string, unknown>> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(raw) as Record<string, unknown>
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw ApiError.internal(`Failed to read settings.json: ${err}`)
    }
  }

  private async writeJsonFile(filePath: string, data: Record<string, unknown>): Promise<void> {
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const tmpFile = `${filePath}.tmp.${Date.now()}`
    try {
      await fs.writeFile(tmpFile, JSON.stringify(data, null, 2) + '\n', 'utf-8')
      await fs.rename(tmpFile, filePath)
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {})
      throw ApiError.internal(`Failed to write settings.json: ${err}`)
    }
  }

  private async readSettings(): Promise<Record<string, unknown>> {
    const settings = await this.readJsonFile(this.getSettingsPath())
    const migrated = await this.mergeLegacyProviderSettings(settings)
    if (migrated.changed) {
      await this.writeJsonFile(this.getSettingsPath(), migrated.settings)
    }
    return migrated.settings
  }

  private async writeSettings(settings: Record<string, unknown>): Promise<void> {
    await this.writeJsonFile(this.getSettingsPath(), settings)
  }

  private async readIndex(): Promise<ProvidersIndex> {
    const settings = await this.readSettings()
    const parsed = ProvidersIndexSchema.safeParse(settings[PROVIDERS_SETTINGS_KEY])
    if (parsed.success) {
      return parsed.data
    }
    return { ...DEFAULT_INDEX, providers: [] }
  }

  private async writeIndex(index: ProvidersIndex): Promise<void> {
    const settings = await this.readSettings()
    settings[PROVIDERS_SETTINGS_KEY] = index
    await this.writeSettings(settings)
  }

  private async mergeLegacyProviderSettings(
    settings: Record<string, unknown>,
  ): Promise<{ settings: Record<string, unknown>; changed: boolean }> {
    let changed = false
    const next: Record<string, unknown> = { ...settings }
    const hasUnifiedIndex = ProvidersIndexSchema.safeParse(
      next[PROVIDERS_SETTINGS_KEY],
    ).success

    if (!hasUnifiedIndex) {
      const legacyIndex = await this.readLegacyIndex()
      if (legacyIndex) {
        next[PROVIDERS_SETTINGS_KEY] = legacyIndex
        changed = true
      }
    }

    const legacySettings = await this.readJsonFile(this.getLegacySettingsPath())
    const legacyEnv = normalizeEnv(legacySettings.env)
    if (hasManagedEnv(legacyEnv) && (!hasUnifiedIndex || !hasManagedEnv(normalizeEnv(next.env)))) {
      const currentEnv = normalizeEnv(next.env)
      for (const key of MANAGED_ENV_KEYS) {
        delete currentEnv[key]
      }
      for (const key of MANAGED_ENV_KEYS) {
        const value = legacyEnv[key]
        if (typeof value === 'string' && value.trim().length > 0) {
          currentEnv[key] = value
        }
      }
      next.env = currentEnv
      changed = true
    }

    return { settings: next, changed }
  }

  private async readLegacyIndex(): Promise<ProvidersIndex | null> {
    try {
      const raw = await fs.readFile(this.getLegacyIndexPath(), 'utf-8')
      const parsed = ProvidersIndexSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  // --- CRUD ---

  async listProviders(): Promise<{ providers: SavedProvider[]; activeId: string | null }> {
    const index = await this.readIndex()
    return { providers: index.providers, activeId: index.activeId }
  }

  async getProvider(id: string): Promise<SavedProvider> {
    const index = await this.readIndex()
    const provider = index.providers.find((p) => p.id === id)
    if (!provider) throw ApiError.notFound(`Provider not found: ${id}`)
    return provider
  }

  async addProvider(input: CreateProviderInput): Promise<SavedProvider> {
    const index = await this.readIndex()

    const provider: SavedProvider = {
      id: crypto.randomUUID(),
      presetId: input.presetId,
      name: input.name,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      apiFormat: input.apiFormat ?? 'anthropic',
      models: input.models,
      ...(input.notes !== undefined && { notes: input.notes }),
    }

    index.providers.push(provider)
    await this.writeIndex(index)
    return provider
  }

  async updateProvider(id: string, input: UpdateProviderInput): Promise<SavedProvider> {
    const index = await this.readIndex()
    const idx = index.providers.findIndex((p) => p.id === id)
    if (idx === -1) throw ApiError.notFound(`Provider not found: ${id}`)

    const existing = index.providers[idx]
    const updated: SavedProvider = {
      ...existing,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.apiKey !== undefined && { apiKey: input.apiKey }),
      ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
      ...(input.apiFormat !== undefined && { apiFormat: input.apiFormat }),
      ...(input.models !== undefined && { models: input.models }),
      ...(input.notes !== undefined && { notes: input.notes }),
    }

    index.providers[idx] = updated
    await this.writeIndex(index)

    if (index.activeId === id) {
      await this.syncToSettings(updated)
    }

    return updated
  }

  async deleteProvider(id: string): Promise<void> {
    const index = await this.readIndex()
    const idx = index.providers.findIndex((p) => p.id === id)
    if (idx === -1) throw ApiError.notFound(`Provider not found: ${id}`)

    if (index.activeId === id) {
      throw ApiError.conflict('Cannot delete the active provider. Switch to another provider first.')
    }

    index.providers.splice(idx, 1)
    await this.writeIndex(index)
  }

  // --- Activation ---

  async activateProvider(id: string): Promise<void> {
    const index = await this.readIndex()
    const provider = index.providers.find((p) => p.id === id)
    if (!provider) throw ApiError.notFound(`Provider not found: ${id}`)

    index.activeId = id
    await this.writeIndex(index)

    if (provider.presetId === 'official') {
      await this.clearProviderFromSettings()
    } else {
      await this.syncToSettings(provider)
    }
  }

  async activateOfficial(): Promise<void> {
    const index = await this.readIndex()
    index.activeId = null
    await this.writeIndex(index)
    await this.clearProviderFromSettings()
  }

  // --- Settings sync ---

  private async syncToSettings(provider: SavedProvider): Promise<void> {
    const settings = await this.readSettings()
    const existingEnv = { ...((settings.env as Record<string, string>) || {}) }

    for (const key of MANAGED_ENV_KEYS) {
      delete existingEnv[key]
    }

    const nextEnv: Record<string, string> = {
      ...existingEnv,
      ANTHROPIC_BASE_URL: provider.baseUrl,
      ANTHROPIC_AUTH_TOKEN: provider.apiKey,
      ANTHROPIC_MODEL: provider.models.main,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: provider.models.haiku,
      ANTHROPIC_DEFAULT_SONNET_MODEL: provider.models.sonnet,
      ANTHROPIC_DEFAULT_OPUS_MODEL: provider.models.opus,
    }

    if (provider.apiFormat === 'openai_chat') {
      nextEnv.CLAUDE_CODE_COMPAT_PROVIDER = 'openai'
      nextEnv.CLAUDE_CODE_OPENAI_COMPAT_MODE = 'chat_completions'
    } else if (provider.apiFormat === 'openai_responses') {
      nextEnv.CLAUDE_CODE_COMPAT_PROVIDER = 'openai'
      nextEnv.CLAUDE_CODE_OPENAI_COMPAT_MODE = 'responses'
    }

    settings.env = nextEnv

    await this.writeSettings(settings)
  }

  private async clearProviderFromSettings(): Promise<void> {
    const settings = await this.readSettings()
    const env = (settings.env as Record<string, string>) || {}

    for (const key of MANAGED_ENV_KEYS) {
      delete env[key]
    }

    settings.env = env
    if (Object.keys(env).length === 0) {
      delete settings.env
    }

    await this.writeSettings(settings)
  }

  // --- Auth status ---

  /**
   * Check whether any usable auth exists:
   *  1. A claude-yh provider is active → has auth
   *  2. Original ~/.claude-yh/settings.json has ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY → has auth
   *  3. process.env already has ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN → has auth
   *  4. None of the above → needs setup
   */
  async checkAuthStatus(): Promise<{
    hasAuth: boolean
    source: AuthStatusSource
    activeProvider?: string
    effectiveProvider?: EffectiveProviderInfo
  }> {
    // 1. Check claude-yh active provider
    const index = await this.readIndex()
    if (index.activeId) {
      const provider = index.providers.find(p => p.id === index.activeId)
      if (provider?.apiKey) {
        return {
          hasAuth: true,
          source: 'claude-yh-provider',
          activeProvider: provider.name,
          effectiveProvider: {
            name: provider.name,
            baseUrl: provider.baseUrl,
            apiFormat: provider.apiFormat ?? 'anthropic',
            modelId: provider.models.main,
            readOnly: false,
            source: 'claude-yh-provider',
          },
        }
      }
    }

    // 2. Check process.env (covers .env file + inherited env)
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
      const effectiveProvider = resolveEffectiveProvider(process.env, 'env')
      return {
        hasAuth: true,
        source: 'env',
        activeProvider: effectiveProvider.name,
        effectiveProvider,
      }
    }

    // 3. Check unified ~/.claude-yh/settings.json
    try {
      const settings = await this.readSettings() as { env?: Record<string, string> }
      const env = settings.env ?? {}
      if (env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY) {
        const effectiveProvider = resolveEffectiveProvider(env, 'original-settings')
        return {
          hasAuth: true,
          source: 'original-settings',
          activeProvider: effectiveProvider.name,
          effectiveProvider,
        }
      }
    } catch {
      // File doesn't exist or invalid
    }

    return { hasAuth: false, source: 'none' }
  }

  // --- Proxy support ---

  async getActiveProviderForProxy(): Promise<{
    baseUrl: string
    apiKey: string
    apiFormat: ApiFormat
  } | null> {
    const index = await this.readIndex()
    if (!index.activeId) return null
    const provider = index.providers.find((p) => p.id === index.activeId)
    if (!provider) return null
    return {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      apiFormat: provider.apiFormat ?? 'anthropic',
    }
  }

  // --- Test ---

  async testProvider(
    id: string,
    overrides?: { baseUrl?: string; modelId?: string; apiFormat?: ApiFormat },
  ): Promise<ProviderTestResult> {
    const provider = await this.getProvider(id)
    const baseUrl = overrides?.baseUrl || provider.baseUrl
    const modelId = overrides?.modelId || provider.models.main
    const apiFormat = overrides?.apiFormat ?? provider.apiFormat ?? 'anthropic'

    if (!baseUrl || !provider.apiKey) {
      return { connectivity: { success: false, latencyMs: 0, error: 'Missing baseUrl or apiKey' } }
    }
    return this.testProviderConfig({
      baseUrl,
      apiKey: provider.apiKey,
      modelId,
      apiFormat,
    })
  }

  async testProviderConfig(input: TestProviderInput): Promise<ProviderTestResult> {
    const format: ApiFormat = input.apiFormat ?? 'anthropic'
    const base = input.baseUrl.replace(/\/+$/, '')

    // ── Step 1: Basic connectivity ───────────────────────────
    // Directly call the upstream API to verify URL, key, and model.
    const step1 = await this.testConnectivity(base, input.apiKey, input.modelId, format)

    // If connectivity failed, no point running step 2
    if (!step1.success) {
      return { connectivity: step1 }
    }

    // For native Anthropic format, no proxy pipeline to test
    if (format === 'anthropic') {
      return { connectivity: step1 }
    }

    // ── Step 2: Full proxy pipeline ──────────────────────────
    // Anthropic request → transform → upstream → transform back → validate
    const step2 = await this.testProxyPipeline(base, input.apiKey, input.modelId, format)

    return { connectivity: step1, proxy: step2 }
  }

  /** Step 1: Direct upstream call to verify connectivity, auth, and model. */
  private async testConnectivity(
    base: string,
    apiKey: string,
    modelId: string,
    format: ApiFormat,
  ): Promise<ProviderTestStepResult> {
    const start = Date.now()
    try {
      const { url, headers, body } = buildDirectTestRequest(base, apiKey, modelId, format)
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })

      const latencyMs = Date.now() - start
      const resBody = await response.json().catch(() => null) as Record<string, unknown> | null

      if (!response.ok) {
        let error = `HTTP ${response.status}`
        if (resBody?.error && typeof resBody.error === 'object') {
          error = ((resBody.error as Record<string, unknown>).message as string) || error
        }
        return { success: false, latencyMs, error, modelUsed: modelId, httpStatus: response.status }
      }

      // Validate response structure
      const valid = validateResponseBody(resBody, format)
      if (valid.ok === false) {
        return { success: false, latencyMs, error: valid.error, modelUsed: modelId, httpStatus: response.status }
      }

      return { success: true, latencyMs, modelUsed: valid.model || modelId, httpStatus: response.status }
    } catch (err: unknown) {
      const latencyMs = Date.now() - start
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return { success: false, latencyMs, error: 'Request timed out (30s)', modelUsed: modelId }
      }
      return { success: false, latencyMs, error: err instanceof Error ? err.message : String(err), modelUsed: modelId }
    }
  }

  /** Step 2: Full proxy pipeline — Anthropic → transform → upstream → transform back → validate. */
  private async testProxyPipeline(
    base: string,
    apiKey: string,
    modelId: string,
    format: 'openai_chat' | 'openai_responses',
  ): Promise<ProviderTestStepResult> {
    const start = Date.now()
    try {
      // Build an Anthropic Messages API request (same shape as what CLI sends)
      const anthropicReq: AnthropicRequest = {
        model: modelId,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      }

      // Transform to OpenAI format
      let upstreamUrl: string
      let transformedBody: unknown
      if (format === 'openai_chat') {
        transformedBody = anthropicToOpenaiChat(anthropicReq)
        upstreamUrl = buildVersionedApiUrl(base, 'chat/completions')
      } else {
        transformedBody = anthropicToOpenaiResponses(anthropicReq)
        upstreamUrl = buildVersionedApiUrl(base, 'responses')
      }

      // Call upstream with transformed request
      const response = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(transformedBody),
        signal: AbortSignal.timeout(30000),
      })

      if (!response.ok) {
        const latencyMs = Date.now() - start
        const errText = await response.text().catch(() => '')
        return { success: false, latencyMs, modelUsed: modelId, httpStatus: response.status,
          error: `Upstream HTTP ${response.status}: ${errText.slice(0, 200)}` }
      }

      // Transform response back to Anthropic format
      const responseBody = await response.json()
      const anthropicRes = format === 'openai_chat'
        ? openaiChatToAnthropic(responseBody, modelId)
        : openaiResponsesToAnthropic(responseBody, modelId)

      const latencyMs = Date.now() - start

      // Validate the final Anthropic response
      if (anthropicRes.type !== 'message' || !Array.isArray(anthropicRes.content)) {
        return { success: false, latencyMs, modelUsed: modelId,
          error: 'Proxy transform produced invalid Anthropic response' }
      }

      return { success: true, latencyMs, modelUsed: anthropicRes.model || modelId, httpStatus: response.status }
    } catch (err: unknown) {
      const latencyMs = Date.now() - start
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return { success: false, latencyMs, error: 'Proxy pipeline timed out (30s)', modelUsed: modelId }
      }
      return { success: false, latencyMs, error: err instanceof Error ? err.message : String(err), modelUsed: modelId }
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────

function buildDirectTestRequest(
  base: string,
  apiKey: string,
  modelId: string,
  format: ApiFormat,
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const prompt = 'Say "ok" and nothing else.'

  if (format === 'openai_chat') {
    return {
      url: buildVersionedApiUrl(base, 'chat/completions'),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: { model: modelId, max_tokens: 16, messages: [{ role: 'user', content: prompt }] },
    }
  }
  if (format === 'openai_responses') {
    return {
      url: buildVersionedApiUrl(base, 'responses'),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: { model: modelId, max_output_tokens: 16, input: [{ type: 'message', role: 'user', content: prompt }] },
    }
  }
  // anthropic
  return {
    url: buildVersionedApiUrl(base, 'messages'),
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: { model: modelId, max_tokens: 16, messages: [{ role: 'user', content: prompt }] },
  }
}

function buildVersionedApiUrl(base: string, endpoint: string): string {
  const normalizedBase = base.replace(/\/+$/, '')
  const normalizedEndpoint = endpoint.replace(/^\/+/, '')

  if (/\/v1$/i.test(normalizedBase)) {
    return `${normalizedBase}/${normalizedEndpoint}`
  }
  return `${normalizedBase}/v1/${normalizedEndpoint}`
}

function validateResponseBody(
  body: Record<string, unknown> | null,
  format: ApiFormat,
): { ok: true; model?: string } | { ok: false; error: string } {
  if (!body) return { ok: false, error: 'Empty response — not a valid API endpoint' }
  if (body.error && typeof body.error === 'object') {
    return { ok: false, error: ((body.error as Record<string, unknown>).message as string) || 'Error in response body' }
  }

  if (format === 'openai_chat') {
    if (!Array.isArray(body.choices) || body.choices.length === 0) {
      return { ok: false, error: 'Response missing choices — not a valid Chat Completions endpoint' }
    }
    return { ok: true, model: (body.model as string) || undefined }
  }
  if (format === 'openai_responses') {
    if (!Array.isArray(body.output)) {
      return { ok: false, error: 'Response missing output — not a valid Responses API endpoint' }
    }
    return { ok: true, model: (body.model as string) || undefined }
  }
  // anthropic
  if (body.type !== 'message' || !Array.isArray(body.content)) {
    return { ok: false, error: 'Not a valid Anthropic Messages endpoint' }
  }
  return { ok: true, model: (body.model as string) || undefined }
}


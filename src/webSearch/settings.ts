import type { SettingsJson } from '../utils/settings/types.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

export type WebSearchMode = 'auto' | 'anthropic' | 'local' | 'off'
export type LocalWebSearchProvider = 'duckduckgo' | 'custom'

export type CustomWebSearchConfig = {
  endpoint: string
  method: 'GET' | 'POST'
  apiKey?: string
  authHeader: string
  authPrefix: string
  queryParam: string
  headers: Record<string, string>
  bodyTemplate?: string
  resultsPath: string
  titlePath: string
  urlPath: string
  snippetPath?: string
}

export type WebSearchConfig = {
  enabled: boolean
  mode: WebSearchMode
  localProvider: LocalWebSearchProvider
  maxResults: number
  custom: CustomWebSearchConfig
}

export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = {
  enabled: true,
  mode: 'auto',
  localProvider: 'duckduckgo',
  maxResults: 8,
  custom: {
    endpoint: '',
    method: 'GET',
    apiKey: '',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    queryParam: 'q',
    headers: {},
    bodyTemplate: '',
    resultsPath: 'results',
    titlePath: 'title',
    urlPath: 'url',
    snippetPath: 'snippet',
  },
}

export function readWebSearchConfig(): WebSearchConfig {
  const raw = getInitialSettings().webSearch
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_WEB_SEARCH_CONFIG }
  }
  const candidate = raw as Partial<WebSearchConfig>
  const mode = isWebSearchMode(candidate.mode)
    ? candidate.mode
    : DEFAULT_WEB_SEARCH_CONFIG.mode
  const maxResults = typeof candidate.maxResults === 'number'
    ? Math.max(1, Math.min(20, Math.floor(candidate.maxResults)))
    : DEFAULT_WEB_SEARCH_CONFIG.maxResults
  return {
    enabled: candidate.enabled !== false && mode !== 'off',
    mode,
    localProvider: isLocalWebSearchProvider(candidate.localProvider)
      ? candidate.localProvider
      : DEFAULT_WEB_SEARCH_CONFIG.localProvider,
    maxResults,
    custom: normalizeCustomWebSearchConfig(candidate.custom),
  }
}

export function updateWebSearchConfig(
  patch: Partial<WebSearchConfig>,
): { config: WebSearchConfig; error: Error | null } {
  const config = normalizeWebSearchConfig({
    ...readWebSearchConfig(),
    ...patch,
  })
  const { error } = updateSettingsForSource('userSettings', {
    webSearch: config,
  } as SettingsJson)
  return { config, error }
}

export function webSearchCanUseAnthropicServerTool(): boolean {
  const config = readWebSearchConfig()
  return config.enabled && config.mode !== 'local' && config.mode !== 'off'
}

export function webSearchShouldUseLocalFallback(
  activeProviderNeedsFallback: boolean,
): boolean {
  const config = readWebSearchConfig()
  if (!config.enabled || config.mode === 'off') return false
  if (config.mode === 'local') return true
  if (config.mode === 'anthropic') return false
  return activeProviderNeedsFallback
}

export function webSearchIsEnabledForProvider(
  providerSupportsAnthropicWebSearch: boolean,
): boolean {
  const config = readWebSearchConfig()
  if (!config.enabled || config.mode === 'off') return false
  if (config.mode === 'local') return true
  if (config.mode === 'anthropic') return providerSupportsAnthropicWebSearch
  return providerSupportsAnthropicWebSearch || config.localProvider === 'duckduckgo' || config.localProvider === 'custom'
}

function normalizeWebSearchConfig(config: WebSearchConfig): WebSearchConfig {
  const mode = isWebSearchMode(config.mode) ? config.mode : 'auto'
  return {
    enabled: config.enabled !== false && mode !== 'off',
    mode,
    localProvider: isLocalWebSearchProvider(config.localProvider)
      ? config.localProvider
      : 'duckduckgo',
    maxResults: Math.max(1, Math.min(20, Math.floor(config.maxResults || 8))),
    custom: normalizeCustomWebSearchConfig(config.custom),
  }
}

function isWebSearchMode(value: unknown): value is WebSearchMode {
  return value === 'auto' || value === 'anthropic' || value === 'local' || value === 'off'
}

function isLocalWebSearchProvider(value: unknown): value is LocalWebSearchProvider {
  return value === 'duckduckgo' || value === 'custom'
}

function normalizeCustomWebSearchConfig(value: unknown): CustomWebSearchConfig {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<CustomWebSearchConfig>
    : {}
  const method = input.method === 'POST' ? 'POST' : 'GET'
  return {
    endpoint: typeof input.endpoint === 'string' ? input.endpoint.trim() : '',
    method,
    apiKey: typeof input.apiKey === 'string' ? input.apiKey : '',
    authHeader: typeof input.authHeader === 'string' && input.authHeader.trim()
      ? input.authHeader.trim()
      : 'Authorization',
    authPrefix: typeof input.authPrefix === 'string' ? input.authPrefix.trim() : 'Bearer',
    queryParam: typeof input.queryParam === 'string' && input.queryParam.trim()
      ? input.queryParam.trim()
      : 'q',
    headers: normalizeHeaders(input.headers),
    bodyTemplate: typeof input.bodyTemplate === 'string' ? input.bodyTemplate : '',
    resultsPath: typeof input.resultsPath === 'string' && input.resultsPath.trim()
      ? input.resultsPath.trim()
      : 'results',
    titlePath: typeof input.titlePath === 'string' && input.titlePath.trim()
      ? input.titlePath.trim()
      : 'title',
    urlPath: typeof input.urlPath === 'string' && input.urlPath.trim()
      ? input.urlPath.trim()
      : 'url',
    snippetPath: typeof input.snippetPath === 'string' ? input.snippetPath.trim() : 'snippet',
  }
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, headerValue] of Object.entries(value)) {
    if (!key.trim() || typeof headerValue !== 'string') continue
    result[key.trim()] = headerValue
  }
  return result
}

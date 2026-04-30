import type { LocalCommandCall } from '../../types/command.js'
import {
  readWebSearchConfig,
  updateWebSearchConfig,
  type LocalWebSearchProvider,
  type WebSearchMode,
} from '../../webSearch/settings.js'
import { getSettingsFilePathForSource } from '../../utils/settings/settings.js'
import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from '../../utils/model/providers.js'

export const call: LocalCommandCall = async (args) => {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const [action, value] = tokens

  if (!action || action === 'status') {
    return text(formatStatus())
  }

  if (action === 'on' || action === 'enable') {
    const { error } = updateWebSearchConfig({ enabled: true, mode: 'auto' })
    if (error) return text(`Web Search save failed: ${error.message}`)
    return text(formatStatus('Web Search enabled.'))
  }

  if (action === 'off' || action === 'disable') {
    const { error } = updateWebSearchConfig({ enabled: false, mode: 'off' })
    if (error) return text(`Web Search save failed: ${error.message}`)
    return text(formatStatus('Web Search disabled.'))
  }

  if (action === 'mode') {
    if (!isMode(value)) {
      return text('Usage: /web-search mode auto|anthropic|local|off')
    }
    const { error } = updateWebSearchConfig({
      mode: value,
      enabled: value !== 'off',
    })
    if (error) return text(`Web Search save failed: ${error.message}`)
    return text(formatStatus(`Web Search mode set to ${value}.`))
  }

  if (action === 'max' || action === 'max-results') {
    const maxResults = Number.parseInt(value ?? '', 10)
    if (!Number.isFinite(maxResults) || maxResults < 1 || maxResults > 20) {
      return text('Usage: /web-search max <1-20>')
    }
    const { error } = updateWebSearchConfig({ maxResults })
    if (error) return text(`Web Search save failed: ${error.message}`)
    return text(formatStatus(`Web Search max results set to ${maxResults}.`))
  }

  if (action === 'provider') {
    if (!isProvider(value)) {
      return text('Usage: /web-search provider duckduckgo|custom')
    }
    const { error } = updateWebSearchConfig({ localProvider: value })
    if (error) return text(`Web Search save failed: ${error.message}`)
    return text(formatStatus(`Web Search local provider set to ${value}.`))
  }

  if (action === 'endpoint') {
    const endpoint = tokens.slice(1).join(' ').trim()
    if (!endpoint) return text('Usage: /web-search endpoint <https://search-api.example.com/search>')
    const current = readWebSearchConfig()
    const { error } = updateWebSearchConfig({
      localProvider: 'custom',
      custom: { ...current.custom, endpoint },
    })
    if (error) return text(`Web Search save failed: ${error.message}`)
    return text(formatStatus('Custom web search endpoint saved.'))
  }

  if (action === 'key' || action === 'api-key') {
    const apiKey = tokens.slice(1).join(' ').trim()
    if (!apiKey) return text('Usage: /web-search key <api-key>')
    const current = readWebSearchConfig()
    const { error } = updateWebSearchConfig({
      localProvider: 'custom',
      custom: { ...current.custom, apiKey },
    })
    if (error) return text(`Web Search save failed: ${error.message}`)
    return text(formatStatus('Custom web search API key saved.'))
  }

  if (action === 'method') {
    const method = value?.toUpperCase()
    if (method !== 'GET' && method !== 'POST') return text('Usage: /web-search method GET|POST')
    const current = readWebSearchConfig()
    const { error } = updateWebSearchConfig({
      localProvider: 'custom',
      custom: { ...current.custom, method },
    })
    if (error) return text(`Web Search save failed: ${error.message}`)
    return text(formatStatus(`Custom web search method set to ${method}.`))
  }

  if (action === 'auth-header') {
    if (!value) return text('Usage: /web-search auth-header Authorization|X-API-Key|...')
    const current = readWebSearchConfig()
    const { error } = updateWebSearchConfig({
      localProvider: 'custom',
      custom: { ...current.custom, authHeader: value },
    })
    if (error) return text(`Web Search save failed: ${error.message}`)
    return text(formatStatus(`Custom web search auth header set to ${value}.`))
  }

  if (action === 'auth-prefix') {
    const prefix = tokens.slice(1).join(' ')
    const current = readWebSearchConfig()
    const { error } = updateWebSearchConfig({
      localProvider: 'custom',
      custom: { ...current.custom, authPrefix: prefix },
    })
    if (error) return text(`Web Search save failed: ${error.message}`)
    return text(formatStatus(`Custom web search auth prefix set to ${prefix || '(empty)'}.`))
  }

  if (action === 'paths') {
    const [resultsPath, titlePath, urlPath, snippetPath] = tokens.slice(1)
    if (!resultsPath || !titlePath || !urlPath) {
      return text('Usage: /web-search paths <resultsPath> <titlePath> <urlPath> [snippetPath]')
    }
    const current = readWebSearchConfig()
    const { error } = updateWebSearchConfig({
      localProvider: 'custom',
      custom: {
        ...current.custom,
        resultsPath,
        titlePath,
        urlPath,
        snippetPath: snippetPath ?? current.custom.snippetPath,
      },
    })
    if (error) return text(`Web Search save failed: ${error.message}`)
    return text(formatStatus('Custom web search JSON paths saved.'))
  }

  return text([
    'Usage:',
    '/web-search status',
    '/web-search on',
    '/web-search off',
    '/web-search mode auto|anthropic|local|off',
    '/web-search provider duckduckgo|custom',
    '/web-search max <1-20>',
    '/web-search endpoint <url>',
    '/web-search key <api-key>',
    '/web-search method GET|POST',
    '/web-search auth-header Authorization|X-API-Key',
    '/web-search auth-prefix Bearer',
    '/web-search paths <resultsPath> <titlePath> <urlPath> [snippetPath]',
    '',
    'mode=auto uses Anthropic server-side web_search when available and your local provider fallback for OpenAI-compatible/custom providers.',
  ].join('\n'))
}

function formatStatus(prefix?: string): string {
  const config = readWebSearchConfig()
  const provider = getAPIProvider()
  const needsFallback = process.env.CLAUDE_CODE_COMPAT_PROVIDER === 'openai' || !isFirstPartyAnthropicBaseUrl()
  const effective = !config.enabled || config.mode === 'off'
    ? 'disabled'
    : config.mode === 'local' || (config.mode === 'auto' && needsFallback)
      ? `local ${config.localProvider} provider`
      : 'Anthropic server-side web_search'
  return [
    ...(prefix ? [prefix, ''] : []),
    `Web Search: ${config.enabled ? 'on' : 'off'}`,
    `Mode: ${config.mode}`,
    `Local provider: ${config.localProvider}`,
    `Max results: ${config.maxResults}`,
    ...(config.localProvider === 'custom'
      ? [
          `Custom endpoint: ${config.custom.endpoint || '(not set)'}`,
          `Custom method: ${config.custom.method}`,
          `Auth header: ${config.custom.authHeader}${config.custom.apiKey ? ' (key set)' : ' (key not set)'}`,
          `Result paths: ${config.custom.resultsPath} / ${config.custom.titlePath} / ${config.custom.urlPath}`,
        ]
      : []),
    `Active API provider: ${provider}`,
    `Effective path: ${effective}`,
    `Settings file: ${getSettingsFilePathForSource('userSettings') ?? '~/.claude-yh/settings.json'}`,
  ].join('\n')
}

function isMode(value: string | undefined): value is WebSearchMode {
  return value === 'auto' || value === 'anthropic' || value === 'local' || value === 'off'
}

function isProvider(value: string | undefined): value is LocalWebSearchProvider {
  return value === 'duckduckgo' || value === 'custom'
}

function text(value: string) {
  return { type: 'text' as const, value }
}

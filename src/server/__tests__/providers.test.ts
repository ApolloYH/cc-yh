// @ts-nocheck
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ProviderService } from '../services/providerService.js'
import { handleProvidersApi } from '../api/providers.js'

let tmpDir: string
let originalConfigDir: string | undefined

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
}

async function teardown() {
  if (originalConfigDir !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.CLAUDE_CONFIG_DIR
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
}

function sampleInput(overrides: Record<string, unknown> = {}) {
  return {
    presetId: 'custom',
    name: 'Test Provider',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test-key-123',
    apiFormat: 'anthropic',
    models: {
      main: 'model-main',
      haiku: 'model-haiku',
      sonnet: 'model-sonnet',
      opus: 'model-opus',
    },
    ...overrides,
  }
}

function makeRequest(method: string, urlStr: string, body?: Record<string, unknown>) {
  const url = new URL(urlStr, 'http://localhost:3456')
  const init: RequestInit = { method }
  if (body) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const req = new Request(url.toString(), init)
  const segments = url.pathname.split('/').filter(Boolean)
  return { req, url, segments }
}

async function readCcHahaSettings() {
  const raw = await fs.readFile(
    path.join(tmpDir, 'claude-yh', 'settings.json'),
    'utf-8',
  )
  return JSON.parse(raw)
}

async function readProvidersIndex() {
  const raw = await fs.readFile(
    path.join(tmpDir, 'claude-yh', 'providers.json'),
    'utf-8',
  )
  return JSON.parse(raw)
}

describe('ProviderService', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('listProviders returns index shape', async () => {
    const svc = new ProviderService()
    await expect(svc.listProviders()).resolves.toEqual({
      providers: [],
      activeId: null,
    })
  })

  test('addProvider persists provider but does not auto-activate', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(sampleInput())
    const result = await svc.listProviders()

    expect(provider.id).toBeDefined()
    expect(provider.apiFormat).toBe('anthropic')
    expect(provider.models.main).toBe('model-main')
    expect(result.activeId).toBeNull()
    expect(result.providers).toHaveLength(1)
  })

  test('activateProvider writes env into claude-yh/settings.json', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(sampleInput())
    await svc.activateProvider(provider.id)

    const index = await svc.listProviders()
    const settings = await readCcHahaSettings()
    const env = settings.env

    expect(index.activeId).toBe(provider.id)
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.example.com')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test-key-123')
    expect(env.ANTHROPIC_MODEL).toBe('model-main')
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('model-haiku')
  })

  test('updateProvider re-syncs active provider env', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(sampleInput())
    await svc.activateProvider(provider.id)
    await svc.updateProvider(provider.id, {
      baseUrl: 'https://new-api.example.com',
      apiKey: 'sk-new-key',
    })

    const settings = await readCcHahaSettings()
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://new-api.example.com')
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-new-key')
  })

  test('deleteProvider rejects deleting active provider', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(sampleInput())
    await svc.activateProvider(provider.id)

    await expect(svc.deleteProvider(provider.id)).rejects.toMatchObject({
      statusCode: 409,
    })
  })

  test('activateOfficial clears provider env and activeId', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(sampleInput())
    await svc.activateProvider(provider.id)
    await svc.activateOfficial()

    const settings = await readCcHahaSettings()
    const index = await readProvidersIndex()
    expect(index.activeId).toBeNull()
    expect(settings.env).toBeUndefined()
  })

  test('openai provider writes compat env flags', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(
      sampleInput({
        apiFormat: 'openai_chat',
      }),
    )
    await svc.activateProvider(provider.id)
    const settings = await readCcHahaSettings()

    expect(settings.env.CLAUDE_CODE_COMPAT_PROVIDER).toBe('openai')
    expect(settings.env.CLAUDE_CODE_OPENAI_COMPAT_MODE).toBe(
      'chat_completions',
    )
  })

  test('testProviderConfig avoids duplicate /v1 when base already includes /v1', async () => {
    const svc = new ProviderService()
    const originalFetch = globalThis.fetch
    const calledUrls: string[] = []

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrls.push(String(input))
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          model: 'gpt-4o',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' } }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }) as typeof fetch

    try {
      const result = await svc.testProviderConfig({
        baseUrl: 'https://api.minimaxi.com/v1',
        apiKey: 'sk-test',
        modelId: 'MiniMax-M2.7',
        apiFormat: 'openai_chat',
      })

      expect(result.connectivity.success).toBe(true)
      expect(result.proxy?.success).toBe(true)
      expect(calledUrls).toEqual([
        'https://api.minimaxi.com/v1/chat/completions',
        'https://api.minimaxi.com/v1/chat/completions',
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('testProviderConfig adds /v1 when base omits version segment', async () => {
    const svc = new ProviderService()
    const originalFetch = globalThis.fetch
    const calledUrls: string[] = []

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrls.push(String(input))
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          model: 'gpt-4o',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' } }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }) as typeof fetch

    try {
      const result = await svc.testProviderConfig({
        baseUrl: 'https://api.minimaxi.com',
        apiKey: 'sk-test',
        modelId: 'MiniMax-M2.7',
        apiFormat: 'openai_chat',
      })

      expect(result.connectivity.success).toBe(true)
      expect(result.proxy?.success).toBe(true)
      expect(calledUrls).toEqual([
        'https://api.minimaxi.com/v1/chat/completions',
        'https://api.minimaxi.com/v1/chat/completions',
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('Providers API', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('POST /api/providers creates a provider', async () => {
    const { req, url, segments } = makeRequest(
      'POST',
      '/api/providers',
      sampleInput(),
    )
    const res = await handleProvidersApi(req, url, segments)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.provider.name).toBe('Test Provider')
  })

  test('GET /api/providers returns {providers, activeId}', async () => {
    const svc = new ProviderService()
    await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest('GET', '/api/providers')
    const res = await handleProvidersApi(req, url, segments)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.providers).toHaveLength(1)
    expect(body.activeId).toBeNull()
  })

  test('POST /api/providers/:id/activate activates a provider', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest(
      'POST',
      `/api/providers/${provider.id}/activate`,
    )
    const res = await handleProvidersApi(req, url, segments)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect((await svc.listProviders()).activeId).toBe(provider.id)
  })
})

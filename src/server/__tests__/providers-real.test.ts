import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ProviderService } from '../services/providerService.js'

const MODEL_MAPPING = {
  main: 'MiniMax-M2.7-highspeed',
  haiku: 'MiniMax-M2.7-highspeed',
  sonnet: 'MiniMax-M2.7-highspeed',
  opus: 'MiniMax-M2.7-highspeed',
}

describe('ProviderService unified settings storage', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined
  let service: ProviderService

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-real-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    service = new ProviderService()
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function readSettings(): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(path.join(tmpDir, 'settings.json'), 'utf-8')
    return JSON.parse(raw) as Record<string, unknown>
  }

  test('adds and activates MiniMax in unified settings.json', async () => {
    const minimax = await service.addProvider({
      presetId: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-fake-test-key-for-testing-only',
      apiFormat: 'anthropic',
      models: MODEL_MAPPING,
      notes: 'MiniMax official Anthropic compatible endpoint',
    })

    await service.activateProvider(minimax.id)

    const settings = await readSettings()
    const env = settings.env as Record<string, string>
    const index = settings.claudeYhProviders as { activeId: string; providers: unknown[] }

    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.minimaxi.com/anthropic')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-fake-test-key-for-testing-only')
    expect(env.ANTHROPIC_MODEL).toBe('MiniMax-M2.7-highspeed')
    expect(index.activeId).toBe(minimax.id)
    expect(index.providers).toHaveLength(1)
  })

  test('switching provider updates env but keeps provider index', async () => {
    const minimax = await service.addProvider({
      presetId: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-api-test-minimax',
      apiFormat: 'anthropic',
      models: MODEL_MAPPING,
    })

    const custom = await service.addProvider({
      presetId: 'custom',
      name: 'Custom Anthropic',
      baseUrl: 'https://api.example.com/anthropic',
      apiKey: 'sk-custom',
      apiFormat: 'anthropic',
      models: {
        main: 'claude-opus-4-7',
        haiku: 'claude-haiku-4-5',
        sonnet: 'claude-sonnet-4-6',
        opus: 'claude-opus-4-7',
      },
    })

    await service.activateProvider(minimax.id)
    await service.activateProvider(custom.id)

    const settings = await readSettings()
    const env = settings.env as Record<string, string>
    const index = settings.claudeYhProviders as { activeId: string; providers: unknown[] }

    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.example.com/anthropic')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-custom')
    expect(env.ANTHROPIC_MODEL).toBe('claude-opus-4-7')
    expect(index.activeId).toBe(custom.id)
    expect(index.providers).toHaveLength(2)
  })

  test('preserves existing settings fields and non-provider env', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify(
        {
          customField: 'should_be_preserved',
          env: {
            EXISTING_VAR: 'should_be_preserved',
          },
        },
        null,
        2,
      ),
    )

    const provider = await service.addProvider({
      presetId: 'custom',
      name: 'Custom Anthropic',
      baseUrl: 'https://api.example.com/anthropic',
      apiKey: 'sk-test',
      apiFormat: 'anthropic',
      models: {
        main: 'claude-opus-4-7',
        haiku: 'claude-haiku-4-5',
        sonnet: 'claude-sonnet-4-6',
        opus: 'claude-opus-4-7',
      },
    })
    await service.activateProvider(provider.id)

    const settings = await readSettings()
    const env = settings.env as Record<string, string>
    expect(settings.customField).toBe('should_be_preserved')
    expect(env.EXISTING_VAR).toBe('should_be_preserved')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.example.com/anthropic')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test')
  })

  test('activateOfficial clears provider env but keeps provider index', async () => {
    const provider = await service.addProvider({
      presetId: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-test',
      apiFormat: 'anthropic',
      models: MODEL_MAPPING,
    })

    await service.activateProvider(provider.id)
    await service.activateOfficial()

    const settings = await readSettings()
    const env = settings.env as Record<string, string> | undefined
    const index = settings.claudeYhProviders as { activeId: string | null; providers: unknown[] }

    expect(env?.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env?.ANTHROPIC_MODEL).toBeUndefined()
    expect(index.activeId).toBeNull()
    expect(index.providers).toHaveLength(1)
  })

  test('testProviderConfig returns the expected shape', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          type: 'message',
          model: 'MiniMax-M2.7-highspeed',
          content: [{ type: 'text', text: 'ok' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )) as unknown as typeof fetch

    try {
      const result = await service.testProviderConfig({
        baseUrl: 'https://api.minimaxi.com/anthropic',
        apiKey: 'sk-fake-test-key',
        modelId: 'MiniMax-M2.7-highspeed',
        apiFormat: 'anthropic',
      })

      expect(result.connectivity.success).toBe(true)
      expect(result.connectivity.modelUsed).toBe('MiniMax-M2.7-highspeed')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('migrates legacy claude-yh provider files into unified settings.json', async () => {
    const legacyDir = path.join(tmpDir, 'claude-yh')
    await fs.mkdir(legacyDir, { recursive: true })
    await fs.writeFile(
      path.join(legacyDir, 'providers.json'),
      JSON.stringify({
        activeId: 'legacy-provider',
        providers: [
          {
            id: 'legacy-provider',
            presetId: 'minimax',
            name: 'MiniMax',
            baseUrl: 'https://api.minimaxi.com/anthropic',
            apiKey: 'sk-legacy',
            apiFormat: 'anthropic',
            models: MODEL_MAPPING,
          },
        ],
      }),
    )
    await fs.writeFile(
      path.join(legacyDir, 'settings.json'),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic',
          ANTHROPIC_AUTH_TOKEN: 'sk-legacy',
          ANTHROPIC_MODEL: 'MiniMax-M2.7-highspeed',
        },
      }),
    )

    const list = await service.listProviders()
    const settings = await readSettings()

    expect(list.activeId).toBe('legacy-provider')
    expect(list.providers).toHaveLength(1)
    expect((settings.env as Record<string, string>).ANTHROPIC_AUTH_TOKEN).toBe('sk-legacy')
    expect((settings.claudeYhProviders as { activeId: string }).activeId).toBe('legacy-provider')
  })
})

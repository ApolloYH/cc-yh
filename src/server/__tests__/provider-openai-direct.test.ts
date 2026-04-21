import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ProviderService } from '../services/providerService.js'

describe('ProviderService direct OpenAI compat env sync', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined
  let service: ProviderService

  const openAIModels = {
    main: 'gpt-4o',
    haiku: 'gpt-4o-mini',
    sonnet: 'gpt-4o',
    opus: 'gpt-4o',
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-yh-openai-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    service = new ProviderService()
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function readSettings() {
    const raw = await fs.readFile(
      path.join(tmpDir, 'claude-yh', 'settings.json'),
      'utf-8',
    )
    return JSON.parse(raw) as { env?: Record<string, string> }
  }

  test('openai_chat writes direct compat env', async () => {
    const provider = await service.addProvider({
      presetId: 'openai',
      name: 'OpenAI Chat',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-chat-test',
      apiFormat: 'openai_chat',
      models: openAIModels,
    })

    await service.activateProvider(provider.id)
    const settings = await readSettings()

    expect(settings.env?.ANTHROPIC_BASE_URL).toBe('https://api.openai.com/v1')
    expect(settings.env?.ANTHROPIC_AUTH_TOKEN).toBe('sk-chat-test')
    expect(settings.env?.CLAUDE_CODE_COMPAT_PROVIDER).toBe('openai')
    expect(settings.env?.CLAUDE_CODE_OPENAI_COMPAT_MODE).toBe(
      'chat_completions',
    )
  })

  test('openai_responses writes direct compat env', async () => {
    const provider = await service.addProvider({
      presetId: 'openai',
      name: 'OpenAI Responses',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-responses-test',
      apiFormat: 'openai_responses',
      models: openAIModels,
    })

    await service.activateProvider(provider.id)
    const settings = await readSettings()

    expect(settings.env?.ANTHROPIC_BASE_URL).toBe('https://api.openai.com/v1')
    expect(settings.env?.ANTHROPIC_AUTH_TOKEN).toBe('sk-responses-test')
    expect(settings.env?.CLAUDE_CODE_COMPAT_PROVIDER).toBe('openai')
    expect(settings.env?.CLAUDE_CODE_OPENAI_COMPAT_MODE).toBe('responses')
  })

  test('anthropic activation clears compat env', async () => {
    const openAIProvider = await service.addProvider({
      presetId: 'openai',
      name: 'OpenAI Chat',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-chat-test',
      apiFormat: 'openai_chat',
      models: openAIModels,
    })
    await service.activateProvider(openAIProvider.id)

    const anthropicProvider = await service.addProvider({
      presetId: 'anthropic',
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-test',
      apiFormat: 'anthropic',
      models: {
        main: 'claude-sonnet-4-5',
        haiku: 'claude-haiku-4-5',
        sonnet: 'claude-sonnet-4-5',
        opus: 'claude-opus-4-1',
      },
    })
    await service.activateProvider(anthropicProvider.id)

    const settings = await readSettings()

    expect(settings.env?.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com')
    expect(settings.env?.ANTHROPIC_AUTH_TOKEN).toBe('sk-ant-test')
    expect(settings.env?.CLAUDE_CODE_COMPAT_PROVIDER).toBeUndefined()
    expect(settings.env?.CLAUDE_CODE_OPENAI_COMPAT_MODE).toBeUndefined()
  })
})

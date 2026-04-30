import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { ConversationService } from '../services/conversationService.js'

describe('ConversationService', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined
  let originalAuthToken: string | undefined
  let originalBaseUrl: string | undefined
  let originalModel: string | undefined
  let originalEntrypoint: string | undefined
  let originalOAuthToken: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-yh-conversation-service-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalAuthToken = process.env.ANTHROPIC_AUTH_TOKEN
    originalBaseUrl = process.env.ANTHROPIC_BASE_URL
    originalModel = process.env.ANTHROPIC_MODEL
    originalEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
    originalOAuthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN

    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.ANTHROPIC_AUTH_TOKEN = 'test-token'
    process.env.ANTHROPIC_BASE_URL = 'https://example.invalid/anthropic'
    process.env.ANTHROPIC_MODEL = 'test-model'
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'inherited-parent-oauth-token'
    // Clear inherited CLAUDE_CODE_ENTRYPOINT so tests can assert whether
    // buildChildEnv injects it or not without interference from the shell env.
    delete process.env.CLAUDE_CODE_ENTRYPOINT
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir

    if (originalAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN
    else process.env.ANTHROPIC_AUTH_TOKEN = originalAuthToken

    if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = originalBaseUrl

    if (originalModel === undefined) delete process.env.ANTHROPIC_MODEL
    else process.env.ANTHROPIC_MODEL = originalModel

    if (originalEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
    else process.env.CLAUDE_CODE_ENTRYPOINT = originalEntrypoint

    if (originalOAuthToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = originalOAuthToken

    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('keeps inherited provider env when no desktop provider config exists', async () => {
    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('D:\\workspace\\code\\myself_code\\claude-yh')) as Record<string, string>

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('test-token')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.invalid/anthropic')
    expect(env.ANTHROPIC_MODEL).toBe('test-model')
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })

  test('injects desktop provider env and strips stale inherited provider env', async () => {
    const ccHahaDir = path.join(tmpDir, 'claude-yh')
    await fs.mkdir(ccHahaDir, { recursive: true })
    await fs.writeFile(
      path.join(ccHahaDir, 'settings.json'),
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: 'desktop-provider-token',
          ANTHROPIC_BASE_URL: 'https://desktop-provider.invalid',
          ANTHROPIC_MODEL: 'desktop-provider-model',
          CLAUDE_CODE_COMPAT_PROVIDER: 'openai',
          CLAUDE_CODE_OPENAI_COMPAT_MODE: 'responses',
        },
      }),
      'utf-8',
    )

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('D:\\workspace\\code\\myself_code\\claude-yh')) as Record<string, string>

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('desktop-provider-token')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://desktop-provider.invalid')
    expect(env.ANTHROPIC_MODEL).toBe('desktop-provider-model')
    expect(env.CLAUDE_CODE_COMPAT_PROVIDER).toBe('openai')
    expect(env.CLAUDE_CODE_OPENAI_COMPAT_MODE).toBe('responses')
    expect(env.CLAUDE_YH_SKIP_DOTENV).toBe('1')
  })

  test('buildChildEnv injects CLAUDE_CODE_OAUTH_TOKEN when official mode + haha oauth token exists', async () => {
    const ccHahaDir = path.join(tmpDir, 'claude-yh')
    await fs.mkdir(ccHahaDir, { recursive: true })
    await fs.writeFile(
      path.join(ccHahaDir, 'settings.json'),
      JSON.stringify({ env: {} }),
      'utf-8',
    )

    const { hahaOAuthService } = await import('../services/hahaOAuthService.js')
    await hahaOAuthService.saveTokens({
      accessToken: 'haha-fresh-token',
      refreshToken: 'haha-refresh-xxx',
      expiresAt: Date.now() + 30 * 60_000,
      scopes: ['user:inference'],
      subscriptionType: 'max',
    })

    const service = new ConversationService() as any
    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.ANTHROPIC_MODEL
    const env = (await service.buildChildEnv('/tmp')) as Record<string, string>

    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe('claude-desktop')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('haha-fresh-token')
  })

  test('buildChildEnv does NOT inject CLAUDE_CODE_OAUTH_TOKEN when not official mode', async () => {
    const ccHahaDir = path.join(tmpDir, 'claude-yh')
    await fs.mkdir(ccHahaDir, { recursive: true })
    await fs.writeFile(
      path.join(ccHahaDir, 'settings.json'),
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'custom-provider-token' } }),
      'utf-8',
    )

    const { hahaOAuthService } = await import('../services/hahaOAuthService.js')
    await hahaOAuthService.saveTokens({
      accessToken: 'haha-token-should-not-be-used',
      refreshToken: null,
      expiresAt: null,
      scopes: [],
      subscriptionType: null,
    })

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp')) as Record<string, string>

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
  })

  test('buildChildEnv does not leak inherited CLAUDE_CODE_OAUTH_TOKEN when official token is unavailable', async () => {
    const ccHahaDir = path.join(tmpDir, 'claude-yh')
    await fs.mkdir(ccHahaDir, { recursive: true })
    await fs.writeFile(
      path.join(ccHahaDir, 'settings.json'),
      JSON.stringify({ env: {} }),
      'utf-8',
    )

    const service = new ConversationService() as any
    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.ANTHROPIC_MODEL
    const env = (await service.buildChildEnv('/tmp')) as Record<string, string>

    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe('claude-desktop')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })

  test('does not mark managed OAuth when desktop settings are empty but inherited env auth exists', async () => {
    const ccHahaDir = path.join(tmpDir, 'claude-yh')
    await fs.mkdir(ccHahaDir, { recursive: true })
    await fs.writeFile(
      path.join(ccHahaDir, 'settings.json'),
      JSON.stringify({ env: {} }),
      'utf-8',
    )

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp')) as Record<string, string>

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('test-token')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.invalid/anthropic')
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })

  test('uses bun entrypoint fallback on Windows dev mode', () => {
    const service = new ConversationService() as any
    const args = service.resolveCliArgs(['--print'])

    if (process.platform === 'win32') {
      expect(args[0]).toBe(process.execPath)
      expect(args[1]).toBe('--preload')
      expect(args[2]).toContain(path.join('preload.ts'))
      expect(args[3]).toContain(path.join('src', 'entrypoints', 'cli.tsx'))
    } else {
      expect(args[0]).toContain(path.join('bin', 'claude-yh'))
    }
  })
})

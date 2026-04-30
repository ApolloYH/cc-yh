import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getAutoMemPath } from '../../memdir/paths.js'
import { runMemoryV2Automation } from '../../memoryV2/automation.js'
import { writeMemoryFact } from '../../memoryV2/store.js'
import { handleMemoryV2Api } from '../api/memory-v2.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalMemoryOverride: string | undefined
let originalEmbeddingApiKey: string | undefined
let originalEmbeddingProvider: string | undefined
let originalDisableMainModel: string | undefined

describe('MemoryV2 API', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-v2-api-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalMemoryOverride = process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
    originalEmbeddingApiKey = process.env.CLAUDE_YH_EMBEDDING_API_KEY
    originalEmbeddingProvider = process.env.CLAUDE_YH_EMBEDDING_PROVIDER
    originalDisableMainModel = process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = path.join(tmpDir, 'project-memory')
    delete process.env.CLAUDE_YH_EMBEDDING_API_KEY
    delete process.env.CLAUDE_YH_EMBEDDING_PROVIDER
    process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION = '1'
    getAutoMemPath.cache.clear?.()
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    if (originalMemoryOverride === undefined) delete process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
    else process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = originalMemoryOverride
    if (originalEmbeddingApiKey === undefined) delete process.env.CLAUDE_YH_EMBEDDING_API_KEY
    else process.env.CLAUDE_YH_EMBEDDING_API_KEY = originalEmbeddingApiKey
    if (originalEmbeddingProvider === undefined) delete process.env.CLAUDE_YH_EMBEDDING_PROVIDER
    else process.env.CLAUDE_YH_EMBEDDING_PROVIDER = originalEmbeddingProvider
    if (originalDisableMainModel === undefined) delete process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION
    else process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION = originalDisableMainModel
    getAutoMemPath.cache.clear?.()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('serves automatically written L2 facts through the API', async () => {
    await writeMemoryFact({
      title: 'Away safety rule',
      content: 'Pause before external sending.',
      verified: true,
      source: 'test-automation',
    })

    const statusReq = new Request('http://localhost/api/memory-v2')
    const statusUrl = new URL(statusReq.url)
    const statusResponse = await handleMemoryV2Api(statusReq, statusUrl, [
      'api',
      'memory-v2',
    ])
    const status = await statusResponse.json()
    expect(status.entries).toHaveLength(1)
    expect(status.facts).toHaveLength(1)
    expect(status.sops).toHaveLength(0)
    expect(status.indexPath).toBe(path.join(tmpDir, 'project-memory', 'MEMORY.md'))
  })

  it('serves memory view/search APIs while extraction stays automatic-only', async () => {
    await fs.mkdir(path.join(tmpDir, 'projects', 'repo-a'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'projects', 'repo-a', 'session-browser.jsonl'),
      JSON.stringify({
        type: 'user',
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: 'Browser memory workflow test' },
      }),
      'utf-8',
    )

    await runMemoryV2Automation({ sessionId: 'session-browser', limit: 3 })

    const searchReq = new Request('http://localhost/api/memory-v2/search?q=browser')
    const search = await handleMemoryV2Api(searchReq, new URL(searchReq.url), [
      'api',
      'memory-v2',
      'search',
    ])
    const searchBody = await search.json()
    expect(searchBody.results.length).toBeGreaterThan(0)

    const entryReq = new Request('http://localhost/api/memory-v2/entry/L1/index')
    const entry = await handleMemoryV2Api(entryReq, new URL(entryReq.url), [
      'api',
      'memory-v2',
      'entry',
      'L1',
      'index',
    ])
    expect(entry.status).toBe(200)

    const summarizeReq = new Request('http://localhost/api/memory-v2/summarize', {
      method: 'POST',
      body: JSON.stringify({ limit: 3 }),
    })
    const summarize = await handleMemoryV2Api(summarizeReq, new URL(summarizeReq.url), [
      'api',
      'memory-v2',
      'summarize',
    ])
    expect(summarize.status).toBe(405)

    const staleReq = new Request('http://localhost/api/memory-v2/stale')
    const stale = await handleMemoryV2Api(staleReq, new URL(staleReq.url), [
      'api',
      'memory-v2',
      'stale',
    ])
    expect(stale.status).toBe(405)

    const distillReq = new Request('http://localhost/api/memory-v2/distill', {
      method: 'POST',
      body: JSON.stringify({ limit: 3 }),
    })
    const distill = await handleMemoryV2Api(distillReq, new URL(distillReq.url), [
      'api',
      'memory-v2',
      'distill',
    ])
    expect(distill.status).toBe(405)

    const factReq = new Request('http://localhost/api/memory-v2/fact', {
      method: 'POST',
      body: JSON.stringify({ title: 'manual', content: 'manual' }),
    })
    const fact = await handleMemoryV2Api(factReq, new URL(factReq.url), [
      'api',
      'memory-v2',
      'fact',
    ])
    expect(fact.status).toBe(405)
  })

  it('updates embedding provider settings without echoing the API key', async () => {
    const req = new Request('http://localhost/api/memory-v2/embedding', {
      method: 'PUT',
      body: JSON.stringify({
        provider: 'dashscope',
        baseUrl: 'http://127.0.0.1:12345/v1',
        model: 'text-embedding-v4',
        dimensions: 1024,
        apiKey: 'secret-test-key',
      }),
    })
    const response = await handleMemoryV2Api(req, new URL(req.url), [
      'api',
      'memory-v2',
      'embedding',
    ])
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.config.hasApiKey).toBe(true)
    expect(JSON.stringify(body)).not.toContain('secret-test-key')

    const raw = await fs.readFile(path.join(tmpDir, 'settings.json'), 'utf-8')
    expect(raw).toContain('secret-test-key')
  })

  it('serves memory extraction diagnostic events', async () => {
    const req = new Request('http://localhost/api/memory-v2/events?limit=5')
    const response = await handleMemoryV2Api(req, new URL(req.url), [
      'api',
      'memory-v2',
      'events',
    ])
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(typeof body.path).toBe('string')
    expect(Array.isArray(body.events)).toBe(true)
  })
})

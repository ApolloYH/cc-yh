import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleMemoryV2Api } from '../api/memory-v2.js'

let tmpDir: string
let originalConfigDir: string | undefined

describe('MemoryV2 API', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-v2-api-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('creates a verified L2 fact through the API', async () => {
    const req = new Request('http://localhost/api/memory-v2/fact', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Away safety rule',
        content: 'Pause before external sending.',
        verified: true,
      }),
    })
    const url = new URL(req.url)
    const response = await handleMemoryV2Api(req, url, ['api', 'memory-v2', 'fact'])
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.entry.layer).toBe('L2')

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
  })

  it('serves four-layer memory actions through the API', async () => {
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

    const summarizeReq = new Request('http://localhost/api/memory-v2/summarize', {
      method: 'POST',
      body: JSON.stringify({ limit: 3 }),
    })
    const summarize = await handleMemoryV2Api(summarizeReq, new URL(summarizeReq.url), [
      'api',
      'memory-v2',
      'summarize',
    ])
    expect(summarize.status).toBe(201)

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

    const staleReq = new Request('http://localhost/api/memory-v2/stale')
    const stale = await handleMemoryV2Api(staleReq, new URL(staleReq.url), [
      'api',
      'memory-v2',
      'stale',
    ])
    expect(stale.status).toBe(200)

    const distillReq = new Request('http://localhost/api/memory-v2/distill', {
      method: 'POST',
      body: JSON.stringify({ limit: 3 }),
    })
    const distill = await handleMemoryV2Api(distillReq, new URL(distillReq.url), [
      'api',
      'memory-v2',
      'distill',
    ])
    expect(distill.status).toBe(201)
  })
})

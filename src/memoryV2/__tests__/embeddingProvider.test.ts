import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  embedMemoryTexts,
  getMemoryEmbeddingConfig,
} from '../embeddingProvider.js'

let tmpDir: string
let server: ReturnType<typeof Bun.serve> | undefined
let originalEnv: Record<string, string | undefined>

describe('Memory embedding provider', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-embedding-'))
    originalEnv = {
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
      CLAUDE_YH_EMBEDDING_PROVIDER: process.env.CLAUDE_YH_EMBEDDING_PROVIDER,
      CLAUDE_YH_EMBEDDING_API_KEY: process.env.CLAUDE_YH_EMBEDDING_API_KEY,
      CLAUDE_YH_EMBEDDING_BASE_URL: process.env.CLAUDE_YH_EMBEDDING_BASE_URL,
      CLAUDE_YH_EMBEDDING_MODEL: process.env.CLAUDE_YH_EMBEDDING_MODEL,
      CLAUDE_YH_EMBEDDING_DIMENSIONS: process.env.CLAUDE_YH_EMBEDDING_DIMENSIONS,
      CLAUDE_YH_EMBEDDING_BATCH_SIZE: process.env.CLAUDE_YH_EMBEDDING_BATCH_SIZE,
    }
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    delete process.env.CLAUDE_YH_EMBEDDING_PROVIDER
    delete process.env.CLAUDE_YH_EMBEDDING_API_KEY
    delete process.env.CLAUDE_YH_EMBEDDING_BASE_URL
    delete process.env.CLAUDE_YH_EMBEDDING_MODEL
    delete process.env.CLAUDE_YH_EMBEDDING_DIMENSIONS
    delete process.env.CLAUDE_YH_EMBEDDING_BATCH_SIZE
  })

  afterEach(async () => {
    server?.stop(true)
    server = undefined
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('falls back to local embeddings when no API key is configured', async () => {
    const config = await getMemoryEmbeddingConfig()
    expect(config.provider).toBe('local')
    expect(config.method).toBe('faiss-local-embedding')

    const result = await embedMemoryTexts({
      texts: ['browser memory workflow'],
      cachePath: path.join(tmpDir, 'cache.json'),
    })
    expect(result.remote).toBe(false)
    expect(result.embeddings[0]).toHaveLength(256)
  })

  it('uses OpenAI-compatible embeddings, writes cache, and reuses cached vectors', async () => {
    let requests = 0
    server = Bun.serve({
      port: 0,
      fetch: async req => {
        requests += 1
        expect(req.headers.get('authorization')).toBe('Bearer test-key')
        const body = await req.json() as { input: string[]; dimensions: number; model: string }
        expect(body.model).toBe('text-embedding-v4')
        return Response.json({
          data: body.input.map((text, index) => ({
            index,
            embedding: mockEmbedding(text, body.dimensions),
          })),
        })
      },
    })
    process.env.CLAUDE_YH_EMBEDDING_PROVIDER = 'dashscope'
    process.env.CLAUDE_YH_EMBEDDING_API_KEY = 'test-key'
    process.env.CLAUDE_YH_EMBEDDING_BASE_URL = `http://127.0.0.1:${server.port}`
    process.env.CLAUDE_YH_EMBEDDING_DIMENSIONS = '8'
    process.env.CLAUDE_YH_EMBEDDING_BATCH_SIZE = '2'

    const cachePath = path.join(tmpDir, 'embedding-cache.json')
    const first = await embedMemoryTexts({
      texts: ['alpha', 'beta', 'gamma'],
      cachePath,
    })
    expect(first.remote).toBe(true)
    expect(first.config.method).toBe('faiss-dashscope-embedding')
    expect(first.embeddings).toHaveLength(3)
    expect(first.embeddings[0]).toHaveLength(8)
    expect(requests).toBe(2)

    server.stop(true)
    server = undefined
    const second = await embedMemoryTexts({
      texts: ['alpha', 'beta', 'gamma'],
      cachePath,
    })
    expect(second.remote).toBe(true)
    expect(second.embeddings[1]).toEqual(first.embeddings[1])
    await expect(fs.stat(cachePath)).resolves.toBeTruthy()
  })
})

function mockEmbedding(text: string, dimensions: number): number[] {
  const vector = Array.from({ length: dimensions }, () => 0)
  for (let index = 0; index < text.length; index += 1) {
    vector[index % dimensions] += text.charCodeAt(index) / 255
  }
  return vector
}

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { createServer } from 'node:net'
import { updateWebSearchConfig } from '../../webSearch/settings.js'
import { WebSearchTool } from './WebSearchTool.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalMacro: unknown

describe('WebSearchTool custom provider', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'web-search-tool-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    const globals = globalThis as typeof globalThis & { MACRO?: unknown }
    originalMacro = globals.MACRO
    globals.MACRO = { VERSION: 'test' }
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    if (originalMacro === undefined) delete (globalThis as typeof globalThis & { MACRO?: unknown }).MACRO
    else (globalThis as typeof globalThis & { MACRO?: unknown }).MACRO = originalMacro
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('calls a configured third-party JSON search API and parses results', async () => {
    const port = await getFreePort()
    const seen: Array<{ body: string; apiKey?: string }> = []
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', chunk => {
        body += chunk.toString()
      })
      req.on('end', () => {
        seen.push({
          body,
          apiKey: req.headers['x-api-key']?.toString(),
        })
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({
          data: {
            items: [
              {
                title: 'Example result',
                link: 'https://example.com/a',
                snippet: 'ignored snippet',
              },
              {
                title: 'Blocked result',
                link: 'https://blocked.example/a',
              },
            ],
          },
        }))
      })
    })
    await listen(server, port)

    try {
      const { error } = updateWebSearchConfig({
        enabled: true,
        mode: 'local',
        localProvider: 'custom',
        maxResults: 5,
        custom: {
          endpoint: `http://127.0.0.1:${port}/search`,
          method: 'POST',
          apiKey: 'secret-key',
          authHeader: 'X-API-Key',
          authPrefix: '',
          queryParam: 'q',
          headers: {},
          bodyTemplate: '{"query":"{{query}}","limit":{{maxResults}}}',
          resultsPath: 'data.items',
          titlePath: 'title',
          urlPath: 'link',
          snippetPath: 'snippet',
        },
      })
      expect(error).toBeNull()

      const result = await WebSearchTool.call(
        {
          query: 'hello search',
          blocked_domains: ['blocked.example'],
        } as never,
        { abortController: new AbortController() } as never,
        undefined as never,
        undefined as never,
        undefined as never,
      )

      expect(seen).toHaveLength(1)
      expect(seen[0]!.apiKey).toBe('secret-key')
      expect(JSON.parse(seen[0]!.body)).toEqual({
        query: 'hello search',
        limit: 5,
      })
      expect(JSON.stringify(result.data.results)).toContain('Example result')
      expect(JSON.stringify(result.data.results)).toContain('https://example.com/a')
      expect(JSON.stringify(result.data.results)).not.toContain('blocked.example')
    } finally {
      await close(server)
    }
  })

  it('falls back to DuckDuckGo when custom provider has no endpoint', async () => {
    const originalFetch = globalThis.fetch
    const requestedUrls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input))
      return new Response(`
        <html><body>
          <a class="result__a" href="https://example.com/weather">Example weather</a>
        </body></html>
      `, { status: 200, headers: { 'Content-Type': 'text/html' } })
    }) as typeof fetch

    try {
      const { error } = updateWebSearchConfig({
        enabled: true,
        mode: 'local',
        localProvider: 'custom',
        maxResults: 5,
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
      })
      expect(error).toBeNull()

      const result = await WebSearchTool.call(
        { query: 'weather today' } as never,
        { abortController: new AbortController() } as never,
        undefined as never,
        undefined as never,
        undefined as never,
      )

      expect(requestedUrls[0]).toContain('duckduckgo.com/html')
      expect(JSON.stringify(result.data.results)).toContain('Example weather')
      expect(JSON.stringify(result.data.results)).toContain('https://example.com/weather')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('free_port_not_found'))
      })
    })
    server.on('error', reject)
  })
}

async function listen(server: http.Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', resolve)
    server.on('error', reject)
  })
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) reject(error)
      else resolve()
    })
  })
}

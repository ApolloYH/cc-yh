import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getAutoMemPath } from '../../memdir/paths.js'
import { runMemoryV2Automation } from '../automation.js'
import { getMemoryV2Status, searchMemoryV2 } from '../store.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalMemoryOverride: string | undefined
let originalEmbeddingApiKey: string | undefined
let originalEmbeddingProvider: string | undefined
let originalDisableMainModel: string | undefined

describe('Memory L1-L4 automation', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-v2-auto-'))
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

  it('summarizes sessions and refreshes vectors without heuristic distillation', async () => {
    const projectDir = path.join(tmpDir, 'projects', 'repo-a')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(
      path.join(projectDir, 'session-browser.jsonl'),
      [
        JSON.stringify({
          type: 'user',
          timestamp: new Date().toISOString(),
          message: { role: 'user', content: 'Browser configuration workflow test' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: new Date().toISOString(),
          message: { role: 'assistant', content: 'Use a browser smoke test after bridge configuration.' },
        }),
      ].join('\n'),
      'utf-8',
    )

    const result = await runMemoryV2Automation(5)
    expect(result.summaries).toBeGreaterThan(0)
    expect(result.candidates).toBe(0)
    expect(result.applied).toBe(0)

    const status = await getMemoryV2Status()
    expect(status.indexPath).toBe(path.join(tmpDir, 'project-memory', 'MEMORY.md'))

    const search = await searchMemoryV2('browser configuration')
    expect(search.length).toBeGreaterThan(0)
    await expect(fs.stat(status.vectorIndexPath)).resolves.toBeTruthy()
  })
})

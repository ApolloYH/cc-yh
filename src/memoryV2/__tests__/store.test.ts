import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  detectMemoryV2Stale,
  generateMemoryV2DistillCandidates,
  readMemoryV2Entry,
  searchMemoryV2,
  summarizeMemoryV2Sessions,
  updateMemoryV2Entry,
  getMemoryV2Status,
  writeMemoryFact,
  writeMemorySop,
} from '../store.js'
import { getAutoMemPath } from '../../memdir/paths.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalMemoryOverride: string | undefined
let originalEmbeddingApiKey: string | undefined
let originalEmbeddingProvider: string | undefined
let originalDisableMainModel: string | undefined

describe('MemoryV2 store', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-v2-'))
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

  it('writes verified facts and SOPs while keeping L1 as pointers', async () => {
    await writeMemoryFact({
      title: 'Provider base URL',
      content: 'OpenAI-compatible providers require a chat completions URL.',
      verified: true,
      source: 'test',
    })
    await writeMemorySop({
      title: 'Provider smoke test',
      content: 'Run /status and one CLI prompt after changing provider settings.',
      verified: true,
      source: 'test',
    })

    const status = await getMemoryV2Status()
    expect(status.entries).toHaveLength(2)
    expect(status.vectorProvider).toBe('faiss')
    expect(status.embeddingProvider).toBe('local')
    expect(status.embeddingMethod).toBe('faiss-local-embedding')
    expect(status.root).toBe(path.join(tmpDir, 'project-memory'))
    expect(status.indexPath).toBe(path.join(tmpDir, 'project-memory', 'MEMORY.md'))
    const index = await fs.readFile(status.indexPath, 'utf-8')
    expect(index).toContain('L2: [Provider base URL]')
    expect(index).toContain('L3: [Provider smoke test]')
    expect(index).not.toContain('OpenAI-compatible providers require')
  })

  it('rejects unverified promotion into L2 or L3', async () => {
    await expect(
      writeMemoryFact({
        title: 'Unverified fact',
        content: 'Maybe true.',
        verified: false,
      }),
    ).rejects.toThrow('L2 promotion requires verified=true')
  })

  it('summarizes L4 sessions, searches vectors, updates entries, and detects stale items', async () => {
    const projectDir = path.join(tmpDir, 'projects', 'repo-a')
    await fs.mkdir(projectDir, { recursive: true })
    const old = new Date(Date.now() - 70 * 86_400_000)
    const sessionPath = path.join(projectDir, 'session-browser.jsonl')
    await fs.writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: 'user',
          timestamp: old.toISOString(),
          message: { role: 'user', content: 'Browser memory workflow test' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: old.toISOString(),
          message: { role: 'assistant', content: 'Use /memory search browser after summarizing.' },
        }),
      ].join('\n'),
      'utf-8',
    )
    await fs.utimes(sessionPath, old, old)

    const summaries = await summarizeMemoryV2Sessions(5)
    expect(summaries[0]?.layer).toBe('L4')
    expect(summaries[0]?.content).toContain('Browser memory workflow test')
    await fs.utimes(summaries[0].path, old, old)

    const search = await searchMemoryV2('browser workflow')
    expect(search.length).toBeGreaterThan(0)
    expect(search[0].method).toBe('faiss-local-embedding')
    const status = await getMemoryV2Status()
    await expect(fs.stat(status.faissMetaPath)).resolves.toBeTruthy()

    const stale = await detectMemoryV2Stale()
    expect(stale.some(entry => entry.layer === 'L4')).toBe(true)

    const l1 = await readMemoryV2Entry('L1', 'index')
    const updated = await updateMemoryV2Entry({
      layer: 'L1',
      id: 'index',
      content: `${l1.content}\n- L1: [Manual pointer](facts/manual.md)\n`,
    })
    expect(updated.content).toContain('Manual pointer')

    const candidates = await generateMemoryV2DistillCandidates(5)
    expect(candidates.some(candidate => candidate.layer === 'L3')).toBe(true)
  })
})

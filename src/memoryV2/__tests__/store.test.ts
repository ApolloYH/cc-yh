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
let originalImportLegacyMemory: string | undefined

describe('MemoryV2 store', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-v2-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalMemoryOverride = process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
    originalEmbeddingApiKey = process.env.CLAUDE_YH_EMBEDDING_API_KEY
    originalEmbeddingProvider = process.env.CLAUDE_YH_EMBEDDING_PROVIDER
    originalDisableMainModel = process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION
    originalImportLegacyMemory = process.env.CLAUDE_YH_IMPORT_LEGACY_MEMORY
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = path.join(tmpDir, 'project-memory')
    delete process.env.CLAUDE_YH_EMBEDDING_API_KEY
    delete process.env.CLAUDE_YH_EMBEDDING_PROVIDER
    delete process.env.CLAUDE_YH_IMPORT_LEGACY_MEMORY
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
    if (originalImportLegacyMemory === undefined) delete process.env.CLAUDE_YH_IMPORT_LEGACY_MEMORY
    else process.env.CLAUDE_YH_IMPORT_LEGACY_MEMORY = originalImportLegacyMemory
    getAutoMemPath.cache.clear?.()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('writes verified facts and SOPs while keeping L1 compact', async () => {
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
    expect(index).toContain('L1 存在性索引')
    expect(index).toContain('L2 facts `facts/`')
    expect(index).toContain('L3 SOP `sops/`')
    expect(index).toContain('L3 Skills `sops/skills/`')
    expect(index).toContain('Provider base URL')
    expect(index).toContain('Provider smoke test')
    expect(index).not.toContain('[Provider base URL](facts/provider-base-url.md)')
    expect(index).not.toContain('## 沉淀规则')
    expect(index.split(/\r?\n/).length).toBeLessThanOrEqual(14)
  })

  it('keeps L3 SOP and Skill mutually exclusive for the same workflow', async () => {
    const root = path.join(tmpDir, 'project-memory')
    await fs.mkdir(path.join(root, 'sops'), { recursive: true })
    await fs.mkdir(path.join(root, 'sops', 'skills', 'browser-control'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'sops', 'browser-control.md'),
      [
        '---',
        'layer: L3',
        'title: "Browser Control"',
        'verified: true',
        '---',
        '',
        '# Browser Control',
        '',
        'Use the browser control workflow.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(root, 'sops', 'skills', 'browser-control', 'SKILL.md'),
      [
        '---',
        'name: Browser Control',
        'version: "1.0.0"',
        'user-invocable: true',
        '---',
        '',
        '# Browser Control',
        '',
        'Use the browser control skill.',
      ].join('\n'),
      'utf-8',
    )

    const status = await getMemoryV2Status()

    expect(status.sops.some(entry => entry.id === 'skill-browser-control')).toBe(true)
    expect(status.sops.some(entry => entry.id === 'browser-control')).toBe(false)
    await expect(fs.stat(path.join(root, 'sops', 'browser-control.md'))).rejects.toThrow()
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

  it('migrates older memory roots into the active L1-L4 root', async () => {
    const globalFactDir = path.join(tmpDir, 'memory', 'facts')
    const oldProjectSopDir = path.join(tmpDir, 'projects', 'old-project', 'memory', 'sops')
    await fs.mkdir(globalFactDir, { recursive: true })
    await fs.mkdir(oldProjectSopDir, { recursive: true })
    await fs.writeFile(
      path.join(globalFactDir, 'legacy-provider.md'),
      [
        '---',
        'layer: L2',
        'title: "Legacy provider"',
        'verified: true',
        '---',
        '',
        '# Legacy provider',
        '',
        'Legacy global fact.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(oldProjectSopDir, 'legacy-smoke.md'),
      [
        '---',
        'layer: L3',
        'title: "Legacy smoke"',
        'verified: true',
        '---',
        '',
        '# Legacy smoke',
        '',
        'Legacy project SOP.',
      ].join('\n'),
      'utf-8',
    )

    process.env.CLAUDE_YH_IMPORT_LEGACY_MEMORY = '1'
    const status = await getMemoryV2Status()

    expect(status.facts.some(entry => entry.title === 'Legacy provider')).toBe(true)
    expect(status.sops.some(entry => entry.title === 'Legacy smoke')).toBe(true)
    await expect(fs.stat(path.join(tmpDir, 'project-memory', 'facts', 'legacy-provider.md'))).resolves.toBeTruthy()
    await expect(fs.stat(path.join(tmpDir, 'project-memory', 'sops', 'legacy-smoke.md'))).resolves.toBeTruthy()
    const index = await fs.readFile(status.indexPath, 'utf-8')
    expect(index).toContain('Legacy provider')
    expect(index).toContain('Legacy smoke')
    expect(index).not.toContain('[Legacy provider](facts/legacy-provider.md)')
    expect(index).not.toContain('[Legacy smoke](sops/legacy-smoke.md)')
    expect(index.split(/\r?\n/).length).toBeLessThanOrEqual(14)
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

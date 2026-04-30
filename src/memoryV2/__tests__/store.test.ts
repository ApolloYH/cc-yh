import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
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
let originalDisableMainModel: string | undefined
let originalImportLegacyMemory: string | undefined
let originalFetch: typeof globalThis.fetch

describe('MemoryV2 store', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-v2-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalMemoryOverride = process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
    originalDisableMainModel = process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION
    originalImportLegacyMemory = process.env.CLAUDE_YH_IMPORT_LEGACY_MEMORY
    originalFetch = globalThis.fetch
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = path.join(tmpDir, 'project-memory')
    delete process.env.CLAUDE_YH_IMPORT_LEGACY_MEMORY
    process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION = '1'
    getAutoMemPath.cache.clear?.()
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    if (originalMemoryOverride === undefined) delete process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
    else process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = originalMemoryOverride
    if (originalDisableMainModel === undefined) delete process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION
    else process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION = originalDisableMainModel
    if (originalImportLegacyMemory === undefined) delete process.env.CLAUDE_YH_IMPORT_LEGACY_MEMORY
    else process.env.CLAUDE_YH_IMPORT_LEGACY_MEMORY = originalImportLegacyMemory
    globalThis.fetch = originalFetch
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
    expect(status.root).toBe(path.join(tmpDir, 'project-memory'))
    expect(status.indexPath).toBe(path.join(tmpDir, 'project-memory', 'MEMORY.md'))
    const index = await fs.readFile(status.indexPath, 'utf-8')
    expect(index).toContain('角色定位：')
    expect(index).toContain('L2 facts：')
    expect(index).toContain('细节见 `facts/`')
    expect(index).toContain('L3 SOP：')
    expect(index).toContain('细节见 `sops/`')
    expect(index).toContain('Provider base URL')
    expect(index).toContain('Provider smoke test')
    expect(index).not.toContain('[Provider base URL](facts/provider-base-url.md)')
    expect(index).not.toContain('## 沉淀规则')
    expect(index.split(/\r?\n/).length).toBeLessThanOrEqual(14)
    expect(index).not.toMatch(/\n\s*\n/)

    const factMarkdown = await fs.readFile(path.join(tmpDir, 'project-memory', 'facts', 'provider-base-url.md'), 'utf-8')
    expect(factMarkdown).not.toMatch(/\n\s*\n/)
  })

  it('keeps skills out of L1 because skill listing owns callable skill metadata', async () => {
    const root = path.join(tmpDir, 'project-memory')
    for (let index = 0; index < 16; index += 1) {
      const skillDir = path.join(root, 'sops', 'skills', `callable-skill-${index}`)
      await fs.mkdir(skillDir, { recursive: true })
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        [
          '---',
          `name: Callable Skill ${index}`,
          `description: Callable skill ${index} should be listed through Skill listing only.`,
          'user-invocable: true',
          '---',
          `# Callable Skill ${index}`,
          `Use callable skill ${index} for a repeated interactive capability.`,
        ].join('\n'),
        'utf-8',
      )
    }

    await writeMemoryFact({
      title: 'Memory policy',
      content: 'User prefers L1 to stay compact and avoid duplicating Skill metadata.',
      verified: true,
      source: 'test',
    })
    await writeMemorySop({
      title: 'Memory review',
      content: 'Review L2 and ordinary L3 SOPs before changing long-term memory behavior.',
      verified: true,
      source: 'test',
    })

    const status = await getMemoryV2Status()
    const index = await fs.readFile(status.indexPath, 'utf-8')
    expect(status.sops.some(entry => entry.id === 'skill-callable-skill-0')).toBe(true)
    expect(index).toContain('Memory policy')
    expect(index).toContain('Memory review')
    expect(index).not.toContain('Skill listing')
    expect(index).not.toContain('sops/skills')
    expect(index).not.toContain('Callable Skill')
    expect(index).not.toContain('callable-skill')
  })

  it('keeps L1 hard-bounded and compact even when L2 and L3 grow', async () => {
    for (let index = 0; index < 24; index += 1) {
      await writeMemoryFact({
        title: `Long running preference ${index}`,
        content: `User preference ${index}: keep memory concise and avoid noisy low-value extraction. This entry has enough text to pressure the L1 summary.`,
        verified: true,
        source: 'test',
      })
      await writeMemorySop({
        title: `Reusable workflow ${index}`,
        content: `Workflow ${index}: inspect diagnostics, verify behavior, run tests, and only then promote reusable knowledge.`,
        verified: true,
        source: 'test',
      })
    }

    const status = await getMemoryV2Status()
    const indexContent = await fs.readFile(status.indexPath, 'utf-8')
    expect(indexContent.split(/\r?\n/).length).toBeLessThanOrEqual(30)
    expect(indexContent.length).toBeLessThanOrEqual(2500)
    expect(indexContent).not.toMatch(/\n\s*\n/)
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

  it('summarizes L4 sessions, searches markdown, and updates entries', async () => {
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
    expect(await fs.readFile(summaries[0].path, 'utf-8')).not.toMatch(/\n\s*\n/)
    await fs.utimes(summaries[0].path, old, old)

    const search = await searchMemoryV2('browser workflow')
    expect(search.length).toBeGreaterThan(0)
    expect(search[0].method).toBe('keyword')
    await getMemoryV2Status()

    const l1 = await readMemoryV2Entry('L1', 'index')
    const updated = await updateMemoryV2Entry({
      layer: 'L1',
      id: 'index',
      content: `${l1.content}\n- L1: [Manual pointer](facts/manual.md)\n`,
    })
    expect(updated.content).toContain('Manual pointer')

    const candidates = await generateMemoryV2DistillCandidates(5)
    expect(candidates).toHaveLength(0)
  })

  it('filters assistant/product identity candidates that are incorrectly attributed to the user', async () => {
    delete process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION
    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: 'test-token',
          ANTHROPIC_MODEL: 'test-model',
          ANTHROPIC_BASE_URL: 'https://model.invalid',
        },
      }),
      'utf-8',
    )
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              candidates: [
                {
                  layer: 'L2',
                  title: '用户身份：claude-yh',
                  content: '用户身份：claude-yh\n\nWhy: 用户说“你是 claude-yh”。\n\nHow to apply: 称呼用户为 claude-yh。',
                  confidence: 0.99,
                  reason: 'model returned an inverted identity candidate',
                  evidence: '用户说：你是 claude-yh，是我基于 claude-code 开发的智能体。',
                },
              ],
            }),
          },
        ],
      }), { status: 200 })) as unknown as typeof fetch

    const summariesDir = path.join(tmpDir, 'project-memory', 'sessions')
    await fs.mkdir(summariesDir, { recursive: true })
    const summaryPath = path.join(summariesDir, 'session-identity.md')
    await fs.writeFile(summaryPath, '# 你的名字是什么\n\n用户说你是 claude-yh。', 'utf-8')

    const candidates = await generateMemoryV2DistillCandidates(5, [
      {
        id: 'session-identity',
        layer: 'L4',
        title: '你的名字是什么',
        path: summaryPath,
        source: path.join(tmpDir, 'projects', 'repo', 'identity.jsonl'),
        content: '# 你的名字是什么\n\n用户说你是 claude-yh，是我基于 claude-code 开发的智能体。',
        summary: '用户说明助手或产品身份是 claude-yh。',
        verified: true,
        updatedAt: new Date().toISOString(),
      },
    ])

    expect(candidates).toHaveLength(0)
  })
})

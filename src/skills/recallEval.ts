import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseFrontmatter } from '../utils/frontmatterParser.js'

export type SkillRecallMatch = {
  name: string
  path: string
  score: number
  description: string
  kind: 'skill' | 'sop'
}

type RecallEntry = {
  name: string
  path: string
  description: string
  body: string
  kind: 'skill' | 'sop'
}

export async function evaluateSkillRecall(
  query: string,
  roots: string | string[] = defaultRecallRoots(),
): Promise<SkillRecallMatch[]> {
  const entries = await readRecallEntries(Array.isArray(roots) ? roots : [roots])
  const queryTerms = semanticTerms(query)
  return entries
    .map(entry => {
      const terms = new Set(semanticTerms(`${entry.name}\n${entry.description}\n${entry.body}`))
      const overlap = queryTerms.filter(term => terms.has(term)).length
      const score = queryTerms.length === 0 ? 0 : overlap / queryTerms.length
      return { ...entry, score: Number(score.toFixed(4)) }
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
    .slice(0, 10)
}

function defaultRecallRoots(): string[] {
  const home = path.join(os.homedir(), '.claude-yh')
  return [
    path.join(home, 'skills'),
    path.join(home, 'memory', 'sops'),
    path.join(home, 'memory', 'sops', 'skills'),
  ]
}

async function readRecallEntries(roots: string[]): Promise<RecallEntry[]> {
  const entries = (await Promise.all(roots.map(root => readSkillsAndSops(root)))).flat()
  const seen = new Map<string, RecallEntry>()
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.name.normalize('NFKC').toLowerCase()}`
    const current = seen.get(key)
    if (!current || entry.path.includes(`${path.sep}memory${path.sep}`)) {
      seen.set(key, entry)
    }
  }
  return [...seen.values()]
}

async function readSkillsAndSops(root: string): Promise<RecallEntry[]> {
  try {
    const dirents = await fs.readdir(root, { withFileTypes: true })
    const nestedSkills = await Promise.all(dirents.map(async entry => {
      if (!entry.isDirectory() || entry.name.startsWith('.')) return null
      return readSkillFile(path.join(root, entry.name, 'SKILL.md'), entry.name)
    }))
    const directSops = await Promise.all(dirents.map(async entry => {
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'SKILL.md') {
        return null
      }
      return readSopFile(path.join(root, entry.name))
    }))
    const directSkill = await readSkillFile(path.join(root, 'SKILL.md'), path.basename(root))
    return [directSkill, ...nestedSkills, ...directSops]
      .filter((entry): entry is RecallEntry => entry !== null)
  } catch {
    return []
  }
}

async function readSkillFile(skillPath: string, fallbackName: string): Promise<RecallEntry | null> {
  try {
    const raw = await fs.readFile(skillPath, 'utf-8')
    const parsed = parseFrontmatter(raw, skillPath)
    return {
      name: String(parsed.frontmatter.name ?? fallbackName),
      path: skillPath,
      description: String(parsed.frontmatter.description ?? ''),
      body: parsed.content,
      kind: 'skill',
    }
  } catch {
    return null
  }
}

async function readSopFile(sopPath: string): Promise<RecallEntry | null> {
  try {
    const raw = await fs.readFile(sopPath, 'utf-8')
    const parsed = parseFrontmatter(raw, sopPath)
    const title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(sopPath, '.md')
    return {
      name: title,
      path: sopPath,
      description: String(parsed.frontmatter.description ?? parsed.frontmatter.title ?? title),
      body: parsed.content,
      kind: 'sop',
    }
  } catch {
    return null
  }
}

function semanticTerms(value: string): string[] {
  return [...new Set(
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .flatMap(token => expandToken(token))
      .filter(token => token.length >= 2),
  )]
}

function expandToken(token: string): string[] {
  const synonyms: Record<string, string[]> = {
    browser: ['chrome', 'tab', 'cdp', 'tmwd'],
    chrome: ['browser', 'tab', 'cdp'],
    memory: ['remember', 'recall', 'knowledge'],
    skill: ['workflow', 'sop', 'procedure'],
    sop: ['skill', 'workflow', 'procedure'],
    test: ['verify', 'validation', 'check'],
    verify: ['test', 'validation', 'check'],
    error: ['failure', 'bug', 'exception'],
    jarvis: ['daemon', 'checkpoint', 'autonomous'],
    搜索: ['search', '查找'],
    浏览器: ['browser', 'chrome', 'tab'],
    记忆: ['memory', 'remember', 'recall'],
    技能: ['skill', 'workflow', 'sop'],
    验证: ['verify', 'test', 'check'],
    常驻: ['jarvis', 'daemon', 'checkpoint'],
  }
  return [token, ...(synonyms[token] ?? [])]
}

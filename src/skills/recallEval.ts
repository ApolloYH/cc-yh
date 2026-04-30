import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseFrontmatter } from '../utils/frontmatterParser.js'

export type SkillRecallMatch = {
  name: string
  path: string
  score: number
  description: string
}

export async function evaluateSkillRecall(
  query: string,
  skillsDir = path.join(os.homedir(), '.claude-yh', 'skills'),
): Promise<SkillRecallMatch[]> {
  const skills = await readSkills(skillsDir)
  const queryTerms = semanticTerms(query)
  return skills
    .map(skill => {
      const terms = new Set(semanticTerms(`${skill.name}\n${skill.description}\n${skill.body}`))
      const overlap = queryTerms.filter(term => terms.has(term)).length
      const score = queryTerms.length === 0 ? 0 : overlap / queryTerms.length
      return { ...skill, score: Number(score.toFixed(4)) }
    })
    .filter(skill => skill.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 10)
}

async function readSkills(skillsDir: string): Promise<Array<{
  name: string
  path: string
  description: string
  body: string
}>> {
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true })
    const skills = await Promise.all(entries.map(async entry => {
      if (!entry.isDirectory() || entry.name.startsWith('.')) return null
      const skillPath = path.join(skillsDir, entry.name, 'SKILL.md')
      try {
        const raw = await fs.readFile(skillPath, 'utf-8')
        const parsed = parseFrontmatter(raw, skillPath)
        return {
          name: entry.name,
          path: skillPath,
          description: String(parsed.frontmatter.description ?? ''),
          body: parsed.content,
        }
      } catch {
        return null
      }
    }))
    return skills.filter((skill): skill is NonNullable<typeof skill> => skill !== null)
  } catch {
    return []
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
    test: ['verify', 'validation', 'check'],
    error: ['failure', 'bug', 'exception'],
    搜索: ['search', '查找'],
    浏览器: ['browser', 'chrome', 'tab'],
    记忆: ['memory', 'remember', 'recall'],
    技能: ['skill', 'workflow', 'sop'],
  }
  return [token, ...(synonyms[token] ?? [])]
}

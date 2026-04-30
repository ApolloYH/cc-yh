import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { MemoryV2DistillCandidate } from '../memoryV2/types.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import {
  judgeSkillCandidateSuccess,
  rewriteSkillWithModelOrHeuristic,
} from './modelSkillDistiller.js'

export type AutoDistilledSkill = {
  name: string
  skillDir: string
  skillPath: string
  version: string
  reused: boolean
  modelUsed?: boolean
}

type SkillDistillManifest = {
  version: 1
  entries: Array<{
    name: string
    contentHash: string
    source?: string
    createdAt: string
    version: string
  }>
}

export async function autoDistillSkillFromMemoryCandidate(
  candidate: MemoryV2DistillCandidate,
): Promise<AutoDistilledSkill | null> {
  const skillsRoot = path.join(getClaudeConfigHomeDir(), 'skills')
  const manifest = await readManifest(skillsRoot)
  const contentHash = hashCandidate(candidate)
  const existing = manifest.entries.find(entry => entry.contentHash === contentHash)
  if (existing) {
    const skillDir = path.join(skillsRoot, existing.name)
    return {
      name: existing.name,
      skillDir,
      skillPath: path.join(skillDir, 'SKILL.md'),
      version: existing.version,
      reused: true,
    }
  }

  const baseName = `memory-${slugify(candidate.title)}`
  const { name, version } = await resolveVersionedSkillName(skillsRoot, baseName)
  const skillDir = path.join(skillsRoot, name)
  const skillPath = path.join(skillDir, 'SKILL.md')

  const fallbackMarkdown = rewriteCandidateAsSkillMarkdown({
    candidate,
    name,
    version,
    contentHash,
  })
  const rewritten = await rewriteSkillWithModelOrHeuristic({
    candidate,
    fallbackMarkdown,
    name,
    version,
  })
  if (!rewritten.judgement.successful || !rewritten.judgement.reusable) {
    return null
  }

  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(skillPath, rewritten.markdown, 'utf-8')
  manifest.entries.unshift({
    name,
    contentHash,
    source: candidate.source,
    createdAt: new Date().toISOString(),
    version,
  })
  await writeManifest(skillsRoot, manifest)
  return { name, skillDir, skillPath, version, reused: false, modelUsed: rewritten.modelUsed }
}

export function isSuccessfulReusableCandidate(
  candidate: MemoryV2DistillCandidate,
): boolean {
  const judgement = judgeSkillCandidateSuccess(candidate)
  return judgement.successful && judgement.reusable
}

export function rewriteCandidateAsSkillMarkdown(input: {
  candidate: MemoryV2DistillCandidate
  name: string
  version: string
  contentHash: string
}): string {
  const { candidate, name, version, contentHash } = input
  const title = candidate.title.trim()
  const workflow = normalizeList(candidate.content)
  return [
    '---',
    `name: ${name}`,
    `version: "${version}"`,
    `description: ${JSON.stringify(`Use when a task matches this verified workflow: ${title}`)}`,
    'user-invocable: true',
    `x-claude-yh-source-hash: ${contentHash}`,
    `x-claude-yh-source: ${JSON.stringify(candidate.source || 'Memory L4 summary')}`,
    `x-claude-yh-confidence: ${candidate.confidence}`,
    '---',
    '',
    `# ${title}`,
    '',
    '## When To Use',
    '',
    `Use this skill when the current task is materially similar to "${title}" and needs the same verified operating pattern.`,
    '',
    '## Preconditions',
    '',
    '- Confirm the current repo, app, provider, or runtime matches the source context.',
    '- Do not apply this skill if the task contradicts newer project instructions or current user intent.',
    '',
    '## Workflow',
    '',
    workflow,
    '',
    '## Success Criteria',
    '',
    '- The requested user-visible behavior is completed, not merely compiled.',
    '- Relevant command, API, UI, or integration checks pass.',
    '- Any remaining limitations are stated explicitly before finishing.',
    '',
    '## Stop Conditions',
    '',
    '- Stop before destructive, paid, account, login, or external-send actions unless the user has explicitly approved them.',
    '- Only reuse this skill after the workflow has been verified in the current context.',
    '',
    '## Source',
    '',
    `- Derived from: ${candidate.source || 'Memory L4 summary'}`,
    `- Confidence: ${candidate.confidence}`,
    `- Content hash: ${contentHash}`,
    '',
  ].join('\n')
}

async function resolveVersionedSkillName(
  skillsRoot: string,
  baseName: string,
): Promise<{ name: string; version: string }> {
  let index = 1
  while (true) {
    const name = index === 1 ? baseName : `${baseName}-v${index}`
    if (!(await pathExists(path.join(skillsRoot, name)))) {
      return {
        name,
        version: `0.${index}.0`,
      }
    }
    index++
  }
}

async function readManifest(skillsRoot: string): Promise<SkillDistillManifest> {
  try {
    const raw = await fs.readFile(getManifestPath(skillsRoot), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<SkillDistillManifest>
    return {
      version: 1,
      entries: Array.isArray(parsed.entries) ? parsed.entries.filter(isManifestEntry) : [],
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, entries: [] }
    }
    throw error
  }
}

async function writeManifest(
  skillsRoot: string,
  manifest: SkillDistillManifest,
): Promise<void> {
  await fs.mkdir(skillsRoot, { recursive: true })
  await fs.writeFile(
    getManifestPath(skillsRoot),
    JSON.stringify({ ...manifest, entries: manifest.entries.slice(0, 500) }, null, 2) + '\n',
    'utf-8',
  )
}

function getManifestPath(skillsRoot: string): string {
  return path.join(skillsRoot, '.auto-distill-index.json')
}

function hashCandidate(candidate: MemoryV2DistillCandidate): string {
  return crypto
    .createHash('sha256')
    .update(`${candidate.title}\n${candidate.content}\n${candidate.source ?? ''}`)
    .digest('hex')
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function normalizeList(value: string): string {
  const lines = value
    .trim()
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return '1. Reconstruct the verified workflow from the source memory.'
  if (lines.some(line => /^\d+\. /.test(line))) return lines.join('\n')
  return lines.map((line, index) => `${index + 1}. ${line.replace(/^[-*]\s*/, '')}`).join('\n')
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return slug || `skill-${Date.now()}`
}

function isManifestEntry(value: unknown): value is SkillDistillManifest['entries'][number] {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as { name?: unknown }).name === 'string' &&
      typeof (value as { contentHash?: unknown }).contentHash === 'string' &&
      typeof (value as { createdAt?: unknown }).createdAt === 'string' &&
      typeof (value as { version?: unknown }).version === 'string',
  )
}

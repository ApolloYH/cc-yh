/**
 * Skills REST API
 *
 * GET    /api/skills              - List installed user skills
 * GET    /api/skills/detail       - Full skill data (tree + files)
 * POST   /api/skills/install      - Import a local skill folder into ~/.claude-yh/skills
 * POST   /api/skills/create       - Create a new skill scaffold
 * POST   /api/skills/distill      - Save a reviewed SKILL.md candidate
 * POST   /api/skills/model-distill - Rewrite and judge a memory candidate as SKILL.md
 * POST   /api/skills/evaluate     - Evaluate skill recall for a real task query
 * DELETE /api/skills/:name        - Delete an installed user skill
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { spawn } from 'child_process'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { evaluateSkillRecall } from '../../skills/recallEval.js'
import {
  rewriteCandidateAsSkillMarkdown,
} from '../../skills/autoDistill.js'
import {
  judgeSkillCandidateSuccess,
  rewriteSkillWithModelOrHeuristic,
} from '../../skills/modelSkillDistiller.js'
import type { MemoryV2DistillCandidate } from '../../memoryV2/types.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

type SkillMeta = {
  name: string
  displayName?: string
  description: string
  source: 'user' | 'project'
  userInvocable: boolean
  version?: string
  contentLength: number
  hasDirectory: boolean
}

type FileTreeNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
}

type SkillFile = {
  path: string
  content: string
  language: string
  frontmatter?: Record<string, unknown>
  body?: string
  isEntry?: boolean
}

type InstallSkillBody = {
  sourcePath?: string
  installCommand?: string
  packageUrl?: string
  name?: string
}

type CreateSkillBody = {
  name?: string
  displayName?: string
  description?: string
}

type DistillSkillBody = {
  name?: string
  scope?: 'user' | 'project'
  projectRoot?: string
  markdown?: string
  overwrite?: boolean
}

type EvaluateSkillBody = {
  query?: string
}

type ModelDistillSkillBody = {
  candidate?: MemoryV2DistillCandidate
  name?: string
  version?: string
}

const MAX_FILES = 50
const MAX_FILE_SIZE = 100 * 1024
const SKIP_ENTRIES = new Set(['node_modules', '.git', '__pycache__', '.DS_Store'])
const CLAUDATE_API_BASE = 'https://api.claudate.com/api/packages'

const LANG_MAP: Record<string, string> = {
  md: 'markdown',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  py: 'python',
  toml: 'toml',
  css: 'css',
  html: 'html',
  txt: 'text',
  xml: 'xml',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
}

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return LANG_MAP[ext] || 'text'
}

function normalizeFrontmatter(content: string, sourcePath?: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  const parsed = parseFrontmatter(content, sourcePath)
  return {
    frontmatter: parsed.frontmatter as Record<string, unknown>,
    body: parsed.content,
  }
}

function getUserSkillsDir(): string {
  return (
    process.env.CLAUDE_YH_SKILLS_DIR ||
    path.join(os.homedir(), '.claude-yh', 'skills')
  )
}

function assertValidSkillName(name: string): void {
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw ApiError.badRequest('Invalid skill name')
  }
}

function sanitizeSkillFolderName(name: string): string {
  const sanitized = name
    .trim()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .toLowerCase()

  if (!sanitized) {
    throw ApiError.badRequest('Skill name is required')
  }

  assertValidSkillName(sanitized)
  return sanitized
}

async function ensureUserSkillsDir(): Promise<string> {
  const skillsDir = getUserSkillsDir()
  await fs.mkdir(skillsDir, { recursive: true })
  return skillsDir
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function readJsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw ApiError.badRequest('Invalid JSON request body')
  }
}

async function assertSkillSourceDir(sourcePath: string): Promise<string> {
  if (!sourcePath?.trim()) {
    throw ApiError.badRequest('sourcePath is required')
  }

  const resolved = path.resolve(sourcePath.trim())
  let stat
  try {
    stat = await fs.stat(resolved)
  } catch {
    throw ApiError.badRequest(`Skill folder does not exist: ${resolved}`)
  }

  if (!stat.isDirectory()) {
    throw ApiError.badRequest('Selected path must be a directory')
  }

  const skillFile = path.join(resolved, 'SKILL.md')
  if (!(await pathExists(skillFile))) {
    throw ApiError.badRequest('Selected folder must contain SKILL.md')
  }

  return resolved
}

function tokenizeCommand(input: string): string[] {
  return Array.from(input.matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)).map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  )
}

function extractFirstUrl(input: string): string | null {
  const match = input.match(/https?:\/\/[^\s"'<>]+/i)
  return match?.[0] ?? null
}

function extractClaudatePackageId(input: string): string | null {
  try {
    const parsed = new URL(input)
    if (parsed.hostname !== 'claudate.com' && parsed.hostname !== 'www.claudate.com' && parsed.hostname !== 'api.claudate.com') {
      return null
    }

    const parts = parsed.pathname.split('/').filter(Boolean)
    const packageIndex = parts.indexOf('package')
    if (packageIndex >= 0 && parts[packageIndex + 1]) {
      return decodeURIComponent(parts[packageIndex + 1])
    }

    const packagesIndex = parts.indexOf('packages')
    if (packagesIndex >= 0 && parts[packagesIndex + 1]) {
      return decodeURIComponent(parts[packagesIndex + 1])
    }

    return null
  } catch {
    return null
  }
}

function parseGithubTreeUrl(input: string): {
  repoUrl: string
  branch: string
  subPath: string
  fallbackName: string
} | null {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return null
  }

  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
    return null
  }

  const parts = parsed.pathname.split('/').filter(Boolean)
  const [owner, repo, marker, branch, ...subPathParts] = parts
  if (!owner || !repo) return null

  const repoName = repo.replace(/\.git$/i, '')
  const repoUrl = `https://github.com/${owner}/${repoName}.git`

  if (marker === 'tree' && branch) {
    const subPath = subPathParts.join('/')
    return {
      repoUrl,
      branch,
      subPath,
      fallbackName: subPathParts.at(-1) || repoName,
    }
  }

  return {
    repoUrl,
    branch: 'main',
    subPath: '',
    fallbackName: repoName,
  }
}

function parseInstallCommand(input: string): string {
  const trimmed = input.trim()
  const url = extractFirstUrl(trimmed)
  if (url) return url

  const tokens = tokenizeCommand(trimmed)
  const installIndex = tokens.findIndex((token) => token === 'install')
  if (installIndex >= 0) {
    const source = tokens.slice(installIndex + 1).find((token) => !token.startsWith('-'))
    if (source) return source
  }

  return trimmed
}

async function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<void> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })

  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk)
  })

  await new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`))
    })
  })
}

async function resolveClaudateSource(packageId: string): Promise<{
  source: string
  name?: string
}> {
  const res = await fetch(`${CLAUDATE_API_BASE}/${encodeURIComponent(packageId)}`, {
    headers: { Accept: 'application/json' },
  })

  if (!res.ok) {
    throw ApiError.badRequest(`Unable to resolve Claudate package: ${packageId}`)
  }

  const payload = (await res.json()) as {
    success?: boolean
    data?: {
      type?: string
      name?: string
      slug?: string
      source_url?: string
    }
  }

  if (!payload.success || !payload.data) {
    throw ApiError.badRequest(`Invalid Claudate package response: ${packageId}`)
  }

  if (payload.data.type && payload.data.type !== 'skill') {
    throw ApiError.badRequest(`Claudate package is not a skill: ${payload.data.type}`)
  }

  if (!payload.data.source_url) {
    throw ApiError.badRequest('Claudate package does not expose a source URL')
  }

  return {
    source: payload.data.source_url,
    name: payload.data.name || payload.data.slug,
  }
}

async function cloneGithubSkillSource(sourceUrl: string): Promise<{
  sourcePath: string
  cleanupPath: string
  fallbackName: string
}> {
  const github = parseGithubTreeUrl(sourceUrl)
  if (!github) {
    throw ApiError.badRequest(`Unsupported GitHub source URL: ${sourceUrl}`)
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-yh-skill-git-'))
  const repoDir = path.join(tmpRoot, 'repo')

  try {
    await runProcess('git', [
      'clone',
      '--depth',
      '1',
      '--filter=blob:none',
      '--sparse',
      '--branch',
      github.branch,
      github.repoUrl,
      repoDir,
    ])

    if (github.subPath) {
      await runProcess('git', ['-C', repoDir, 'sparse-checkout', 'set', github.subPath])
    }

    return {
      sourcePath: path.join(repoDir, github.subPath),
      cleanupPath: tmpRoot,
      fallbackName: github.fallbackName,
    }
  } catch (error) {
    await fs.rm(tmpRoot, { recursive: true, force: true })
    throw ApiError.badRequest(
      `Failed to download GitHub skill source: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function loadSkillMeta(
  skillDir: string,
  skillName: string,
  source: 'user' | 'project',
): Promise<SkillMeta | null> {
  const skillFile = path.join(skillDir, 'SKILL.md')
  try {
    const raw = await fs.readFile(skillFile, 'utf-8')
    const { frontmatter, body } = normalizeFrontmatter(raw, skillFile)

    const description =
      (frontmatter.description as string) ||
      body
        .split('\n')
        .find((line) => line.trim().length > 0)
        ?.trim() ||
      'No description'

    return {
      name: skillName,
      displayName: (frontmatter.name as string) || undefined,
      description,
      source,
      userInvocable: frontmatter['user-invocable'] !== false,
      version: frontmatter.version != null ? String(frontmatter.version) : undefined,
      contentLength: raw.length,
      hasDirectory: true,
    }
  } catch {
    return null
  }
}

async function buildFileTree(
  dirPath: string,
): Promise<{ tree: FileTreeNode[]; files: SkillFile[] }> {
  const tree: FileTreeNode[] = []
  const files: SkillFile[] = []
  let fileCount = 0

  async function walk(currentPath: string, nodes: FileTreeNode[]) {
    if (fileCount >= MAX_FILES) return

    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true })
    } catch {
      return
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (fileCount >= MAX_FILES) break
      if (SKIP_ENTRIES.has(entry.name) || entry.name.startsWith('.')) continue

      const fullPath = path.join(currentPath, entry.name)
      const relPath = path.relative(dirPath, fullPath)

      if (entry.isDirectory()) {
        const node: FileTreeNode = {
          name: entry.name,
          path: relPath,
          type: 'directory',
          children: [],
        }
        nodes.push(node)
        await walk(fullPath, node.children!)
        if (node.children!.length === 0) delete node.children
        continue
      }

      if (!entry.isFile()) continue

      nodes.push({ name: entry.name, path: relPath, type: 'file' })

      try {
        const stat = await fs.stat(fullPath)
        if (stat.size > MAX_FILE_SIZE) continue

        const content = await fs.readFile(fullPath, 'utf-8')
        const language = detectLanguage(entry.name)
        const isEntry = relPath === 'SKILL.md'

        if (isEntry && language === 'markdown') {
          const { frontmatter, body } = normalizeFrontmatter(content, fullPath)
          files.push({
            path: relPath,
            content: body,
            body,
            frontmatter,
            language,
            isEntry: true,
          })
        } else {
          files.push({
            path: relPath,
            content,
            language,
            isEntry: false,
          })
        }

        fileCount++
      } catch {
        // skip unreadable files
      }
    }
  }

  await walk(dirPath, tree)
  return { tree, files }
}

function createSkillTemplate({
  name,
  displayName,
  description,
}: {
  name: string
  displayName?: string
  description?: string
}): string {
  const resolvedDescription =
    description?.trim() || 'Describe when this skill should be used.'
  const resolvedDisplayName = displayName?.trim() || name

  return `---
name: ${resolvedDisplayName}
version: "0.1.0"
description: ${resolvedDescription}
user-invocable: true
---

# ${resolvedDisplayName}

${resolvedDescription}

## When to use

- Add the conditions that should trigger this skill.
- Describe the kinds of tasks this skill helps with.

## Workflow

1. Explain the first step the agent should take.
2. Explain the core execution flow.
3. Describe how to verify the result.

## Notes

- Add project-specific guidance here.
`
}

export async function handleSkillsApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const sub = segments[2]

    if (req.method === 'GET') {
      switch (sub) {
        case undefined:
          return await listSkills()
        case 'detail':
          return await getSkillDetail(url)
        default:
          throw ApiError.notFound(`Unknown skills endpoint: ${sub}`)
      }
    }

    if (req.method === 'POST') {
      switch (sub) {
        case 'install':
          return await installSkill(req)
        case 'create':
          return await createSkill(req)
        case 'distill':
          return await distillSkill(req)
        case 'model-distill':
          return await modelDistillSkill(req)
        case 'evaluate':
          return await evaluateSkills(req)
        default:
          throw ApiError.notFound(`Unknown skills endpoint: ${sub}`)
      }
    }

    if (req.method === 'DELETE') {
      if (!sub) {
        throw ApiError.badRequest('Missing skill name')
      }
      return await deleteSkill(sub)
    }

    throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
  } catch (error) {
    return errorResponse(error)
  }
}

async function modelDistillSkill(req: Request): Promise<Response> {
  const body = await readJsonBody<ModelDistillSkillBody>(req)
  const candidate = body.candidate
  if (!candidate || typeof candidate.title !== 'string' || typeof candidate.content !== 'string') {
    throw ApiError.badRequest('candidate is required')
  }
  const name = sanitizeSkillFolderName(body.name || `memory-${candidate.title}`)
  const version = body.version || '0.1.0'
  const contentHash = `preview-${Buffer.from(candidate.title).toString('hex').slice(0, 16)}`
  const fallbackMarkdown = rewriteCandidateAsSkillMarkdown({
    candidate,
    name,
    version,
    contentHash,
  })
  const result = await rewriteSkillWithModelOrHeuristic({
    candidate,
    fallbackMarkdown,
    name,
    version,
  })
  return Response.json({
    markdown: result.markdown,
    judgement: result.judgement,
    modelUsed: result.modelUsed,
    heuristic: judgeSkillCandidateSuccess(candidate),
  })
}

async function evaluateSkills(req: Request): Promise<Response> {
  const body = await readJsonBody<EvaluateSkillBody>(req)
  if (!body.query?.trim()) {
    throw ApiError.badRequest('query is required')
  }
  const matches = await evaluateSkillRecall(body.query, getUserSkillsDir())
  return Response.json({ query: body.query, matches })
}

async function listSkills(): Promise<Response> {
  const skillsDir = getUserSkillsDir()
  const skills: SkillMeta[] = []

  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const meta = await loadSkillMeta(
        path.join(skillsDir, entry.name),
        entry.name,
        'user',
      )
      if (meta) skills.push(meta)
    }
  } catch {
    // return empty list when skills dir does not exist yet
  }

  skills.sort((a, b) => a.name.localeCompare(b.name))
  return Response.json({ skills, skillsDir })
}

async function getSkillDetail(url: URL): Promise<Response> {
  const source = url.searchParams.get('source')
  const name = url.searchParams.get('name')

  if (!source || !name) {
    throw ApiError.badRequest('Missing required query parameters: source, name')
  }

  assertValidSkillName(name)

  let skillDir: string
  if (source === 'user') {
    skillDir = path.join(getUserSkillsDir(), name)
  } else {
    throw ApiError.badRequest(`Unsupported source: ${source}`)
  }

  try {
    const stat = await fs.stat(skillDir)
    if (!stat.isDirectory()) throw new Error()
  } catch {
    throw ApiError.notFound(`Skill not found: ${name}`)
  }

  const meta = await loadSkillMeta(skillDir, name, source as 'user')
  if (!meta) {
    throw ApiError.notFound(`Skill missing SKILL.md: ${name}`)
  }

  const { tree, files } = await buildFileTree(skillDir)
  return Response.json({ detail: { meta, tree, files, skillRoot: skillDir } })
}

async function installSkill(req: Request): Promise<Response> {
  const body = await readJsonBody<InstallSkillBody>(req)
  const installSource = await resolveInstallSource(body)
  try {
    return await installSkillFromDirectory({
      sourcePath: installSource.sourcePath,
      name: body.name || installSource.name,
    })
  } finally {
    if (installSource.cleanupPath) {
      await fs.rm(installSource.cleanupPath, { recursive: true, force: true })
    }
  }
}

async function resolveInstallSource(body: InstallSkillBody): Promise<{
  sourcePath: string
  name?: string
  cleanupPath?: string
}> {
  if (body.sourcePath?.trim()) {
    return {
      sourcePath: await assertSkillSourceDir(body.sourcePath),
      name: body.name,
    }
  }

  const rawSource = (body.packageUrl || body.installCommand || '').trim()
  if (!rawSource) {
    throw ApiError.badRequest('sourcePath, packageUrl, or installCommand is required')
  }

  let source = parseInstallCommand(rawSource)
  let inferredName: string | undefined

  const claudateId = extractClaudatePackageId(source)
  if (claudateId) {
    const resolved = await resolveClaudateSource(claudateId)
    source = resolved.source
    inferredName = resolved.name
  } else if (!source.includes('://') && !source.includes('\\') && !source.includes('/')) {
    const resolved = await resolveClaudateSource(source)
    source = resolved.source
    inferredName = resolved.name
  }

  const github = parseGithubTreeUrl(source)
  if (github) {
    const cloned = await cloneGithubSkillSource(source)
    await assertSkillSourceDir(cloned.sourcePath)
    return {
      sourcePath: cloned.sourcePath,
      cleanupPath: cloned.cleanupPath,
      name: inferredName || cloned.fallbackName,
    }
  }

  if (source.startsWith('http://') || source.startsWith('https://')) {
    throw ApiError.badRequest(`Unsupported skill source URL: ${source}`)
  }

  return {
    sourcePath: await assertSkillSourceDir(source),
    name: inferredName || body.name,
  }
}

async function installSkillFromDirectory({
  sourcePath,
  name,
}: {
  sourcePath: string
  name?: string
}): Promise<Response> {
  const skillsDir = await ensureUserSkillsDir()
  const skillName = sanitizeSkillFolderName(name || path.basename(sourcePath))
  const targetDir = path.join(skillsDir, skillName)

  if (await pathExists(targetDir)) {
    throw ApiError.conflict(`Skill already exists: ${skillName}`)
  }

  await fs.cp(sourcePath, targetDir, {
    recursive: true,
    force: false,
    errorOnExist: true,
  })

  const meta = await loadSkillMeta(targetDir, skillName, 'user')
  if (!meta) {
    await fs.rm(targetDir, { recursive: true, force: true })
    throw ApiError.badRequest('Imported folder does not contain a valid SKILL.md')
  }

  return Response.json({ skill: meta, skillsDir }, { status: 201 })
}

async function createSkill(req: Request): Promise<Response> {
  const body = await readJsonBody<CreateSkillBody>(req)
  const skillName = sanitizeSkillFolderName(body.name || '')
  const skillsDir = await ensureUserSkillsDir()
  const targetDir = path.join(skillsDir, skillName)

  if (await pathExists(targetDir)) {
    throw ApiError.conflict(`Skill already exists: ${skillName}`)
  }

  await fs.mkdir(targetDir, { recursive: true })
  await fs.writeFile(
    path.join(targetDir, 'SKILL.md'),
    createSkillTemplate({
      name: skillName,
      displayName: body.displayName,
      description: body.description,
    }),
    'utf-8',
  )

  const meta = await loadSkillMeta(targetDir, skillName, 'user')
  if (!meta) {
    throw ApiError.internal(`Failed to create skill: ${skillName}`)
  }

  return Response.json({ skill: meta, skillsDir }, { status: 201 })
}

async function distillSkill(req: Request): Promise<Response> {
  const body = await readJsonBody<DistillSkillBody>(req)
  const markdown = body.markdown?.trim()
  if (!markdown) {
    throw ApiError.badRequest('markdown is required')
  }

  const parsed = normalizeFrontmatter(markdown, 'SKILL.md')
  const frontmatterName =
    typeof parsed.frontmatter.name === 'string'
      ? parsed.frontmatter.name
      : undefined
  const skillName = sanitizeSkillFolderName(body.name || frontmatterName || '')
  const scope = body.scope ?? 'user'
  const skillsDir =
    scope === 'project'
      ? getProjectSkillsDir(body.projectRoot)
      : await ensureUserSkillsDir()
  const targetDir = path.join(skillsDir, skillName)

  if ((await pathExists(targetDir)) && !body.overwrite) {
    throw ApiError.conflict(`Skill already exists: ${skillName}`)
  }

  if (!parsed.frontmatter.description && !parsed.frontmatter.when_to_use) {
    throw ApiError.badRequest(
      'Reviewed SKILL.md must include description or when_to_use frontmatter',
    )
  }

  await fs.mkdir(targetDir, { recursive: true })
  await fs.writeFile(path.join(targetDir, 'SKILL.md'), `${markdown}\n`, 'utf-8')

  const meta = await loadSkillMeta(
    targetDir,
    skillName,
    scope === 'project' ? 'project' : 'user',
  )
  if (!meta) {
    throw ApiError.badRequest('Saved candidate is not a valid SKILL.md')
  }

  return Response.json(
    {
      skill: meta,
      skillRoot: targetDir,
      scope,
      reviewed: true,
    },
    { status: body.overwrite ? 200 : 201 },
  )
}

function getProjectSkillsDir(projectRoot: string | undefined): string {
  if (!projectRoot?.trim()) {
    throw ApiError.badRequest('projectRoot is required for project skills')
  }
  const resolved = path.resolve(projectRoot)
  return path.join(resolved, '.claude-yh', 'skills')
}

async function deleteSkill(skillName: string): Promise<Response> {
  assertValidSkillName(skillName)

  const targetDir = path.join(getUserSkillsDir(), skillName)
  try {
    const stat = await fs.stat(targetDir)
    if (!stat.isDirectory()) throw new Error()
  } catch {
    throw ApiError.notFound(`Skill not found: ${skillName}`)
  }

  await fs.rm(targetDir, { recursive: true, force: true })
  return Response.json({ ok: true, name: skillName })
}

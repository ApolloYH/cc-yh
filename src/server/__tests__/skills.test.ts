import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { handleSkillsApi } from '../api/skills.js'

let tmpRoot = ''
let skillsDir = ''
let sourceDir = ''

function skillUrl(pathname: string) {
  return new URL(`http://127.0.0.1:3456${pathname}`)
}

async function readJson(res: Response) {
  return (await res.json()) as Record<string, unknown>
}

describe('skills api', () => {
  const originalFetch = globalThis.fetch

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-yh-skills-'))
    skillsDir = path.join(tmpRoot, 'skills')
    sourceDir = path.join(tmpRoot, 'source-skill')
    await fs.mkdir(skillsDir, { recursive: true })
    process.env.CLAUDE_YH_SKILLS_DIR = skillsDir
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    delete process.env.CLAUDE_YH_SKILLS_DIR
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  })

  it('lists the configured skills directory even when empty', async () => {
    const url = skillUrl('/api/skills')
    const res = await handleSkillsApi(new Request(url), url, ['api', 'skills'])
    const body = await readJson(res)

    expect(res.status).toBe(200)
    expect(body.skills).toEqual([])
    expect(body.skillsDir).toBe(skillsDir)
  })

  it('creates a skill scaffold and returns it in list/detail', async () => {
    const createUrl = skillUrl('/api/skills/create')
    const createRes = await handleSkillsApi(
      new Request(createUrl, {
        method: 'POST',
        body: JSON.stringify({
          name: 'review-helper',
          displayName: 'Review Helper',
          description: 'Use when reviewing local changes.',
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      createUrl,
      ['api', 'skills', 'create'],
    )

    expect(createRes.status).toBe(201)
    const createBody = await readJson(createRes)
    expect((createBody.skill as Record<string, unknown>).name).toBe('review-helper')

    const listUrl = skillUrl('/api/skills')
    const listRes = await handleSkillsApi(new Request(listUrl), listUrl, ['api', 'skills'])
    const listBody = await readJson(listRes)
    expect((listBody.skills as Array<Record<string, unknown>>).length).toBe(1)

    const detailUrl = skillUrl('/api/skills/detail?source=user&name=review-helper')
    const detailRes = await handleSkillsApi(
      new Request(detailUrl),
      detailUrl,
      ['api', 'skills', 'detail'],
    )
    const detailBody = await readJson(detailRes)
    const detail = detailBody.detail as Record<string, unknown>
    expect(((detail.meta as Record<string, unknown>).displayName)).toBe('Review Helper')
    expect((detail.files as Array<Record<string, unknown>>).some((file) => file.path === 'SKILL.md')).toBe(true)
  })

  it('installs a local skill folder and deletes it again', async () => {
    await fs.mkdir(sourceDir, { recursive: true })
    await fs.writeFile(
      path.join(sourceDir, 'SKILL.md'),
      `---
name: Source Skill
description: Imported from disk
user-invocable: true
---

# Source Skill
`,
      'utf-8',
    )
    await fs.writeFile(path.join(sourceDir, 'notes.md'), 'hello', 'utf-8')

    const installUrl = skillUrl('/api/skills/install')
    const installRes = await handleSkillsApi(
      new Request(installUrl, {
        method: 'POST',
        body: JSON.stringify({
          sourcePath: sourceDir,
          name: 'imported-skill',
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      installUrl,
      ['api', 'skills', 'install'],
    )

    expect(installRes.status).toBe(201)
    expect(await fs.stat(path.join(skillsDir, 'imported-skill', 'SKILL.md'))).toBeDefined()

    const deleteUrl = skillUrl('/api/skills/imported-skill')
    const deleteRes = await handleSkillsApi(
      new Request(deleteUrl, { method: 'DELETE' }),
      deleteUrl,
      ['api', 'skills', 'imported-skill'],
    )

    expect(deleteRes.status).toBe(200)
    await expect(fs.stat(path.join(skillsDir, 'imported-skill'))).rejects.toThrow()
  })

  it('installs a skill from a Claudate package URL without running shell commands', async () => {
    await fs.mkdir(sourceDir, { recursive: true })
    await fs.writeFile(
      path.join(sourceDir, 'SKILL.md'),
      `---
name: Package Skill
description: Imported from Claudate metadata
---

# Package Skill
`,
      'utf-8',
    )

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        'https://api.claudate.com/api/packages/async-python-patterns-mi0sl0gx',
      )
      return Response.json({
        success: true,
        data: {
          type: 'skill',
          name: 'async-python-patterns',
          slug: 'async-python-patterns-mi0sl0gx',
          source_url: sourceDir,
        },
      })
    }) as typeof fetch

    const installUrl = skillUrl('/api/skills/install')
    const installRes = await handleSkillsApi(
      new Request(installUrl, {
        method: 'POST',
        body: JSON.stringify({
          packageUrl: 'https://claudate.com/zh/package/async-python-patterns-mi0sl0gx',
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      installUrl,
      ['api', 'skills', 'install'],
    )

    expect(installRes.status).toBe(201)
    expect(await fs.stat(path.join(skillsDir, 'async-python-patterns', 'SKILL.md'))).toBeDefined()
  })

  it('parses a claude-yh install command that points at a local skill folder', async () => {
    await fs.mkdir(sourceDir, { recursive: true })
    await fs.writeFile(
      path.join(sourceDir, 'SKILL.md'),
      `---
name: Command Skill
description: Imported from command
---

# Command Skill
`,
      'utf-8',
    )

    const installUrl = skillUrl('/api/skills/install')
    const installRes = await handleSkillsApi(
      new Request(installUrl, {
        method: 'POST',
        body: JSON.stringify({
          installCommand: `claude-yh skill install "${sourceDir}"`,
          name: 'command-skill',
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      installUrl,
      ['api', 'skills', 'install'],
    )

    expect(installRes.status).toBe(201)
    expect(await fs.stat(path.join(skillsDir, 'command-skill', 'SKILL.md'))).toBeDefined()
  })
})

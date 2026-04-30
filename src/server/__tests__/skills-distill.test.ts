import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleSkillsApi } from '../api/skills.js'

let tmpDir: string
let originalSkillsDir: string | undefined

describe('Skills distillation API', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-distill-'))
    originalSkillsDir = process.env.CLAUDE_YH_SKILLS_DIR
    process.env.CLAUDE_YH_SKILLS_DIR = path.join(tmpDir, 'skills')
  })

  afterEach(async () => {
    if (originalSkillsDir === undefined) delete process.env.CLAUDE_YH_SKILLS_DIR
    else process.env.CLAUDE_YH_SKILLS_DIR = originalSkillsDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('saves a reviewed SKILL.md candidate for later recall', async () => {
    const markdown = `---
name: Provider Fix
description: Use when fixing OpenAI-compatible provider configuration after a failed CLI request.
user-invocable: true
---

# Provider Fix

## Steps
1. Inspect provider settings.
2. Verify with a CLI smoke test.
`
    const req = new Request('http://localhost/api/skills/distill', {
      method: 'POST',
      body: JSON.stringify({
        name: 'provider-fix',
        markdown,
      }),
    })
    const url = new URL(req.url)
    const response = await handleSkillsApi(req, url, ['api', 'skills', 'distill'])
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.reviewed).toBe(true)
    expect(body.skill.name).toBe('provider-fix')
    const saved = await fs.readFile(
      path.join(tmpDir, 'skills', 'provider-fix', 'SKILL.md'),
      'utf-8',
    )
    expect(saved).toContain('Provider Fix')
  })
})

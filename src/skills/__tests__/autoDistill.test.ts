import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  autoDistillSkillFromMemoryCandidate,
  isSuccessfulReusableCandidate,
} from '../autoDistill.js'
import { evaluateSkillRecall } from '../recallEval.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalDisableMainModel: string | undefined

describe('auto skill distillation', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-skill-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalDisableMainModel = process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION = '1'
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    if (originalDisableMainModel === undefined) delete process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION
    else process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION = originalDisableMainModel
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('rejects failed or low-confidence candidates', () => {
    expect(isSuccessfulReusableCandidate({
      id: 'x',
      layer: 'L3',
      title: 'Failed browser repair',
      content: 'failed and not solved',
      source: 'test',
      confidence: 0.9,
      reason: 'test',
      verified: true,
    })).toBe(false)
  })

  it('dedupes identical successful candidates and evaluates recall', async () => {
    const candidate = {
      id: 'candidate-1',
      layer: 'L3' as const,
      title: 'BrowserControl TMWD tab verification',
      content: '1. Run /browser tabs\n2. Verify the TMWD extension is connected\n3. Confirm the workflow passed',
      source: 'session-1',
      confidence: 0.91,
      reason: 'verified workflow',
      verified: true as const,
    }

    const first = await autoDistillSkillFromMemoryCandidate(candidate)
    const second = await autoDistillSkillFromMemoryCandidate(candidate)

    expect(first?.reused).toBe(false)
    expect(second?.reused).toBe(true)
    expect(second?.name).toBe(first?.name)

    const markdown = await fs.readFile(first!.skillPath, 'utf-8')
    expect(markdown).toContain('## Success Criteria')
    expect(markdown).toContain('x-claude-yh-source-hash')

    const matches = await evaluateSkillRecall(
      'verify chrome browser tmwd tabs',
      path.join(tmpDir, 'skills'),
    )
    expect(matches[0]?.name).toBe(first?.name)
  })

  it('uses the configured main model to judge and rewrite skills', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const body = await req.json() as Record<string, unknown>
        expect(req.headers.get('authorization')).toBe('Bearer main-model-key')
        expect(body.model).toBe('main-model')
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  successful: true,
                  reusable: true,
                  confidence: 0.94,
                  reasons: ['The workflow was verified and reusable.'],
                  markdown: [
                    '# Model Rewritten Skill',
                    '',
                    '## Workflow',
                    '1. Verify the browser bridge.',
                    '',
                    '## Success Criteria',
                    '- The bridge responds.',
                  ].join('\n'),
                }),
              },
            },
          ],
        })
      },
    })
    try {
      delete process.env.CLAUDE_YH_DISABLE_MAIN_MODEL_AUTOMATION
      await fs.writeFile(path.join(tmpDir, 'settings.json'), JSON.stringify({
        claudeYhProviders: {
          activeId: 'provider-1',
          providers: [
            {
              id: 'provider-1',
              presetId: 'custom',
              name: 'Mock main model',
              apiKey: 'main-model-key',
              baseUrl: `http://127.0.0.1:${server.port}`,
              apiFormat: 'openai_chat',
              models: {
                main: 'main-model',
                haiku: 'main-model',
                sonnet: 'main-model',
                opus: 'main-model',
              },
            },
          ],
        },
      }, null, 2), 'utf-8')

      const result = await autoDistillSkillFromMemoryCandidate({
        id: 'candidate-model',
        layer: 'L3',
        title: 'Borderline browser workflow',
        content: 'Browser task finished.',
        source: 'session-model',
        confidence: 0.51,
        reason: 'model should decide',
        verified: true,
      })

      expect(result?.modelUsed).toBe(true)
      const markdown = await fs.readFile(result!.skillPath, 'utf-8')
      expect(markdown).toContain('Model Rewritten Skill')
    } finally {
      server.stop(true)
    }
  })
})

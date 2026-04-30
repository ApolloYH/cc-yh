import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { recordJarvisRuntimeEvent } from '../eventRouter.js'
import { readJarvisInboxMessages } from '../inbox.js'
import { readJarvisTranscriptEntries } from '../transcript.js'

let tmpDir: string
let originalConfigDir: string | undefined

describe('Jarvis runtime event router', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-events-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('keeps raw tool events out of the visible inbox but stores them in transcript', async () => {
    await recordJarvisRuntimeEvent({
      kind: 'tool_event',
      title: 'raw tool',
      message: 'tool payload',
      priority: 'silent',
    })

    expect(await readJarvisInboxMessages(10)).toHaveLength(0)
    expect((await readJarvisTranscriptEntries(10))[0]?.message).toBe('tool payload')
  })

  it('publishes interrupt events to both inbox and transcript', async () => {
    await recordJarvisRuntimeEvent({
      kind: 'reminder_fired',
      title: '提醒到了',
      message: '时间到了，你好',
    })

    expect((await readJarvisInboxMessages(10))[0]?.title).toBe('提醒到了')
    expect((await readJarvisTranscriptEntries(10))[0]?.message).toContain('你好')
  })
})

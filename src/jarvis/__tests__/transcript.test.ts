import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  backupAndClearJarvisInbox,
  appendJarvisInboxMessage,
  readJarvisInboxMessages,
} from '../inbox.js'
import {
  buildJarvisTranscriptContext,
  readJarvisTranscriptEntries,
} from '../transcript.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalDisableMainModel: string | undefined

describe('Jarvis transcript', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-transcript-'))
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

  it('mirrors visible Jarvis messages into the transcript context', async () => {
    await appendJarvisInboxMessage({
      role: 'user',
      source: 'desktop',
      title: '交给 Jarvis 的消息',
      message: '你刚才记住这句话',
    })
    await appendJarvisInboxMessage({
      role: 'jarvis',
      source: 'system',
      title: 'Jarvis 回复',
      message: '我会在当前 Jarvis 对话中保留它。',
    })

    const entries = await readJarvisTranscriptEntries(10)
    const context = await buildJarvisTranscriptContext({ maxChars: 4000 })

    expect(entries).toHaveLength(2)
    expect(context.recent).toContain('你刚才记住这句话')
    expect(context.recent).toContain('我会在当前 Jarvis 对话中保留它')
  })

  it('clears both visible inbox and transcript when starting /new', async () => {
    await appendJarvisInboxMessage({
      role: 'user',
      source: 'desktop',
      message: '旧对话',
    })

    await backupAndClearJarvisInbox()

    expect(await readJarvisInboxMessages(10)).toHaveLength(0)
    expect(await readJarvisTranscriptEntries(10)).toHaveLength(0)
  })
})

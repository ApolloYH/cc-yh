import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { readJarvisInboxMessages } from '../inbox.js'
import type { JarvisQueueItem } from '../queue.js'
import { handleJarvisManagerStreamLine } from '../streamReporter.js'

let tmpDir: string
let originalConfigDir: string | undefined

describe('Jarvis stream reporter', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-reporter-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('aggregates tool events into stage reports instead of spamming every tool result', async () => {
    const item = makeItem()

    await handleJarvisManagerStreamLine({
      item,
      sessionId: 'session-1',
      line: JSON.stringify(assistantTool('Glob', 'tool-1')),
    })
    for (let index = 0; index < 6; index++) {
      await handleJarvisManagerStreamLine({
        item,
        sessionId: 'session-1',
        line: JSON.stringify(assistantTool('Read', `read-${index}`)),
      })
      await handleJarvisManagerStreamLine({
        item,
        sessionId: 'session-1',
        line: JSON.stringify(toolResult(`read-${index}`)),
      })
    }

    const titles = (await readJarvisInboxMessages(20))
      .map(message => message.title)
      .filter(Boolean)

    expect(titles).toContain('开始扫描项目结构')
    expect(titles).toContain('已读取 1 个关键文件')
    expect(titles).toContain('已读取 3 个关键文件')
    expect(titles).toContain('已读取 6 个关键文件')
    expect(titles).not.toContain('正在调用工具')
    expect(titles).not.toContain('工具返回结果')
  })

  it('does not mark normal final analysis text as an error just because it mentions failed attempts', async () => {
    const item = makeItem()

    await handleJarvisManagerStreamLine({
      item,
      sessionId: 'session-1',
      line: JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'text',
            text: [
              '## dots2api 项目分析',
              '',
              '项目尝试直接 API 调用失败，最终采用 DOM 操作。',
              '',
              '**TaskId**: task-1',
            ].join('\n'),
          }],
        },
      }),
    })

    const messages = await readJarvisInboxMessages(20)
    expect(messages.some(message => message.severity === 'error')).toBe(false)
  })
})

function makeItem(): JarvisQueueItem {
  const now = new Date().toISOString()
  return {
    id: 'task-1',
    prompt: '研究 dots2api 项目',
    title: 'dots2api项目：Web转API实现分析',
    priority: 75,
    status: 'running',
    approvalState: 'none',
    attempts: 1,
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now,
  }
}

function assistantTool(name: string, id: string): unknown {
  return {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id,
          name,
          input: {},
        },
      ],
    },
  }
}

function toolResult(id: string): unknown {
  return {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: 'ok',
        },
      ],
    },
  }
}

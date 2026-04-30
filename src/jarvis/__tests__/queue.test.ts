import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  claimNextJarvisTask,
  enqueueJarvisTask,
  listJarvisQueue,
  recoverInterruptedJarvisQueue,
  updateJarvisQueueItem,
} from '../queue.js'

let tmpDir: string
let originalConfigDir: string | undefined

describe('Jarvis persistent queue', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-queue-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('claims by priority and recovers interrupted running items', async () => {
    await enqueueJarvisTask({ prompt: 'low', priority: 10 })
    const high = await enqueueJarvisTask({ prompt: 'high', priority: 90 })

    const claimed = await claimNextJarvisTask()
    expect(claimed?.id).toBe(high.id)
    expect(claimed?.status).toBe('running')
    expect(claimed?.attempts).toBe(1)

    const recovered = await recoverInterruptedJarvisQueue()
    expect(recovered).toBe(1)

    const items = await listJarvisQueue()
    expect(items.find(item => item.id === high.id)?.status).toBe('pending')
  })

  it('pauses and resumes queue items with checkpoints', async () => {
    const item = await enqueueJarvisTask({ prompt: 'continue project', priority: 50 })
    await updateJarvisQueueItem(item.id, {
      status: 'paused',
      checkpoint: 'Need approval before sending external message.',
    })
    const paused = (await listJarvisQueue()).find(entry => entry.id === item.id)
    expect(paused?.status).toBe('paused')
    expect(paused?.checkpoint).toContain('approval')
  })
})

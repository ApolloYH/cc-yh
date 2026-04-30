import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  claimNextJarvisTask,
  deleteJarvisQueueItem,
  getJarvisQueuePath,
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

  it('deletes queue items permanently', async () => {
    const item = await enqueueJarvisTask({ prompt: 'remove me', priority: 50 })
    const deleted = await deleteJarvisQueueItem(item.id)
    expect(deleted?.id).toBe(item.id)

    const items = await listJarvisQueue()
    expect(items.find(entry => entry.id === item.id)).toBeUndefined()
    expect(await deleteJarvisQueueItem(item.id)).toBeNull()
  })

  it('claims concurrent workers without duplicating queue ownership', async () => {
    const first = await enqueueJarvisTask({ prompt: 'first', priority: 50 })
    const second = await enqueueJarvisTask({ prompt: 'second', priority: 50 })

    const claimed = await Promise.all([
      claimNextJarvisTask(),
      claimNextJarvisTask(),
    ])
    const ids = claimed.map(item => item?.id).filter(Boolean)

    expect(new Set(ids).size).toBe(2)
    expect(ids).toContain(first.id)
    expect(ids).toContain(second.id)
  })

  it('repairs a partially written queue file without crashing status reads', async () => {
    const valid = await enqueueJarvisTask({ prompt: 'keep me', priority: 50 })
    const filePath = getJarvisQueuePath()
    const raw = await fs.readFile(filePath, 'utf-8')
    await fs.writeFile(filePath, raw.replace(/\n]\n}\n$/, ',\n  { "id": "broken"'), 'utf-8')

    const items = await listJarvisQueue()

    expect(items.map(item => item.id)).toContain(valid.id)
    expect(items.every(item => item.id !== 'broken')).toBe(true)
    const repaired = JSON.parse(await fs.readFile(filePath, 'utf-8')) as { items?: unknown[] }
    expect(Array.isArray(repaired.items)).toBe(true)
  })
})

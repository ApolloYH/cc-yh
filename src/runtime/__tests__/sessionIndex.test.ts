import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { buildSessionIndex } from '../sessionIndex.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-index-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeSession(
  projectPath: string,
  sessionId: string,
  entries: Record<string, unknown>[],
): Promise<void> {
  const dir = path.join(tmpDir, 'projects', projectPath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, `${sessionId}.jsonl`),
    entries.map(entry => JSON.stringify(entry)).join('\n') + '\n',
    'utf-8',
  )
}

describe('buildSessionIndex', () => {
  it('indexes session JSONL files without reading agent sidechain transcripts', async () => {
    await writeSession('-repo-a', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', [
      {
        type: 'user',
        message: { role: 'user', content: 'Build the index' },
        timestamp: '2026-04-26T01:00:00.000Z',
      },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
        timestamp: '2026-04-26T01:01:00.000Z',
      },
    ])
    await fs.writeFile(
      path.join(tmpDir, 'projects', '-repo-a', 'agent-worker.jsonl'),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'skip' } }),
      'utf-8',
    )

    const result = await buildSessionIndex({ configDir: tmpDir })

    expect(result.source).toBe('typescript')
    expect(result.total).toBe(1)
    expect(result.sessions[0]).toMatchObject({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      projectPath: '-repo-a',
      createdAt: '2026-04-26T01:00:00.000Z',
      messageCount: 2,
      title: 'Build the index',
    })
  })

  it('handles missing projects dir as an empty index', async () => {
    const result = await buildSessionIndex({ configDir: tmpDir })

    expect(result.sessions).toEqual([])
    expect(result.total).toBe(0)
  })

  it('supports project filtering and limits', async () => {
    await writeSession('-repo-a', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', [
      { type: 'user', message: { role: 'user', content: 'A' } },
    ])
    await writeSession('-repo-b', 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', [
      { type: 'user', message: { role: 'user', content: 'B' } },
    ])

    const result = await buildSessionIndex({
      configDir: tmpDir,
      project: '-repo-b',
      limit: 1,
    })

    expect(result.total).toBe(1)
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].projectPath).toBe('-repo-b')
  })

  it('supports query filtering across title and project path', async () => {
    await writeSession('-repo-a', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', [
      { type: 'user', message: { role: 'user', content: 'Build memory index' } },
    ])
    await writeSession('-repo-b', 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', [
      { type: 'user', message: { role: 'user', content: 'Fix provider config' } },
    ])

    const byTitle = await buildSessionIndex({
      configDir: tmpDir,
      query: 'provider',
    })
    expect(byTitle.total).toBe(1)
    expect(byTitle.sessions[0].title).toBe('Fix provider config')

    const byProject = await buildSessionIndex({
      configDir: tmpDir,
      query: 'repo-a',
    })
    expect(byProject.total).toBe(1)
    expect(byProject.sessions[0].projectPath).toBe('-repo-a')
  })
})

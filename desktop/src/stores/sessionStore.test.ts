import '../test/setupDom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createMock, listMock, updateWorkDirMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  listMock: vi.fn(),
  updateWorkDirMock: vi.fn(),
}))

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    create: createMock,
    list: listMock,
    updateWorkDir: updateWorkDirMock,
    getMessages: vi.fn(async () => ({ messages: [] })),
    delete: vi.fn(async () => ({ ok: true })),
    rename: vi.fn(async () => ({ ok: true })),
    getRecentProjects: vi.fn(async () => ({ projects: [] })),
    getGitInfo: vi.fn(async () => ({
      branch: null,
      repoName: null,
      workDir: '',
      changedFiles: 0,
    })),
    getSlashCommands: vi.fn(async () => ({ commands: [] })),
  },
}))

import { useSessionStore } from './sessionStore'

const initialState = useSessionStore.getState()

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('sessionStore', () => {
  beforeEach(() => {
    createMock.mockReset()
    listMock.mockReset()
    updateWorkDirMock.mockReset()
    useSessionStore.setState({
      ...initialState,
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      error: null,
      selectedProjects: [],
      availableProjects: [],
    })
  })

  afterEach(() => {
    useSessionStore.setState(initialState)
  })

  it('returns a new session id before the background refresh completes', async () => {
    createMock.mockResolvedValue({ sessionId: 'session-optimistic-1' })
    listMock.mockImplementation(() => new Promise(() => {}))

    const result = await Promise.race([
      useSessionStore.getState().createSession('D:/workspace/code/myself_code/claude-yh'),
      delay(100).then(() => 'timed-out'),
    ])

    expect(result).toBe('session-optimistic-1')
    expect(useSessionStore.getState().activeSessionId).toBe('session-optimistic-1')
    expect(useSessionStore.getState().sessions[0]).toMatchObject({
      id: 'session-optimistic-1',
      title: 'New Session',
      workDir: 'D:/workspace/code/myself_code/claude-yh',
      workDirExists: true,
    })
    expect(listMock).toHaveBeenCalledOnce()
  })

  it('updates an empty session workDir optimistically before refresh completes', async () => {
    listMock.mockImplementation(() => new Promise(() => {}))
    updateWorkDirMock.mockResolvedValue({ ok: true })

    useSessionStore.setState({
      sessions: [{
        id: 'empty-session-1',
        title: 'New Session',
        createdAt: '2026-04-23T00:00:00.000Z',
        modifiedAt: '2026-04-23T00:00:00.000Z',
        messageCount: 0,
        projectPath: 'C:/Users/y1513',
        workDir: 'C:/Users/y1513',
        workDirExists: true,
      }],
      activeSessionId: 'empty-session-1',
      isLoading: false,
      error: null,
      selectedProjects: [],
      availableProjects: [],
    })

    await useSessionStore.getState().updateSessionWorkDir('empty-session-1', 'D:/workspace/demo')

    expect(updateWorkDirMock).toHaveBeenCalledWith('empty-session-1', 'D:/workspace/demo')
    expect(useSessionStore.getState().sessions[0]).toMatchObject({
      id: 'empty-session-1',
      workDir: 'D:/workspace/demo',
      projectPath: 'D:/workspace/demo',
      workDirExists: true,
    })
  })
})

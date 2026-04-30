import { create } from 'zustand'
import { sessionsApi } from '../api/sessions'
import type { SessionListItem } from '../types/session'

type SessionStore = {
  sessions: SessionListItem[]
  activeSessionId: string | null
  isLoading: boolean
  error: string | null
  selectedProjects: string[]
  availableProjects: string[]

  fetchSessions: (project?: string) => Promise<void>
  createSession: (workDir?: string) => Promise<string>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  updateSessionWorkDir: (id: string, workDir: string) => Promise<void>
  updateSessionTitle: (id: string, title: string) => void
  setActiveSession: (id: string | null) => void
  setSelectedProjects: (projects: string[]) => void
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isLoading: false,
  error: null,
  selectedProjects: [],
  availableProjects: [],

  fetchSessions: async (project?: string) => {
    set({ isLoading: true, error: null })
    try {
      const { sessions: raw } = await sessionsApi.list({ project, limit: 100 })
      // Deduplicate by session ID — keep the most recently modified entry
      const byId = new Map<string, SessionListItem>()
      for (const s of raw) {
        const existing = byId.get(s.id)
        if (!existing || new Date(s.modifiedAt) > new Date(existing.modifiedAt)) {
          byId.set(s.id, s)
        }
      }
      const sessions = [...byId.values()]
      const availableProjects = [...new Set(sessions.map((s) => s.projectPath).filter(Boolean))].sort()
      set({ sessions, availableProjects, isLoading: false })
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  createSession: async (workDir?: string) => {
    const { sessionId: id } = await sessionsApi.create(workDir || undefined)
    const now = new Date().toISOString()
    const optimisticSession: SessionListItem = {
      id,
      title: 'New Session',
      createdAt: now,
      modifiedAt: now,
      messageCount: 0,
      projectPath: '',
      workDir: workDir ?? null,
      workDirExists: true,
    }

    set((state) => ({
      sessions: state.sessions.some((session) => session.id === id)
        ? state.sessions
        : [optimisticSession, ...state.sessions],
      activeSessionId: id,
    }))

    void get().fetchSessions()
    return id
  },

  deleteSession: async (id: string) => {
    await sessionsApi.delete(id)
    set((s) => ({
      sessions: s.sessions.filter((session) => session.id !== id),
      activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
    }))
  },

  renameSession: async (id: string, title: string) => {
    await sessionsApi.rename(id, title)
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id ? { ...session, title } : session,
      ),
    }))
  },

  updateSessionWorkDir: async (id: string, workDir: string) => {
    const previousSession = get().sessions.find((session) => session.id === id)
    const now = new Date().toISOString()

    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id
          ? {
              ...session,
              workDir,
              projectPath: workDir,
              workDirExists: true,
              modifiedAt: now,
            }
          : session,
      ),
    }))

    try {
      await sessionsApi.updateWorkDir(id, workDir)
      void get().fetchSessions()
    } catch (error) {
      if (previousSession) {
        set((s) => ({
          sessions: s.sessions.map((session) =>
            session.id === id ? previousSession : session,
          ),
        }))
      }
      throw error
    }
  },

  updateSessionTitle: (id, title) => {
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id ? { ...session, title } : session,
      ),
    }))
  },

  setActiveSession: (id) => set({ activeSessionId: id }),
  setSelectedProjects: (projects) => set({ selectedProjects: projects }),
}))

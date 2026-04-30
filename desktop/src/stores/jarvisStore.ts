import { create } from 'zustand'
import { jarvisApi } from '../api/jarvis'
import type { JarvisAutostartStatus } from '../api/jarvis'
import type { JarvisModeConfig, JarvisStatus } from '../types/jarvis'

type JarvisStore = {
  status: JarvisStatus | null
  autostart: JarvisAutostartStatus | null
  isLoading: boolean
  isSaving: boolean
  error: string | null
  fetchStatus: () => Promise<void>
  updateConfig: (config: Partial<JarvisModeConfig>) => Promise<void>
  updateAutostart: (enabled: boolean) => Promise<void>
  submitTask: (goal: string) => Promise<void>
  tick: () => Promise<void>
}

export const useJarvisStore = create<JarvisStore>((set) => ({
  status: null,
  autostart: null,
  isLoading: false,
  isSaving: false,
  error: null,

  fetchStatus: async () => {
    set({ isLoading: true, error: null })
    try {
      const [status, autostart] = await Promise.all([
        jarvisApi.getStatus(),
        jarvisApi.autostart(),
      ])
      set({ status, autostart, isLoading: false })
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  updateAutostart: async (enabled) => {
    set({ isSaving: true, error: null })
    try {
      const autostart = await jarvisApi.updateAutostart(enabled)
      set({ autostart, isSaving: false })
    } catch (err) {
      set({ error: (err as Error).message, isSaving: false })
    }
  },

  updateConfig: async (config) => {
    set({ isSaving: true, error: null })
    try {
      const status = await jarvisApi.updateConfig(config)
      set({ status, isSaving: false })
    } catch (err) {
      set({ error: (err as Error).message, isSaving: false })
    }
  },

  submitTask: async (goal) => {
    set({ isSaving: true, error: null })
    try {
      const { status } = await jarvisApi.submitTask(goal, 75)
      set({ status, isSaving: false })
    } catch (err) {
      set({ error: (err as Error).message, isSaving: false })
    }
  },

  tick: async () => {
    set({ isSaving: true, error: null })
    try {
      const { status } = await jarvisApi.tick()
      set({ status, isSaving: false })
    } catch (err) {
      set({ error: (err as Error).message, isSaving: false })
    }
  },
}))

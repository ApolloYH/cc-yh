import { create } from 'zustand'
import { jarvisApi } from '../api/jarvis'
import type { JarvisModeConfig, JarvisStatus } from '../types/jarvis'

type JarvisStore = {
  status: JarvisStatus | null
  isLoading: boolean
  isSaving: boolean
  error: string | null
  fetchStatus: () => Promise<void>
  updateConfig: (config: Partial<JarvisModeConfig>) => Promise<void>
  tick: () => Promise<void>
}

export const useJarvisStore = create<JarvisStore>((set) => ({
  status: null,
  isLoading: false,
  isSaving: false,
  error: null,

  fetchStatus: async () => {
    set({ isLoading: true, error: null })
    try {
      const status = await jarvisApi.getStatus()
      set({ status, isLoading: false })
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
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

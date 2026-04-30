import { api } from './client'
import type { JarvisModeConfig, JarvisStatus, JarvisEvent, JarvisCloudConfig } from '../types/jarvis'

export type JarvisAutostartStatus = {
  supported: boolean
  enabled: boolean
  targetPath: string
  watchdogPath: string
  command: string
  restartDelaySeconds: number
  note?: string
}

export const jarvisApi = {
  getStatus() {
    return api.get<JarvisStatus>('/api/jarvis')
  },

  updateConfig(config: Partial<JarvisModeConfig>) {
    return api.put<JarvisStatus>('/api/jarvis/config', config)
  },

  start() {
    return api.post<JarvisStatus>('/api/jarvis/start', {})
  },

  stop() {
    return api.post<JarvisStatus>('/api/jarvis/stop', {})
  },

  tick() {
    return api.post<{ event: JarvisEvent; status: JarvisStatus }>('/api/jarvis/tick', {})
  },

  submitTask(goal: string, priority?: number) {
    return api.post<{ status: JarvisStatus }>('/api/jarvis/task', { goal, priority })
  },

  autostart() {
    return api.get<JarvisAutostartStatus>('/api/jarvis/autostart')
  },

  updateAutostart(enabled: boolean) {
    return api.put<JarvisAutostartStatus>('/api/jarvis/autostart', { enabled })
  },

  cloud() {
    return api.get<{ cloud: JarvisCloudConfig }>('/api/jarvis/cloud')
  },

  updateCloud(config: Partial<JarvisCloudConfig> & { token?: string }) {
    return api.put<{ cloud: JarvisCloudConfig }>('/api/jarvis/cloud', config)
  },
}

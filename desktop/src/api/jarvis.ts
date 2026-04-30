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

  submitTask(goal: string, priority?: number, clientMessageId?: string) {
    return api.post<{ status: JarvisStatus }>('/api/jarvis/task', { goal, priority, source: 'desktop', clientMessageId })
  },

  queueAction(id: string, action: 'pause' | 'resume' | 'approve' | 'checkpoint' | 'delete') {
    return api.post<{ status: JarvisStatus }>('/api/jarvis/queue-action', { id, action })
  },

  runAction(id: string, action: 'pause' | 'resume' | 'cancel') {
    return api.post<{ status: JarvisStatus }>('/api/jarvis/run-action', { id, action })
  },

  resolveApproval(id: string, decision: 'approved' | 'rejected', note?: string) {
    return api.post<{ status: JarvisStatus }>('/api/jarvis/approval', { id, decision, note })
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

import { api } from './client'
import type { JarvisModeConfig, JarvisStatus, JarvisEvent } from '../types/jarvis'

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
}

import { api } from './client'
import type { SkillMeta, SkillDetail } from '../types/skill'

export const skillsApi = {
  list: () => api.get<{ skills: SkillMeta[]; skillsDir: string }>('/api/skills'),

  detail: (source: string, name: string) =>
    api.get<{ detail: SkillDetail }>(
      `/api/skills/detail?source=${encodeURIComponent(source)}&name=${encodeURIComponent(name)}`,
    ),

  install: (input: {
    sourcePath?: string
    packageUrl?: string
    installCommand?: string
    name?: string
  }) =>
    api.post<{ skill: SkillMeta; skillsDir: string }>('/api/skills/install', input),

  create: (input: { name: string; displayName?: string; description?: string }) =>
    api.post<{ skill: SkillMeta; skillsDir: string }>('/api/skills/create', input),

  delete: (name: string) =>
    api.delete<{ ok: true; name: string }>(`/api/skills/${encodeURIComponent(name)}`),
}

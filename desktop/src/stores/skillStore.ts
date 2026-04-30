import { create } from 'zustand'
import { skillsApi } from '../api/skills'
import type { SkillMeta, SkillDetail } from '../types/skill'

type InstallSkillInput = {
  sourcePath?: string
  packageUrl?: string
  installCommand?: string
  name?: string
}

type SkillStore = {
  skills: SkillMeta[]
  skillsDir: string
  selectedSkill: SkillDetail | null
  isLoading: boolean
  isDetailLoading: boolean
  isMutating: boolean
  error: string | null
  operationMessage: string | null

  fetchSkills: () => Promise<void>
  fetchSkillDetail: (source: string, name: string) => Promise<void>
  installSkill: (input: InstallSkillInput) => Promise<SkillMeta>
  createSkill: (input: {
    name: string
    displayName?: string
    description?: string
  }) => Promise<SkillMeta>
  deleteSkill: (name: string) => Promise<void>
  clearMessage: () => void
  clearSelection: () => void
}

export const useSkillStore = create<SkillStore>((set) => ({
  skills: [],
  skillsDir: '',
  selectedSkill: null,
  isLoading: false,
  isDetailLoading: false,
  isMutating: false,
  error: null,
  operationMessage: null,

  fetchSkills: async () => {
    set({ isLoading: true, error: null })
    try {
      const { skills, skillsDir } = await skillsApi.list()
      set({ skills, skillsDir, isLoading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isLoading: false,
      })
    }
  },

  fetchSkillDetail: async (source, name) => {
    set({ isDetailLoading: true, error: null })
    try {
      const { detail } = await skillsApi.detail(source, name)
      set({ selectedSkill: detail, isDetailLoading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isDetailLoading: false,
      })
    }
  },

  installSkill: async (input) => {
    set({ isMutating: true, error: null, operationMessage: null })
    try {
      const { skill, skillsDir } = await skillsApi.install(input)
      const { skills } = await skillsApi.list()
      set({
        skills,
        skillsDir,
        isMutating: false,
        operationMessage: `已安装技能：${skill.displayName || skill.name}`,
      })
      return skill
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message, isMutating: false })
      throw err
    }
  },

  createSkill: async (input) => {
    set({ isMutating: true, error: null, operationMessage: null })
    try {
      const { skill, skillsDir } = await skillsApi.create(input)
      const { skills } = await skillsApi.list()
      set({
        skills,
        skillsDir,
        isMutating: false,
        operationMessage: `已创建技能：${skill.displayName || skill.name}`,
      })
      return skill
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message, isMutating: false })
      throw err
    }
  },

  deleteSkill: async (name) => {
    set({ isMutating: true, error: null, operationMessage: null })
    try {
      await skillsApi.delete(name)
      const { skills, skillsDir } = await skillsApi.list()
      set((state) => ({
        skills,
        skillsDir,
        selectedSkill:
          state.selectedSkill?.meta.name === name ? null : state.selectedSkill,
        isMutating: false,
        operationMessage: `已删除技能：${name}`,
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message, isMutating: false })
      throw err
    }
  },

  clearMessage: () => set({ operationMessage: null }),
  clearSelection: () => set({ selectedSkill: null, operationMessage: null }),
}))

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { clearBundledSkills, getBundledSkills } from '../bundledSkills.js'
import { registerRememberSkill } from '../bundled/remember.js'
import { registerSkillifySkill } from '../bundled/skillify.js'

describe('bundled skill registration', () => {
  const originalUserType = process.env.USER_TYPE
  const originalDisableAutoMemory =
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY

  beforeEach(() => {
    clearBundledSkills()
    delete process.env.USER_TYPE
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0'
  })

  afterEach(() => {
    clearBundledSkills()
    if (originalUserType === undefined) delete process.env.USER_TYPE
    else process.env.USER_TYPE = originalUserType

    if (originalDisableAutoMemory === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
    } else {
      process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY =
        originalDisableAutoMemory
    }
  })

  it('exposes skillify to normal claude-yh users', () => {
    registerSkillifySkill()

    const skillify = getBundledSkills().find(skill => skill.name === 'skillify')

    expect(skillify).toBeDefined()
    expect(skillify?.type).toBe('prompt')
    if (skillify?.type !== 'prompt') {
      throw new Error('skillify should register as a prompt command')
    }
    expect(skillify?.userInvocable).toBe(true)
    expect(skillify?.disableModelInvocation).toBe(true)
    expect(skillify.allowedTools).toContain('AskUserQuestion')
  })

  it('exposes remember when auto-memory is enabled', () => {
    registerRememberSkill()

    const remember = getBundledSkills().find(skill => skill.name === 'remember')

    expect(remember).toBeDefined()
    expect(remember?.userInvocable).toBe(true)
    expect(remember?.isEnabled?.()).toBe(true)
  })
})

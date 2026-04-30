import { describe, expect, it } from 'bun:test'
import { buildExtractAutoOnlyPrompt } from '../../services/extractMemories/prompts.js'
import { buildMemoryLines } from '../memdir.js'
import { LAYERED_MEMORY_SECTION } from '../memoryTypes.js'

describe('layered memory guidance', () => {
  it('defines the L1-L4 promotion model', () => {
    const text = LAYERED_MEMORY_SECTION.join('\n')

    expect(text).toContain('L1 index')
    expect(text).toContain('L2 facts')
    expect(text).toContain('L3 skills/SOPs')
    expect(text).toContain('L4 archive')
    expect(text).toContain('No execution, no memory')
  })

  it('injects layered guidance into the interactive memory prompt', () => {
    const prompt = buildMemoryLines(
      'auto memory',
      'C:\\Users\\test\\.claude-yh\\projects\\demo\\memory\\',
    ).join('\n')

    expect(prompt).toContain('## Memory layers')
    expect(prompt).toContain('`MEMORY.md` is loaded into every new session')
    expect(prompt).toContain('L1 is regenerated from the complete L2/L3 set')
  })

  it('injects layered guidance into background extraction prompts', () => {
    const prompt = buildExtractAutoOnlyPrompt(4, '', false)

    expect(prompt).toContain('## Memory layers')
    expect(prompt).toContain('No execution, no memory')
    expect(prompt).toContain('choose exactly ONE L3 shape')
    expect(prompt).toContain('SOP OR Skill')
  })
})

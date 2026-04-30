import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { builtInCommandNames } from '../../commands.js'

describe('removed Claude mobile QR commands', () => {
  let originalApiKey: string | undefined

  beforeEach(() => {
    originalApiKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalApiKey
  })

  it('does not expose /mobile, /ios, or /android as built-in commands', () => {
    const names = builtInCommandNames()

    expect(names.has('mobile')).toBe(false)
    expect(names.has('ios')).toBe(false)
    expect(names.has('android')).toBe(false)
  })
})

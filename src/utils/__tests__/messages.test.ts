import { describe, expect, test } from 'bun:test'
import {
  createUserMessage,
  isNotEmptyMessage,
  normalizeMessages,
} from '../messages.js'
import type { Message } from '../../types/message.js'

describe('messages normalization safety', () => {
  test('isNotEmptyMessage returns false for undefined input', () => {
    expect(isNotEmptyMessage(undefined as unknown as Message)).toBe(false)
  })

  test('normalizeMessages ignores tombstone and does not surface undefined', () => {
    const userMessage = createUserMessage({
      content: 'hello world',
      uuid: '11111111-1111-1111-1111-111111111111',
    })

    const tombstoneMessage = {
      type: 'tombstone',
      message: userMessage,
    } as Message

    const normalized = normalizeMessages([userMessage, tombstoneMessage])

    expect(normalized).toHaveLength(1)
    expect(normalized[0]).toBeDefined()
    expect(() => normalized.filter(isNotEmptyMessage)).not.toThrow()
    expect(normalized.filter(isNotEmptyMessage)).toHaveLength(1)
  })

  test('normalizeMessages ignores unknown message types', () => {
    const unknownMessage = {
      type: 'unexpected',
      message: { content: 'unexpected content' },
    } as Message

    expect(normalizeMessages([unknownMessage])).toEqual([])
  })
})

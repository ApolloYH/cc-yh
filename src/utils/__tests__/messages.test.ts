import { describe, expect, test } from 'bun:test'
import {
  createProgressMessage,
  createUserMessage,
  isNotEmptyMessage,
  normalizeMessages,
} from '../messages.js'
import { normalizeMessage } from '../queryHelpers.js'
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

  test('isNotEmptyMessage returns false for messages missing nested content', () => {
    const malformedMessage = {
      type: 'user',
    } as Message

    expect(() => isNotEmptyMessage(malformedMessage)).not.toThrow()
    expect(isNotEmptyMessage(malformedMessage)).toBe(false)
  })

  test('normalizeMessages ignores known message types with malformed content shape', () => {
    const validMessage = createUserMessage({
      content: 'still valid',
      uuid: '22222222-2222-2222-2222-222222222222',
    })
    const malformedAssistant = {
      type: 'assistant',
      uuid: '33333333-3333-3333-3333-333333333333',
      timestamp: new Date().toISOString(),
      message: {},
    } as Message
    const malformedUser = {
      type: 'user',
      uuid: '44444444-4444-4444-4444-444444444444',
      timestamp: new Date().toISOString(),
      message: { content: { bad: true } },
    } as Message

    expect(() =>
      normalizeMessages([validMessage, malformedAssistant, malformedUser]),
    ).not.toThrow()
    expect(
      normalizeMessages([validMessage, malformedAssistant, malformedUser]),
    ).toHaveLength(1)
  })

  test('normalizeMessage skips malformed nested progress messages without throwing', () => {
    const progressMessage = createProgressMessage({
      toolUseID: 'tool-1',
      parentToolUseID: 'parent-1',
      data: {
        type: 'agent_progress',
        message: {
          type: 'assistant',
          uuid: '55555555-5555-5555-5555-555555555555',
          timestamp: new Date().toISOString(),
          message: {},
        },
      },
    }) as Message

    expect(() => [...normalizeMessage(progressMessage)]).not.toThrow()
    expect([...normalizeMessage(progressMessage)]).toEqual([])
  })
})

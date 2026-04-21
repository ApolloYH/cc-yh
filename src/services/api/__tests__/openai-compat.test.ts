import { describe, expect, test } from 'bun:test'
import {
  convertAnthropicRequestToOpenAI,
  type ToolNameMapping,
} from '../openaiCompat.js'
import { convertAnthropicRequestToOpenAIResponses } from '../openaiResponsesCompat.js'
import { openaiChatToAnthropic } from '../../../server/proxy/transform/openaiChatToAnthropic.js'

describe('OpenAI compatibility transforms', () => {
  test('preserves user/tool_result ordering for chat conversions', () => {
    const request = convertAnthropicRequestToOpenAI({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'before tool' },
            {
              type: 'tool_result',
              tool_use_id: 'call_1',
              content: [{ type: 'text', text: 'tool output' }],
            },
            { type: 'text', text: 'after tool' },
          ],
        },
      ] as any,
      thinking: { type: 'disabled' },
    })

    expect(request.messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: 'before tool' }],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: 'tool output',
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'after tool' }],
      },
    ])
  })

  test('preserves user/tool_result ordering for responses conversions', () => {
    const request = convertAnthropicRequestToOpenAIResponses({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'before tool' },
            {
              type: 'tool_result',
              tool_use_id: 'call_1',
              content: [{ type: 'text', text: 'tool output' }],
            },
            { type: 'text', text: 'after tool' },
          ],
        },
      ] as any,
      thinking: { type: 'disabled' },
    })

    expect(request.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'before tool' }],
      },
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: 'tool output',
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'after tool' }],
      },
    ])
  })

  test('truncates long tool names for provider requests and restores them on return', () => {
    const longToolName =
      'tool_name_that_is_far_longer_than_sixty_four_characters_and_needs_roundtrip_restoration'
    const toolNameMapping: ToolNameMapping = {}

    const request = convertAnthropicRequestToOpenAI({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hello' }] as any,
      tools: [
        {
          name: longToolName,
          description: 'Long tool',
          input_schema: {
            type: 'object',
            properties: { q: { type: 'string' } },
          },
        },
      ] as any,
      tool_choice: { type: 'tool', name: longToolName } as any,
      thinking: { type: 'disabled' },
      toolNameMapping,
    })

    const providerToolName = request.tools?.[0]?.function.name
    expect(providerToolName).toBeDefined()
    expect(providerToolName?.length).toBeLessThanOrEqual(64)
    expect(toolNameMapping[providerToolName!]).toBe(longToolName)
    expect((request.tool_choice as any).function.name).toBe(providerToolName)

    const anthropicResponse = openaiChatToAnthropic(
      {
        id: 'chatcmpl_1',
        object: 'chat.completion',
        created: 0,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: providerToolName!,
                    arguments: '{"q":"hello"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      },
      'gpt-4o',
      toolNameMapping,
    )

    expect((anthropicResponse.content[0] as any).name).toBe(longToolName)
  })
})

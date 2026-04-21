/**
 * Request transformation: Anthropic Messages -> OpenAI Responses API
 * Derived from cc-switch (https://github.com/farion1231/cc-switch)
 * Original work by Jason Young, MIT License
 */

import type {
  AnthropicRequest,
  AnthropicContentBlock,
  AnthropicMessage,
  OpenAIResponsesRequest,
  OpenAIResponsesInputItem,
  OpenAITool,
  OpenAIChatContentPart,
} from './types.js'
import {
  anthropicBlockToDocumentText,
  normalizeToolNameForOpenAI,
  serializeAnthropicContentValue,
  type ToolNameMapping,
} from './compatHelpers.js'

/**
 * Convert Anthropic Messages request to OpenAI Responses API request.
 */
export function anthropicToOpenaiResponses(
  body: AnthropicRequest,
  toolNameMapping?: ToolNameMapping,
): OpenAIResponsesRequest {
  const input: OpenAIResponsesInputItem[] = []

  for (const msg of body.messages) {
    convertMessageToInputItems(msg, input, toolNameMapping)
  }

  const result: OpenAIResponsesRequest = {
    model: body.model,
    input,
    stream: body.stream,
  }

  if (body.system) {
    if (typeof body.system === 'string') {
      result.instructions = body.system
    } else if (Array.isArray(body.system)) {
      result.instructions = body.system.map(b => b.text).join('\n')
    }
  }

  if (body.temperature !== undefined) result.temperature = body.temperature
  if (body.top_p !== undefined) result.top_p = body.top_p

  if (body.tools && body.tools.length > 0) {
    result.tools = body.tools
      .filter(t => t.name !== 'BatchTool')
      .map(
        (t): OpenAITool => ({
          type: 'function',
          function: {
            name: normalizeToolNameForOpenAI(t.name, toolNameMapping),
            description: t.description,
            parameters: t.input_schema,
          },
        }),
      )
  }

  if (body.tool_choice !== undefined) {
    result.tool_choice = convertToolChoice(body.tool_choice, toolNameMapping)
  }

  if (body.thinking) {
    const budget = body.thinking.budget_tokens
    if (budget !== undefined) {
      if (budget <= 1024) result.reasoning = { effort: 'low' }
      else if (budget <= 8192) result.reasoning = { effort: 'medium' }
      else result.reasoning = { effort: 'high' }
    } else if (body.thinking.type === 'enabled') {
      result.reasoning = { effort: 'high' }
    }
  }

  return result
}

function convertMessageToInputItems(
  msg: AnthropicMessage,
  output: OpenAIResponsesInputItem[],
  toolNameMapping?: ToolNameMapping,
): void {
  const content = msg.content

  if (typeof content === 'string') {
    output.push({ type: 'message', role: msg.role, content })
    return
  }

  if (!Array.isArray(content) || content.length === 0) {
    output.push({ type: 'message', role: msg.role, content: '' })
    return
  }

  let contentParts: (string | OpenAIChatContentPart)[] = []

  const flushContent = () => {
    if (contentParts.length === 0) return
    const value =
      contentParts.length === 1 && typeof contentParts[0] === 'string'
        ? contentParts[0]
        : contentParts.map(part =>
            typeof part === 'string' ? { type: 'text' as const, text: part } : part,
          )
    output.push({ type: 'message', role: msg.role, content: value })
    contentParts = []
  }

  for (const block of content) {
    if (block.type === 'text') {
      contentParts.push(block.text)
      continue
    }

    if (block.type === 'image') {
      contentParts.push({
        type: 'image_url',
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`,
        },
      })
      continue
    }

    if (block.type === 'document') {
      const text = anthropicBlockToDocumentText(block)
      if (text) contentParts.push(text)
      continue
    }

    if (block.type === 'tool_use') {
      flushContent()
      output.push({
        type: 'function_call',
        call_id: block.id,
        name: normalizeToolNameForOpenAI(block.name, toolNameMapping),
        arguments:
          typeof block.input === 'string'
            ? block.input
            : JSON.stringify(block.input),
      })
      continue
    }

    if (block.type === 'tool_result') {
      flushContent()
      output.push({
        type: 'function_call_output',
        call_id: block.tool_use_id,
        output: serializeAnthropicContentValue(block.content),
      })
    }
  }

  flushContent()
}

function convertToolChoice(
  choice: unknown,
  toolNameMapping?: ToolNameMapping,
): unknown {
  if (typeof choice === 'string') return choice
  if (typeof choice === 'object' && choice !== null) {
    const c = choice as Record<string, unknown>
    if (c.type === 'auto') return 'auto'
    if (c.type === 'any') return 'required'
    if (c.type === 'none') return 'none'
    if (c.type === 'tool' && typeof c.name === 'string') {
      return {
        type: 'function',
        function: {
          name: normalizeToolNameForOpenAI(c.name, toolNameMapping),
        },
      }
    }
  }
  return 'auto'
}

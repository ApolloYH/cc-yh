/**
 * Request transformation: Anthropic Messages -> OpenAI Chat Completions
 * Derived from cc-switch (https://github.com/farion1231/cc-switch)
 * Original work by Jason Young, MIT License
 */

import type {
  AnthropicRequest,
  AnthropicContentBlock,
  AnthropicMessage,
  OpenAIChatRequest,
  OpenAIChatMessage,
  OpenAIChatContentPart,
  OpenAIToolCall,
  OpenAITool,
} from './types.js'
import {
  anthropicBlockToDocumentText,
  normalizeToolNameForOpenAI,
  serializeAnthropicContentValue,
  type ToolNameMapping,
} from './compatHelpers.js'

/**
 * Convert Anthropic Messages request to OpenAI Chat Completions request.
 */
export function anthropicToOpenaiChat(
  body: AnthropicRequest,
  toolNameMapping?: ToolNameMapping,
): OpenAIChatRequest {
  const messages: OpenAIChatMessage[] = []

  if (body.system) {
    if (typeof body.system === 'string') {
      messages.push({ role: 'system', content: body.system })
    } else if (Array.isArray(body.system)) {
      const text = body.system.map(b => b.text).join('\n')
      messages.push({ role: 'system', content: text })
    }
  }

  for (const msg of body.messages) {
    convertMessage(msg, messages, toolNameMapping)
  }

  const result: OpenAIChatRequest = {
    model: body.model,
    messages,
    stream: body.stream,
  }

  if (body.temperature !== undefined) result.temperature = body.temperature
  if (body.top_p !== undefined) result.top_p = body.top_p

  if (body.stop_sequences && body.stop_sequences.length > 0) {
    result.stop = body.stop_sequences
  }

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
      if (budget <= 1024) result.reasoning_effort = 'low'
      else if (budget <= 8192) result.reasoning_effort = 'medium'
      else result.reasoning_effort = 'high'
    } else if (body.thinking.type === 'enabled') {
      result.reasoning_effort = 'high'
    }
  }

  return result
}

function convertMessage(
  msg: AnthropicMessage,
  output: OpenAIChatMessage[],
  toolNameMapping?: ToolNameMapping,
): void {
  const content = msg.content

  if (typeof content === 'string') {
    output.push({ role: msg.role, content })
    return
  }

  if (!Array.isArray(content) || content.length === 0) {
    output.push({ role: msg.role, content: '' })
    return
  }

  if (msg.role === 'user') {
    convertUserMessage(content, output)
  } else {
    convertAssistantMessage(content, output, toolNameMapping)
  }
}

function convertUserMessage(
  blocks: AnthropicContentBlock[],
  output: OpenAIChatMessage[],
): void {
  let contentParts: OpenAIChatContentPart[] = []

  const flushUserContent = () => {
    if (contentParts.length === 0) return
    output.push({
      role: 'user',
      content:
        contentParts.length === 1 && contentParts[0].type === 'text'
          ? contentParts[0].text
          : contentParts,
    })
    contentParts = []
  }

  for (const block of blocks) {
    if (block.type === 'text') {
      contentParts.push({ type: 'text', text: block.text })
      continue
    }

    if (block.type === 'image') {
      const url = `data:${block.source.media_type};base64,${block.source.data}`
      contentParts.push({ type: 'image_url', image_url: { url } })
      continue
    }

    if (block.type === 'document') {
      const text = anthropicBlockToDocumentText(block)
      if (text) contentParts.push({ type: 'text', text })
      continue
    }

    if (block.type === 'tool_result') {
      flushUserContent()
      output.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: serializeAnthropicContentValue(block.content),
      })
    }
  }

  flushUserContent()
}

function convertAssistantMessage(
  blocks: AnthropicContentBlock[],
  output: OpenAIChatMessage[],
  toolNameMapping?: ToolNameMapping,
): void {
  let textContent = ''
  const toolCalls: OpenAIToolCall[] = []

  for (const block of blocks) {
    if (block.type === 'text') {
      textContent += block.text
      continue
    }

    if (block.type === 'document') {
      textContent += anthropicBlockToDocumentText(block)
      continue
    }

    if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: normalizeToolNameForOpenAI(block.name, toolNameMapping),
          arguments:
            typeof block.input === 'string'
              ? block.input
              : JSON.stringify(block.input),
        },
      })
    }
  }

  const msg: OpenAIChatMessage = {
    role: 'assistant',
    content: textContent || null,
  }

  if (toolCalls.length > 0) {
    msg.tool_calls = toolCalls
  }

  output.push(msg)
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

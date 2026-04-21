// @ts-nocheck
import type {
  BetaMessage,
  BetaMessageParam,
  BetaRawMessageStreamEvent,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolUnion,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { createHash } from 'node:crypto'

type AnyBlock = Record<string, unknown>
export type ToolNameMapping = Record<string, string>

export type OpenAICompatConfig = {
  apiKey: string
  baseURL: string
  headers?: Record<string, string>
  fetch?: typeof globalThis.fetch
}

type OpenAIToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

type OpenAIChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | OpenAIChatContentPart[] | null
  tool_call_id?: string
  tool_calls?: OpenAIToolCall[]
}

export type OpenAIChatRequest = {
  model: string
  messages: OpenAIChatMessage[]
  stream?: boolean
  enable_thinking?: boolean
  thinking_budget?: number
  temperature?: number
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description?: string
      parameters?: unknown
    }
  }>
  tool_choice?: 'auto' | { type: 'function'; function: { name: string } }
  max_tokens?: number
}

type OpenAIStreamChunk = {
  id?: string
  model?: string
  choices?: Array<{
    index?: number
    delta?: {
      role?: 'assistant'
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      thinking_blocks?: Array<Record<string, unknown>>
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: 'function'
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export function joinBaseUrl(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/$/, '')}${path}`
}

function truncateToolName(name: string): string {
  if (name.length <= 64) return name
  const suffix = createHash('sha1').update(name).digest('hex').slice(0, 12)
  const prefixLength = Math.max(1, 64 - suffix.length - 1)
  return `${name.slice(0, prefixLength)}_${suffix}`
}

export function normalizeToolNameForOpenAI(
  name: string,
  mapping?: ToolNameMapping,
): string {
  const normalized = truncateToolName(name)
  if (mapping && normalized !== name) {
    mapping[normalized] = name
  }
  return normalized
}

export function restoreToolNameFromOpenAI(
  name: string,
  mapping?: ToolNameMapping,
): string {
  return mapping?.[name] ?? name
}

function extractDocumentText(block: AnyBlock): string {
  if (typeof block.text === 'string' && block.text.length > 0) return block.text
  if (typeof block.title === 'string' && block.title.length > 0) return block.title

  const source =
    block.source && typeof block.source === 'object'
      ? (block.source as Record<string, unknown>)
      : undefined
  if (typeof source?.text === 'string' && source.text.length > 0) return source.text
  if (typeof source?.data === 'string' && source.data.length > 0) return source.data

  return '[Document omitted]'
}

export function serializeAnthropicContentValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (!item || typeof item !== 'object') {
          return typeof item === 'string' ? item : ''
        }
        const block = item as AnyBlock
        if (block.type === 'text' && typeof block.text === 'string') return block.text
        if (block.type === 'thinking' && typeof block.thinking === 'string') {
          return block.thinking
        }
        if (block.type === 'document') return extractDocumentText(block)
        if (block.type === 'tool_result') {
          return serializeAnthropicContentValue(block.content)
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return '[Unserializable content]'
    }
  }
  return ''
}

export function contentToText(content: BetaMessageParam['content']): string {
  if (typeof content === 'string') return content
  return content
    .map(block => {
      if (block.type === 'text') return typeof block.text === 'string' ? block.text : ''
      if (block.type === 'tool_result') {
        return serializeAnthropicContentValue(block.content)
      }
      if (block.type === 'thinking') {
        return typeof block.thinking === 'string' ? block.thinking : ''
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

export function toBlocks(content: BetaMessageParam['content']): AnyBlock[] {
  return Array.isArray(content)
    ? (content as unknown as AnyBlock[])
    : [{ type: 'text', text: content }]
}

function toDataUrl(mediaType: string, data: string): string {
  return `data:${mediaType};base64,${data}`
}

function mapAnthropicUserBlocksToOpenAIContent(
  blocks: AnyBlock[],
): OpenAIChatContentPart[] {
  return blocks.flatMap(block => {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      return [{ type: 'text' as const, text: block.text }]
    }
    if (
      block.type === 'image' &&
      block.source &&
      typeof block.source === 'object' &&
      (block.source as Record<string, unknown>).type === 'base64' &&
      typeof (block.source as Record<string, unknown>).media_type === 'string' &&
      typeof (block.source as Record<string, unknown>).data === 'string'
    ) {
      return [{
        type: 'image_url' as const,
        image_url: {
          url: toDataUrl(
            String((block.source as Record<string, unknown>).media_type),
            String((block.source as Record<string, unknown>).data),
          ),
        },
      }]
    }
    if (block.type === 'document') {
      const text = extractDocumentText(block)
      return text ? [{ type: 'text' as const, text }] : []
    }
    return []
  })
}

export function getToolDefinitions(
  tools?: BetaToolUnion[],
  toolNameMapping?: ToolNameMapping,
): OpenAIChatRequest['tools'] {
  if (!tools || tools.length === 0) return undefined
  const mapped = tools.flatMap(tool => {
    const record = tool as unknown as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name : undefined
    if (!name) return []
    return [{
      type: 'function' as const,
      function: {
        name: normalizeToolNameForOpenAI(name, toolNameMapping),
        description:
          typeof record.description === 'string' ? record.description : undefined,
        parameters: record.input_schema,
      },
    }]
  })
  return mapped.length > 0 ? mapped : undefined
}

export function convertAnthropicRequestToOpenAI(input: {
  model: string
  system?: string | Array<{ type?: string; text?: string }>
  messages: BetaMessageParam[]
  tools?: BetaToolUnion[]
  tool_choice?: BetaToolChoiceAuto | BetaToolChoiceTool
  temperature?: number
  max_tokens?: number
  thinking?: {
    type?: 'enabled' | 'disabled' | 'adaptive'
    budget_tokens?: number
  }
  toolNameMapping?: ToolNameMapping
}): OpenAIChatRequest {
  const configuredModel = process.env.ANTHROPIC_MODEL?.trim()
  const targetModel = configuredModel || input.model
  const messages: OpenAIChatMessage[] = []
  const toolDefinitions = getToolDefinitions(input.tools, input.toolNameMapping)

  if (input.system) {
    const systemText = Array.isArray(input.system)
      ? input.system.map(block => block.text ?? '').join('\n')
      : input.system
    if (systemText) messages.push({ role: 'system', content: systemText })
  }

  for (const message of input.messages) {
    if (message.role === 'user') {
      const blocks = toBlocks(message.content)

      let userContent: OpenAIChatContentPart[] = []
      const flushUserContent = () => {
        if (userContent.length > 0) {
          messages.push({ role: 'user', content: userContent })
          userContent = []
        }
      }

      for (const block of blocks) {
        if (block.type === 'tool_result') {
          flushUserContent()
          messages.push({
            role: 'tool',
            tool_call_id:
              typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined,
            content: serializeAnthropicContentValue(block.content),
          })
          continue
        }

        userContent.push(...mapAnthropicUserBlocksToOpenAIContent([block]))
      }

      flushUserContent()
      continue
    }

    if (message.role === 'assistant') {
      const blocks = Array.isArray(message.content)
        ? (message.content as unknown as AnyBlock[])
        : []
      const text = blocks
        .filter(block => block.type === 'text')
        .map(block => (typeof block.text === 'string' ? block.text : ''))
        .join('')

      const toolCalls = blocks
        .filter(block => block.type === 'tool_use')
        .map(block => ({
          id: String(block.id),
          type: 'function' as const,
          function: {
            name: normalizeToolNameForOpenAI(
              String(block.name),
              input.toolNameMapping,
            ),
            arguments:
              typeof block.input === 'string'
                ? block.input
                : JSON.stringify(block.input ?? {}),
          },
        }))

      messages.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
    }
  }

  return {
    model: targetModel,
    messages,
    enable_thinking:
      input.thinking?.type === 'enabled' || input.thinking?.type === 'adaptive',
    ...(input.thinking?.type === 'enabled' &&
    typeof input.thinking.budget_tokens === 'number'
      ? { thinking_budget: input.thinking.budget_tokens }
      : {}),
    temperature: input.temperature,
    max_tokens: input.max_tokens,
    ...(toolDefinitions ? { tools: toolDefinitions } : {}),
    ...(input.tool_choice?.type === 'tool'
      ? {
          tool_choice: {
            type: 'function' as const,
            function: {
              name: normalizeToolNameForOpenAI(
                input.tool_choice.name,
                input.toolNameMapping,
              ),
            },
          },
        }
      : input.tool_choice?.type === 'auto'
        ? { tool_choice: 'auto' as const }
        : {}),
  }
}

export async function createOpenAICompatStream(
  config: OpenAICompatConfig,
  request: OpenAIChatRequest,
  signal?: AbortSignal,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await (config.fetch ?? globalThis.fetch)(
    joinBaseUrl(config.baseURL, '/chat/completions'),
    {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
        ...config.headers,
      },
      body: JSON.stringify({ ...request, stream: true }),
    },
  )

  if (!response.ok || !response.body) {
    let responseText = ''
    try {
      responseText = await response.text()
    } catch {
      responseText = ''
    }
    throw new Error(
      `OpenAI compatible request failed with status ${response.status}${responseText ? `: ${responseText}` : ''}`,
    )
  }

  return response.body.getReader()
}

export function parseSSEChunk(buffer: string): { events: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const remainder = parts.pop() ?? ''
  return { events: parts, remainder }
}

export function mapFinishReason(reason: string | null | undefined): BetaMessage['stop_reason'] {
  if (reason === 'tool_calls') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  return 'end_turn'
}

export async function* createAnthropicStreamFromOpenAI(input: {
  reader: ReadableStreamDefaultReader<Uint8Array>
  model: string
  toolNameMapping?: ToolNameMapping
}): AsyncGenerator<BetaRawMessageStreamEvent, BetaMessage, void> {
  const decoder = new TextDecoder()
  let buffer = ''
  let started = false
  let textStarted = false
  let textContentIndex: number | null = null
  let thinkingStarted = false
  let thinkingContentIndex: number | null = null
  const toolIndexByOpenAIIndex = new Map<number, number>()
  let nextContentIndex = 0
  let promptTokens = 0
  let completionTokens = 0
  let emittedAnyContent = false
  const toolCallState = new Map<number, {
    id: string
    name: string
    arguments: string
    anthropicIndex?: number
    pendingArgumentDeltas: string[]
    started: boolean
  }>()

  while (true) {
    const { done, value } = await input.reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSSEChunk(buffer)
    buffer = parsed.remainder

    for (const rawEvent of parsed.events) {
      const dataLines = rawEvent
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())

      for (const data of dataLines) {
        if (!data || data === '[DONE]') continue
        const chunk = JSON.parse(data) as OpenAIStreamChunk
        if (!chunk || typeof chunk !== 'object') {
          throw new Error(
            `[openaiCompat] invalid stream chunk: ${String(data).slice(0, 500)}`,
          )
        }
        const choice = chunk.choices?.[0]
        const delta = choice?.delta

        if (!choice && data !== '[DONE]') {
          throw new Error(
            `[openaiCompat] chunk missing choices[0]: ${JSON.stringify(chunk).slice(0, 1000)}`,
          )
        }

        if (!started) {
          started = true
          promptTokens = chunk.usage?.prompt_tokens ?? 0
          yield {
            type: 'message_start',
            message: {
              id: chunk.id ?? 'openai-compat',
              type: 'message',
              role: 'assistant',
              model: input.model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: {
                input_tokens: promptTokens,
                output_tokens: 0,
              },
            },
          } as BetaRawMessageStreamEvent
        }

        if (delta?.content) {
          if (!textStarted) {
            textStarted = true
            textContentIndex = nextContentIndex
            nextContentIndex += 1
            yield {
              type: 'content_block_start',
              index: textContentIndex,
              content_block: {
                type: 'text',
                text: '',
              },
            } as BetaRawMessageStreamEvent
          }

          yield {
            type: 'content_block_delta',
            index: textContentIndex ?? 0,
            delta: {
              type: 'text_delta',
              text: delta.content,
            },
          } as BetaRawMessageStreamEvent
          emittedAnyContent = true
        }

        const thinkingDelta =
          delta?.reasoning_content ||
          delta?.reasoning ||
          (Array.isArray(delta?.thinking_blocks)
            ? delta.thinking_blocks
                .map(block => (typeof block?.thinking === 'string' ? block.thinking : ''))
                .join('')
            : '')

        if (thinkingDelta) {
          if (!thinkingStarted) {
            thinkingStarted = true
            thinkingContentIndex = nextContentIndex
            nextContentIndex += 1
            yield {
              type: 'content_block_start',
              index: thinkingContentIndex,
              content_block: {
                type: 'thinking',
                thinking: '',
                signature: '',
              },
            } as BetaRawMessageStreamEvent
          }

          yield {
              type: 'content_block_delta',
              index: thinkingContentIndex ?? 0,
              delta: {
                type: 'thinking_delta',
                thinking: thinkingDelta,
              },
            } as BetaRawMessageStreamEvent
          emittedAnyContent = true
        }

        for (const toolCall of delta?.tool_calls ?? []) {
          const openAIIndex = toolCall.index ?? 0
          let state = toolCallState.get(openAIIndex)
          if (!state) {
            state = {
              id: toolCall.id ?? `toolu_${openAIIndex}`,
              name: '',
              arguments: '',
              pendingArgumentDeltas: [],
              started: false,
            }
            toolCallState.set(openAIIndex, state)
          }
          if (toolCall.id) state.id = toolCall.id
          if (toolCall.function?.name) {
            state.name = restoreToolNameFromOpenAI(
              toolCall.function.name,
              input.toolNameMapping,
            )
          }

          if (!state.started && state.name) {
            const anthropicIndex = nextContentIndex
            state.anthropicIndex = anthropicIndex
            state.started = true
            toolIndexByOpenAIIndex.set(openAIIndex, anthropicIndex)
            nextContentIndex = Math.max(nextContentIndex, anthropicIndex + 1)
            yield {
              type: 'content_block_start',
              index: anthropicIndex,
              content_block: {
                type: 'tool_use',
                id: state.id,
                name: state.name,
                input: '',
              },
            } as BetaRawMessageStreamEvent
            emittedAnyContent = true

            for (const pendingArguments of state.pendingArgumentDeltas) {
              yield {
                type: 'content_block_delta',
                index: anthropicIndex,
                delta: {
                  type: 'input_json_delta',
                  partial_json: pendingArguments,
                },
              } as BetaRawMessageStreamEvent
              emittedAnyContent = true
            }
            state.pendingArgumentDeltas = []
          }

          if (toolCall.function?.arguments) {
            state.arguments += toolCall.function.arguments
            if (state.started && typeof state.anthropicIndex === 'number') {
              yield {
                type: 'content_block_delta',
                index: state.anthropicIndex,
                delta: {
                  type: 'input_json_delta',
                  partial_json: toolCall.function.arguments,
                },
              } as BetaRawMessageStreamEvent
              emittedAnyContent = true
            } else {
              state.pendingArgumentDeltas.push(toolCall.function.arguments)
            }
          }
        }

        if (choice?.finish_reason) {
          if (!emittedAnyContent) {
            yield {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'text',
                text: '',
              },
            } as BetaRawMessageStreamEvent
            yield {
              type: 'content_block_stop',
              index: 0,
            } as BetaRawMessageStreamEvent
          }
          completionTokens = chunk.usage?.completion_tokens ?? completionTokens
          if (textStarted && textContentIndex !== null) {
            yield {
              type: 'content_block_stop',
              index: textContentIndex,
            } as BetaRawMessageStreamEvent
          }

          if (thinkingStarted && thinkingContentIndex !== null) {
            yield {
              type: 'content_block_stop',
              index: thinkingContentIndex,
            } as BetaRawMessageStreamEvent
          }

          for (const [openAIIndex, state] of toolCallState.entries()) {
            if (!state.started) {
              const anthropicIndex = nextContentIndex
              state.anthropicIndex = anthropicIndex
              state.started = true
              state.name = state.name || 'tool'
              toolIndexByOpenAIIndex.set(openAIIndex, anthropicIndex)
              nextContentIndex = Math.max(nextContentIndex, anthropicIndex + 1)
              yield {
                type: 'content_block_start',
                index: anthropicIndex,
                content_block: {
                  type: 'tool_use',
                  id: state.id,
                  name: state.name,
                  input: '',
                },
              } as BetaRawMessageStreamEvent
              emittedAnyContent = true
              for (const pendingArguments of state.pendingArgumentDeltas) {
                yield {
                  type: 'content_block_delta',
                  index: anthropicIndex,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: pendingArguments,
                  },
                } as BetaRawMessageStreamEvent
              }
            }
          }

          for (const anthropicIndex of toolIndexByOpenAIIndex.values()) {
            yield {
              type: 'content_block_stop',
              index: anthropicIndex,
            } as BetaRawMessageStreamEvent
          }

          yield {
            type: 'message_delta',
            delta: {
              stop_reason: mapFinishReason(choice.finish_reason),
              stop_sequence: null,
            },
            usage: {
              output_tokens: completionTokens,
            },
          } as BetaRawMessageStreamEvent

          yield {
            type: 'message_stop',
          } as BetaRawMessageStreamEvent

          return {
            id: chunk.id ?? 'openai-compat',
            type: 'message',
            role: 'assistant',
            model: input.model,
            content: [],
            stop_reason: mapFinishReason(choice.finish_reason),
            stop_sequence: null,
            usage: {
              input_tokens: promptTokens,
              output_tokens: completionTokens,
            },
          } as BetaMessage
        }
      }
    }
  }

  throw new Error(
    `[openaiCompat] stream ended unexpectedly before message_stop for model=${input.model}`,
  )
}

export function mapOpenAIUsageToAnthropic(usage?: {
  prompt_tokens?: number
  completion_tokens?: number
}): BetaUsage | undefined {
  if (!usage) return undefined
  return {
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  } as BetaUsage
}

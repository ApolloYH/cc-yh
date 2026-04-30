// @ts-nocheck
import type {
  BetaMessage,
  BetaMessageParam,
  BetaRawMessageStreamEvent,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { EffortValue } from 'src/utils/effort.js'
import {
  getToolDefinitions,
  joinBaseUrl,
  normalizeToolNameForOpenAI,
  parseSSEChunk,
  restoreToolNameFromOpenAI,
  serializeAnthropicContentValue,
  toBlocks,
  type OpenAICompatConfig,
  type ToolNameMapping,
} from './openaiCompat.js'
import {
  consumeTaggedThinkingChunk,
  createTaggedThinkingStreamState,
  flushTaggedThinkingState,
} from '../../utils/taggedThinking.js'

type OpenAIResponsesInputPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'output_text'; text: string }

type OpenAIResponsesInputItem = {
  type: string
  role?: 'system' | 'user' | 'assistant'
  content?: OpenAIResponsesInputPart[]
  call_id?: string
  name?: string
  arguments?: string
  output?: string
}

type OpenAIResponsesRequest = {
  model: string
  input: OpenAIResponsesInputItem[]
  instructions?: string
  stream?: boolean
  temperature?: number
  max_output_tokens?: number
  tools?: Array<{
    type: 'function'
    name: string
    description?: string
    parameters?: unknown
  }>
  tool_choice?: 'auto' | 'required' | { type: 'function'; name: string }
  reasoning?: {
    effort?: 'low' | 'medium' | 'high'
    summary?: 'auto'
  }
}

type OpenAIResponsesEvent = {
  type?: string
  response_id?: string
  item_id?: string
  output_index?: number
  item?: Record<string, unknown>
  delta?: string
  arguments_delta?: string
  summary?: Array<{ text?: string }>
  part?: {
    type?: string
    text?: string
    summary?: Array<{ text?: string }>
  }
  response?: {
    id?: string
    status?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
    }
  }
}

type ToolState = {
  id: string
  name: string
  anthropicIndex?: number
  pendingArgumentDeltas: string[]
  started: boolean
}

function mapEffortToResponsesReasoning(
  effort?: EffortValue,
): OpenAIResponsesRequest['reasoning'] | undefined {
  if (effort === 'none') return undefined
  if (effort === 'low' || effort === 'medium' || effort === 'high') {
    return {
      effort,
      summary: 'auto',
    }
  }
  if (effort === 'max' || typeof effort === 'number') {
    return {
      effort: 'high',
      summary: 'auto',
    }
  }
  return {
    effort: 'medium',
    summary: 'auto',
  }
}

function toDataUrl(mediaType: string, data: string): string {
  return `data:${mediaType};base64,${data}`
}

function mapAnthropicUserBlocksToResponsesContent(
  blocks: Array<Record<string, unknown>>,
): OpenAIResponsesInputPart[] {
  return blocks.flatMap(block => {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      return [{ type: 'input_text' as const, text: block.text }]
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
        type: 'input_image' as const,
        image_url: toDataUrl(
          String((block.source as Record<string, unknown>).media_type),
          String((block.source as Record<string, unknown>).data),
        ),
      }]
    }
    if (block.type === 'document') {
      const text = serializeAnthropicContentValue([block])
      return text ? [{ type: 'input_text' as const, text }] : []
    }
    return []
  })
}

function getResponsesToolDefinitions(tools?: BetaToolUnion[]): OpenAIResponsesRequest['tools'] {
  const definitions = getToolDefinitions(tools)
  if (!definitions) return undefined
  return definitions.map(tool => ({
    type: 'function' as const,
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }))
}

export function convertAnthropicRequestToOpenAIResponses(input: {
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
  effort?: EffortValue
  toolNameMapping?: ToolNameMapping
}): OpenAIResponsesRequest {
  const configuredModel = process.env.ANTHROPIC_MODEL?.trim()
  const targetModel = configuredModel || input.model
  const items: OpenAIResponsesInputItem[] = []
  const systemText = input.system
    ? Array.isArray(input.system)
      ? input.system.map(block => block.text ?? '').join('\n')
      : input.system
    : undefined

  for (const message of input.messages) {
    const blocks = toBlocks(message.content)

    if (message.role === 'user') {
      let userContent: OpenAIResponsesInputPart[] = []
      const flushUserContent = () => {
        if (userContent.length > 0) {
          items.push({
            type: 'message',
            role: 'user',
            content: userContent,
          })
          userContent = []
        }
      }

      for (const block of blocks) {
        if (block.type === 'tool_result') {
          flushUserContent()
          items.push({
            type: 'function_call_output',
            call_id:
              typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined,
            output: serializeAnthropicContentValue(block.content),
          })
          continue
        }

        userContent.push(
          ...mapAnthropicUserBlocksToResponsesContent([
            block,
          ] as Array<Record<string, unknown>>),
        )
      }

      flushUserContent()
      continue
    }

    const text = blocks
      .filter(block => block.type === 'text')
      .map(block => (typeof block.text === 'string' ? block.text : ''))
      .join('')

    if (text) {
      items.push({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      })
    }

    const toolCalls = blocks.filter(block => block.type === 'tool_use')
    for (const toolCall of toolCalls) {
      items.push({
        type: 'function_call',
        call_id: String(toolCall.id),
        name: normalizeToolNameForOpenAI(
          String(toolCall.name),
          input.toolNameMapping,
        ),
        arguments:
          typeof toolCall.input === 'string'
            ? toolCall.input
            : JSON.stringify(toolCall.input ?? {}),
      })
    }
  }

  return {
    model: targetModel,
    input: items,
    ...(systemText ? { instructions: systemText } : {}),
    temperature: input.temperature,
    max_output_tokens: input.max_tokens,
    ...(getResponsesToolDefinitions(input.tools)
      ? {
          tools: getResponsesToolDefinitions(input.tools)?.map(tool => ({
            ...tool,
            name: normalizeToolNameForOpenAI(
              tool.name,
              input.toolNameMapping,
            ),
          })),
        }
      : {}),
    ...(input.tool_choice?.type === 'tool'
      ? {
          tool_choice: {
            type: 'function' as const,
            name: normalizeToolNameForOpenAI(
              input.tool_choice.name,
              input.toolNameMapping,
            ),
          },
        }
      : input.tool_choice?.type === 'auto'
        ? { tool_choice: 'auto' as const }
        : {}),
    ...(input.thinking?.type === 'enabled' || input.thinking?.type === 'adaptive'
      ? {
          ...(mapEffortToResponsesReasoning(input.effort)
            ? { reasoning: mapEffortToResponsesReasoning(input.effort) }
            : {}),
        }
      : {}),
  }
}

export async function createOpenAIResponsesStream(
  config: OpenAICompatConfig,
  request: OpenAIResponsesRequest,
  signal?: AbortSignal,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await (config.fetch ?? globalThis.fetch)(
    joinBaseUrl(config.baseURL, '/responses'),
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
      `OpenAI Responses compatible request failed with status ${response.status}${responseText ? `: ${responseText}` : ''}`,
    )
  }

  return response.body.getReader()
}

function getEventTextDelta(event: OpenAIResponsesEvent): string | undefined {
  if (typeof event.delta === 'string' && event.delta.length > 0) return event.delta
  if (typeof event.part?.text === 'string' && event.part.text.length > 0) return event.part.text
  return undefined
}

function getEventThinkingDelta(event: OpenAIResponsesEvent): string | undefined {
  const eventSummary = Array.isArray(event.summary)
    ? event.summary
        .map(part => (typeof part?.text === 'string' ? part.text : ''))
        .join('')
    : ''
  if (eventSummary.length > 0) return eventSummary

  const partSummary = Array.isArray(event.part?.summary)
    ? event.part.summary
        .map(part => (typeof part?.text === 'string' ? part.text : ''))
        .join('')
    : ''
  if (partSummary.length > 0) return partSummary

  if (
    typeof event.part?.text === 'string' &&
    event.part.text.length > 0 &&
    event.type?.includes('reasoning')
  ) {
    return event.part.text
  }

  if (typeof event.delta === 'string' && event.delta.length > 0 && event.type?.includes('reasoning')) {
    return event.delta
  }

  return undefined
}

function getToolCallDetails(event: OpenAIResponsesEvent): { id?: string; name?: string } {
  const item = event.item ?? {}
  return {
    id:
      typeof item.call_id === 'string'
        ? item.call_id
        : typeof event.item_id === 'string'
          ? event.item_id
          : undefined,
    name: typeof item.name === 'string' ? item.name : undefined,
  }
}

export async function* createAnthropicStreamFromOpenAIResponses(input: {
  reader: ReadableStreamDefaultReader<Uint8Array>
  model: string
  toolNameMapping?: ToolNameMapping
}): AsyncGenerator<BetaRawMessageStreamEvent, BetaMessage, void> {
  const decoder = new TextDecoder()
  let buffer = ''
  let started = false
  let activeNarrativeType: 'text' | 'thinking' | null = null
  let activeNarrativeIndex: number | null = null
  let nextContentIndex = 0
  let emittedAnyContent = false
  let promptTokens = 0
  let completionTokens = 0
  let responseId = 'openai-responses-compat'
  let stopReason: BetaMessage['stop_reason'] = 'end_turn'
  const taggedThinkingState = createTaggedThinkingStreamState()
  const toolStateById = new Map<string, ToolState>()
  const toolIdsInOrder: string[] = []

  const closeActiveNarrative = function* (): Generator<BetaRawMessageStreamEvent> {
    if (activeNarrativeType === null || activeNarrativeIndex === null) return
    yield {
      type: 'content_block_stop',
      index: activeNarrativeIndex,
    } as BetaRawMessageStreamEvent
    activeNarrativeType = null
    activeNarrativeIndex = null
  }

  const emitNarrative = function* (
    type: 'text' | 'thinking',
    text: string,
  ): Generator<BetaRawMessageStreamEvent> {
    if (!text) return
    if (activeNarrativeType !== type) {
      yield* closeActiveNarrative()
      activeNarrativeType = type
      activeNarrativeIndex = nextContentIndex
      nextContentIndex += 1
      yield {
        type: 'content_block_start',
        index: activeNarrativeIndex,
        content_block:
          type === 'thinking'
            ? {
                type: 'thinking',
                thinking: '',
                signature: '',
              }
            : {
                type: 'text',
                text: '',
              },
      } as BetaRawMessageStreamEvent
    }

    yield {
      type: 'content_block_delta',
      index: activeNarrativeIndex ?? 0,
      delta:
        type === 'thinking'
          ? {
              type: 'thinking_delta',
              thinking: text,
            }
          : {
              type: 'text_delta',
              text,
            },
    } as BetaRawMessageStreamEvent
    emittedAnyContent = true
  }

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
        const event = JSON.parse(data) as OpenAIResponsesEvent
        if (!event || typeof event !== 'object') {
          throw new Error(
            `[openaiResponsesCompat] invalid stream event: ${String(data).slice(0, 500)}`,
          )
        }

        responseId = event.response?.id ?? event.response_id ?? responseId

        if (!started) {
          started = true
          promptTokens = event.response?.usage?.input_tokens ?? 0
          yield {
            type: 'message_start',
            message: {
              id: responseId,
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

        const eventType = event.type ?? ''
        const textDelta = getEventTextDelta(event)
        const thinkingDelta = getEventThinkingDelta(event)
        if (thinkingDelta && eventType.includes('reasoning')) {
          yield* emitNarrative('thinking', thinkingDelta)
        }
        if (textDelta && (eventType.includes('text') || eventType.includes('content_part'))) {
          const pendingBefore = taggedThinkingState.pending
          const inThinkingBefore = taggedThinkingState.inThinking
          const segments = consumeTaggedThinkingChunk(
            textDelta,
            taggedThinkingState,
          )
          const parserConsumedTaggedThinking =
            pendingBefore !== taggedThinkingState.pending ||
            inThinkingBefore !== taggedThinkingState.inThinking ||
            textDelta.includes('<think>') ||
            textDelta.includes('</think>')

          if (segments.length === 0) {
            if (!parserConsumedTaggedThinking) {
              yield* emitNarrative('text', textDelta)
            }
          } else {
            for (const segment of segments) {
              yield* emitNarrative(
                segment.type === 'thinking' ? 'thinking' : 'text',
                segment.text,
              )
            }
          }
        }

        if (eventType.includes('function_call')) {
          for (const segment of flushTaggedThinkingState(taggedThinkingState)) {
            yield* emitNarrative(
              segment.type === 'thinking' ? 'thinking' : 'text',
              segment.text,
            )
          }
          yield* closeActiveNarrative()
          const details = getToolCallDetails(event)
          const toolId = details.id ?? `toolu_${toolIdsInOrder.length}`
          let toolState = toolStateById.get(toolId)
          if (!toolState) {
            toolState = {
              id: toolId,
              name: '',
              pendingArgumentDeltas: [],
              started: false,
            }
            toolStateById.set(toolId, toolState)
            toolIdsInOrder.push(toolId)
          }

          if (details.name) {
            toolState.name = restoreToolNameFromOpenAI(
              details.name,
              input.toolNameMapping,
            )
          }

          if (!toolState.started && toolState.name) {
            toolState.anthropicIndex = nextContentIndex
            toolState.started = true
            nextContentIndex += 1
            yield {
              type: 'content_block_start',
              index: toolState.anthropicIndex,
              content_block: {
                type: 'tool_use',
                id: toolState.id,
                name: toolState.name,
                input: '',
              },
            } as BetaRawMessageStreamEvent
            emittedAnyContent = true

            for (const pendingArguments of toolState.pendingArgumentDeltas) {
              yield {
                type: 'content_block_delta',
                index: toolState.anthropicIndex,
                delta: {
                  type: 'input_json_delta',
                  partial_json: pendingArguments,
                },
              } as BetaRawMessageStreamEvent
              emittedAnyContent = true
            }
            toolState.pendingArgumentDeltas = []
          }

          const argumentsDelta =
            typeof event.arguments_delta === 'string'
              ? event.arguments_delta
              : typeof event.item?.arguments === 'string' && eventType.includes('added')
                ? (event.item.arguments as string)
                : undefined

          if (argumentsDelta) {
            if (toolState.started && typeof toolState.anthropicIndex === 'number') {
              yield {
                type: 'content_block_delta',
                index: toolState.anthropicIndex,
                delta: {
                  type: 'input_json_delta',
                  partial_json: argumentsDelta,
                },
              } as BetaRawMessageStreamEvent
              emittedAnyContent = true
            } else {
              toolState.pendingArgumentDeltas.push(argumentsDelta)
            }
            stopReason = 'tool_use'
          }
        }

        if (eventType === 'response.completed') {
          promptTokens = event.response?.usage?.input_tokens ?? promptTokens
          completionTokens = event.response?.usage?.output_tokens ?? completionTokens
        }

        if (eventType === 'response.failed') {
          throw new Error('[openaiResponsesCompat] response.failed received from Responses API')
        }
      }
    }
  }

  if (!started) {
    throw new Error(
      `[openaiResponsesCompat] stream ended before message_start for model=${input.model}`,
    )
  }

  for (const segment of flushTaggedThinkingState(taggedThinkingState)) {
    yield* emitNarrative(
      segment.type === 'thinking' ? 'thinking' : 'text',
      segment.text,
    )
  }

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

  yield* closeActiveNarrative()

  for (const toolId of toolIdsInOrder) {
    const toolState = toolStateById.get(toolId)
    if (!toolState) continue
    if (!toolState.started) {
      toolState.name = toolState.name || 'tool'
      toolState.anthropicIndex = nextContentIndex
      toolState.started = true
      nextContentIndex += 1
      yield {
        type: 'content_block_start',
        index: toolState.anthropicIndex,
        content_block: {
          type: 'tool_use',
          id: toolState.id,
          name: toolState.name,
          input: '',
        },
      } as BetaRawMessageStreamEvent
      emittedAnyContent = true
      for (const pendingArguments of toolState.pendingArgumentDeltas) {
        yield {
          type: 'content_block_delta',
          index: toolState.anthropicIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: pendingArguments,
          },
        } as BetaRawMessageStreamEvent
      }
    }
    yield {
      type: 'content_block_stop',
      index: toolState.anthropicIndex ?? 0,
    } as BetaRawMessageStreamEvent
  }

  yield {
    type: 'message_delta',
    delta: {
      stop_reason: stopReason,
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
    id: responseId,
    type: 'message',
    role: 'assistant',
    model: input.model,
    content: [],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: promptTokens,
      output_tokens: completionTokens,
    },
  } as BetaMessage
}

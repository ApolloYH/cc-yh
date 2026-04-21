import { createHash } from 'node:crypto'
import type { AnthropicContentBlock } from './types.js'

export type ToolNameMapping = Record<string, string>

type AnyBlock = Record<string, unknown>

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

export function serializeAnthropicContentValue(
  value: string | AnthropicContentBlock[] | unknown,
): string {
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

export function anthropicBlockToDocumentText(block: AnthropicContentBlock): string {
  return extractDocumentText(block as unknown as AnyBlock)
}

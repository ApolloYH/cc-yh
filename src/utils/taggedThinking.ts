export type TaggedThinkingSegment =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }

export type TaggedThinkingStreamState = {
  pending: string
  inThinking: boolean
}

const OPEN_TAG = '<think>'
const CLOSE_TAG = '</think>'

function stripOrphanCloseTags(text: string): string {
  return text.includes(CLOSE_TAG) ? text.split(CLOSE_TAG).join('') : text
}

function longestPartialMatch(value: string, token: string): number {
  const max = Math.min(value.length, token.length - 1)
  for (let size = max; size > 0; size -= 1) {
    if (value.endsWith(token.slice(0, size))) {
      return size
    }
  }
  return 0
}

export function splitTaggedThinkingText(input: string): TaggedThinkingSegment[] {
  if (!input.includes(OPEN_TAG)) {
    const sanitized = stripOrphanCloseTags(input)
    return sanitized.length > 0 ? [{ type: 'text', text: sanitized }] : []
  }

  const segments: TaggedThinkingSegment[] = []
  let cursor = 0

  while (cursor < input.length) {
    const openIndex = input.indexOf(OPEN_TAG, cursor)
    if (openIndex === -1) {
      const tail = input.slice(cursor)
      if (tail) segments.push({ type: 'text', text: tail })
      break
    }

    const before = input.slice(cursor, openIndex)
    const sanitizedBefore = stripOrphanCloseTags(before)
    if (sanitizedBefore) segments.push({ type: 'text', text: sanitizedBefore })

    const thinkStart = openIndex + OPEN_TAG.length
    const closeIndex = input.indexOf(CLOSE_TAG, thinkStart)
    if (closeIndex === -1) {
      const remainder = input.slice(openIndex)
      if (remainder) segments.push({ type: 'text', text: remainder })
      break
    }

    const thinking = input.slice(thinkStart, closeIndex)
    if (thinking) segments.push({ type: 'thinking', text: thinking })
    cursor = closeIndex + CLOSE_TAG.length
  }

  return segments
}

export function createTaggedThinkingStreamState(): TaggedThinkingStreamState {
  return {
    pending: '',
    inThinking: false,
  }
}

export function consumeTaggedThinkingChunk(
  chunk: string,
  state: TaggedThinkingStreamState,
): TaggedThinkingSegment[] {
  state.pending += chunk
  const segments: TaggedThinkingSegment[] = []

  while (state.pending.length > 0) {
    if (!state.inThinking) {
      const openIndex = state.pending.indexOf(OPEN_TAG)
      if (openIndex === -1) {
        const keep = longestPartialMatch(state.pending, OPEN_TAG)
        const emit = stripOrphanCloseTags(
          state.pending.slice(0, state.pending.length - keep),
        )
        if (emit) segments.push({ type: 'text', text: emit })
        state.pending = state.pending.slice(state.pending.length - keep)
        break
      }

      const before = stripOrphanCloseTags(state.pending.slice(0, openIndex))
      if (before) segments.push({ type: 'text', text: before })
      state.pending = state.pending.slice(openIndex + OPEN_TAG.length)
      state.inThinking = true
      continue
    }

    const closeIndex = state.pending.indexOf(CLOSE_TAG)
    if (closeIndex === -1) {
      const keep = longestPartialMatch(state.pending, CLOSE_TAG)
      const emit = state.pending.slice(0, state.pending.length - keep)
      if (emit) segments.push({ type: 'thinking', text: emit })
      state.pending = state.pending.slice(state.pending.length - keep)
      break
    }

    const thinking = state.pending.slice(0, closeIndex)
    if (thinking) segments.push({ type: 'thinking', text: thinking })
    state.pending = state.pending.slice(closeIndex + CLOSE_TAG.length)
    state.inThinking = false
  }

  return segments
}

export function flushTaggedThinkingState(
  state: TaggedThinkingStreamState,
): TaggedThinkingSegment[] {
  if (!state.pending) return []

  const segments: TaggedThinkingSegment[] = []
  if (state.inThinking) {
    segments.push({ type: 'thinking', text: state.pending })
  } else {
    const sanitized = stripOrphanCloseTags(state.pending)
    if (sanitized) segments.push({ type: 'text', text: sanitized })
  }
  state.pending = ''
  return segments
}

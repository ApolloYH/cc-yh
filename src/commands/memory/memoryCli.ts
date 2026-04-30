import {
  applyMemoryV2DistillCandidate,
  detectMemoryV2Stale,
  generateMemoryV2DistillCandidates,
  getMemoryV2Status,
  readMemoryV2Entry,
  searchMemoryV2,
  summarizeMemoryV2Sessions,
  updateMemoryV2Entry,
  writeMemoryFact,
  writeMemorySop,
  type MemoryLayer,
  type MemoryV2DistillCandidate,
  type MemoryV2Entry,
} from '../../memoryV2/index.js'
import { getMemoryEmbeddingConfig } from '../../memoryV2/embeddingProvider.js'

export async function runMemoryCli(args: string): Promise<string> {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const [action, ...rest] = tokens

  if (!action || action === 'status' || action === 'list') {
    return formatStatus(await getMemoryV2Status())
  }

  if (action === 'show') {
    const layer = parseLayer(rest[0])
    const id = rest[1] || (layer === 'L1' ? 'index' : '')
    if (!id) return usage()
    return formatEntry(await readMemoryV2Entry(layer, id), true)
  }

  if (action === 'search') {
    const query = rest.join(' ')
    if (!query.trim()) return 'Usage: /memory search <query>'
    const results = await searchMemoryV2(query, 12)
    return [
      `Memory search: ${query}`,
      `Results: ${results.length}`,
      '',
      ...results.map((result, index) => [
        `${index + 1}. ${result.entry.layer}/${result.entry.id} score=${result.score.toFixed(3)}`,
        `   ${result.entry.title}`,
        `   ${result.entry.summary || result.entry.path}`,
        result.matchedTerms.length ? `   matched: ${result.matchedTerms.join(', ')}` : '',
      ].filter(Boolean).join('\n')),
    ].join('\n')
  }

  if (action === 'summarize') {
    const limit = readLimit(rest[0], 20)
    const entries = await summarizeMemoryV2Sessions(limit)
    return [
      `L4 summaries refreshed: ${entries.length}`,
      '',
      ...entries.slice(0, 10).map(entry => `- ${entry.id}: ${entry.title}`),
    ].join('\n')
  }

  if (action === 'stale') {
    const entries = await detectMemoryV2Stale()
    return entries.length
      ? [
          `Stale memory entries: ${entries.length}`,
          '',
          ...entries.map(entry => `- ${entry.layer}/${entry.id}: ${entry.stale?.reason}`),
        ].join('\n')
      : 'No stale memory entries detected.'
  }

  if (action === 'embedding') {
    const config = await getMemoryEmbeddingConfig()
    return [
      'Memory embedding provider',
      `Provider: ${config.provider}`,
      `Method: ${config.method}`,
      `Base URL: ${config.baseUrl}`,
      `Model: ${config.model}`,
      `Dimensions: ${config.dimensions}`,
      `Batch size: ${config.batchSize}`,
      `API key: ${config.hasApiKey ? 'configured' : 'missing'}`,
      `Source: ${config.source}`,
    ].join('\n')
  }

  if (action === 'distill') {
    const apply = rest[0] === 'apply'
    const candidates = await generateMemoryV2DistillCandidates(12)
    if (apply) {
      const applied: MemoryV2Entry[] = []
      for (const candidate of candidates) {
        applied.push(await applyMemoryV2DistillCandidate(candidate as MemoryV2DistillCandidate))
      }
      return [
        `Distill candidates applied: ${applied.length}`,
        '',
        ...applied.map(entry => `- ${entry.layer}/${entry.id}: ${entry.title}`),
      ].join('\n')
    }
    return candidates.length
      ? [
          `Distill candidates: ${candidates.length}`,
          '',
          ...candidates.map(candidate => [
            `- ${candidate.id} -> ${candidate.layer}: ${candidate.title}`,
            `  confidence=${candidate.confidence}; ${candidate.reason}`,
          ].join('\n')),
          '',
          'Run /memory distill apply to save all current candidates.',
        ].join('\n')
      : 'No distill candidates found.'
  }

  if (action === 'set') {
    const layer = parseLayer(rest[0])
    const id = rest[1] || (layer === 'L1' ? 'index' : '')
    const content = rest.slice(2).join(' ')
    if (!id || !content.trim()) return 'Usage: /memory set <L1|L2|L3|L4> <id> <content>'
    const entry = await updateMemoryV2Entry({
      layer,
      id,
      content,
      verified: true,
    })
    return `Updated ${entry.layer}/${entry.id}: ${entry.path}`
  }

  if (action === 'fact' || action === 'sop') {
    const title = rest[0]
    const content = rest.slice(1).join(' ')
    if (!title || !content.trim()) return `Usage: /memory ${action} <title> <content>`
    const entry = action === 'fact'
      ? await writeMemoryFact({ title, content, verified: true, source: 'cli' })
      : await writeMemorySop({ title, content, verified: true, source: 'cli' })
    return `Saved ${entry.layer}/${entry.id}: ${entry.path}`
  }

  return usage()
}

function formatStatus(status: Awaited<ReturnType<typeof getMemoryV2Status>>): string {
  return [
    'Memory L1-L4',
    `Root: ${status.root}`,
    `Vector index: ${status.vectorIndexPath}`,
    `Embedding: ${status.embeddingMethod} model=${status.embeddingModel} dimensions=${status.embeddingDimensions}`,
    `FAISS: ${status.faissIndexPath}`,
    `Distill candidates: ${status.candidatePath}`,
    '',
    ...status.layers.map(layer => [
      `${layer.layer} ${layer.title}`,
      `Path: ${layer.path}`,
      `Entries: ${layer.entries.length}`,
      ...layer.entries.slice(0, 8).map(entry => `- ${entry.id}: ${entry.title}${entry.stale?.severity === 'stale' ? ' [stale]' : ''}`),
    ].join('\n')),
  ].join('\n\n')
}

function formatEntry(entry: MemoryV2Entry, includeContent: boolean): string {
  return [
    `${entry.layer}/${entry.id}`,
    `Title: ${entry.title}`,
    `Path: ${entry.path}`,
    entry.source ? `Source: ${entry.source}` : '',
    `Verified: ${entry.verified}`,
    entry.stale ? `Freshness: ${entry.stale.severity} - ${entry.stale.reason}` : '',
    entry.summary ? `Summary: ${entry.summary}` : '',
    includeContent ? ['', entry.content || ''] : '',
  ].filter(line => line !== '').join('\n')
}

function parseLayer(value: string | undefined): MemoryLayer {
  if (value === 'L1' || value === 'L2' || value === 'L3' || value === 'L4') return value
  throw new Error('layer must be one of L1, L2, L3, L4')
}

function readLimit(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function usage(): string {
  return [
    'Usage:',
    '/memory list',
    '/memory show <L1|L2|L3|L4> <id>',
    '/memory search <query>',
    '/memory summarize [limit]',
    '/memory stale',
    '/memory embedding',
    '/memory distill',
    '/memory distill apply',
    '/memory fact <title> <content>',
    '/memory sop <title> <content>',
    '/memory set <L1|L2|L3|L4> <id> <content>',
    '',
    'Without arguments, /memory opens the existing interactive memory file editor.',
  ].join('\n')
}

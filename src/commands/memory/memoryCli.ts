import {
  getMemoryV2Status,
  readMemoryV2Entry,
  searchMemoryV2,
  updateMemoryV2Entry,
  type MemoryLayer,
  type MemoryV2Entry,
} from '../../memoryV2/index.js'

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

  return usage()
}

function formatStatus(status: Awaited<ReturnType<typeof getMemoryV2Status>>): string {
  return [
    'Memory L1-L4',
    `Root: ${status.root}`,
    'Search: keyword markdown search',
    `Distill candidates: ${status.candidatePath}`,
    '',
    ...status.layers.map(layer => [
      `${layer.layer} ${layer.title}`,
      `Path: ${layer.path}`,
      `Entries: ${layer.entries.length}`,
      ...layer.entries.slice(0, 8).map(entry => `- ${entry.id}: ${entry.title}`),
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
    entry.summary ? `Summary: ${entry.summary}` : '',
    includeContent ? ['', entry.content || ''] : '',
  ].filter(line => line !== '').join('\n')
}

function parseLayer(value: string | undefined): MemoryLayer {
  if (value === 'L1' || value === 'L2' || value === 'L3' || value === 'L4') return value
  throw new Error('layer must be one of L1, L2, L3, L4')
}

function usage(): string {
  return [
    'Usage:',
    '/memory list',
    '/memory show <L1|L2|L3|L4> <id>',
    '/memory search <query>',
    '/memory set <L1|L2|L3|L4> <id> <content>',
    '',
    'Without arguments, /memory opens the existing interactive memory file editor.',
  ].join('\n')
}

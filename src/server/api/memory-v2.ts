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
  type MemoryV2WriteInput,
} from '../../memoryV2/index.js'
import { getMemoryEmbeddingConfig } from '../../memoryV2/embeddingProvider.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { SettingsService } from '../services/settingsService.js'

export async function handleMemoryV2Api(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const method = req.method
    const action = segments[2]

    if (method === 'GET' && !action) {
      return Response.json(await getMemoryV2Status())
    }

    if (method === 'GET' && action === 'search') {
      const query = _url.searchParams.get('q') || ''
      const limit = readOptionalNumber(_url.searchParams.get('limit')) ?? 20
      return Response.json({ results: await searchMemoryV2(query, limit) })
    }

    if (method === 'POST' && action === 'search') {
      const body = await parseJsonBody(req)
      const query = typeof body.query === 'string' ? body.query : ''
      const limit = readOptionalNumber(body.limit) ?? 20
      return Response.json({ results: await searchMemoryV2(query, limit) })
    }

    if (method === 'GET' && action === 'entry') {
      const layer = parseLayer(segments[3])
      const id = segments[4]
      if (!id) throw ApiError.badRequest('entry id is required')
      return Response.json({ entry: await readMemoryV2Entry(layer, decodeURIComponent(id)) })
    }

    if ((method === 'PUT' || method === 'PATCH') && action === 'entry') {
      const layer = parseLayer(segments[3])
      const id = segments[4]
      if (!id) throw ApiError.badRequest('entry id is required')
      const body = await parseJsonBody(req)
      const content = typeof body.content === 'string' ? body.content : ''
      if (!content.trim()) throw ApiError.badRequest('content is required')
      try {
        return Response.json({
          entry: await updateMemoryV2Entry({
            layer,
            id: decodeURIComponent(id),
            title: typeof body.title === 'string' ? body.title : undefined,
            content,
            source: typeof body.source === 'string' ? body.source : undefined,
            verified: typeof body.verified === 'boolean' ? body.verified : true,
          }),
        })
      } catch (error) {
        throw ApiError.badRequest(
          error instanceof Error ? error.message : String(error),
        )
      }
    }

    if (method === 'POST' && (action === 'fact' || action === 'sop')) {
      const body = await parseJsonBody(req)
      try {
        const entry =
          action === 'fact'
            ? await writeMemoryFact(body as MemoryV2WriteInput)
            : await writeMemorySop(body as MemoryV2WriteInput)
        return Response.json({ entry }, { status: 201 })
      } catch (error) {
        throw ApiError.badRequest(
          error instanceof Error ? error.message : String(error),
        )
      }
    }

    if (method === 'POST' && action === 'summarize') {
      const body: Record<string, unknown> = await parseJsonBody(req).catch(() => ({}))
      const limit = readOptionalNumber(body.limit) ?? 20
      return Response.json({ entries: await summarizeMemoryV2Sessions(limit) }, { status: 201 })
    }

    if (method === 'GET' && action === 'stale') {
      return Response.json({ entries: await detectMemoryV2Stale() })
    }

    if (method === 'GET' && action === 'embedding') {
      return Response.json({ config: publicEmbeddingConfig(await getMemoryEmbeddingConfig()) })
    }

    if (method === 'PUT' && action === 'embedding') {
      const body = await parseJsonBody(req)
      const service = new SettingsService()
      const current = await service.getUserSettings()
      const currentEmbedding = current.memoryEmbedding && typeof current.memoryEmbedding === 'object'
        ? current.memoryEmbedding as Record<string, unknown>
        : {}
      const next = {
        ...currentEmbedding,
        ...sanitizeEmbeddingSettings(body),
      }
      await service.updateUserSettings({ memoryEmbedding: next })
      return Response.json({ config: publicEmbeddingConfig(await getMemoryEmbeddingConfig()) })
    }

    if (method === 'POST' && action === 'distill') {
      const body: Record<string, unknown> = await parseJsonBody(req).catch(() => ({}))
      const limit = readOptionalNumber(body.limit) ?? 10
      const candidates = await generateMemoryV2DistillCandidates(limit)
      if (body.apply === true) {
        const requestedIds = Array.isArray(body.ids)
          ? new Set(body.ids.filter((id): id is string => typeof id === 'string'))
          : null
        const selected = requestedIds
          ? candidates.filter(candidate => requestedIds.has(candidate.id))
          : candidates
        const applied = []
        for (const candidate of selected) {
          applied.push(await applyMemoryV2DistillCandidate(candidate as MemoryV2DistillCandidate))
        }
        return Response.json({ candidates, applied }, { status: 201 })
      }
      return Response.json({ candidates }, { status: 201 })
    }

    throw new ApiError(
      405,
      `Method ${method} not allowed on /api/memory-v2${action ? `/${action}` : ''}`,
      'METHOD_NOT_ALLOWED',
    )
  } catch (error) {
    return errorResponse(error)
  }
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function parseLayer(value: string | undefined): MemoryLayer {
  if (value === 'L1' || value === 'L2' || value === 'L3' || value === 'L4') return value
  throw ApiError.badRequest('layer must be one of L1, L2, L3, L4')
}

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function sanitizeEmbeddingSettings(body: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  if (typeof body.provider === 'string') {
    const provider = body.provider.trim()
    if (!['dashscope', 'openai-compatible', 'local'].includes(provider)) {
      throw ApiError.badRequest('provider must be dashscope, openai-compatible, or local')
    }
    next.provider = provider
  }
  for (const key of ['baseUrl', 'model', 'apiKeyEnv'] as const) {
    if (typeof body[key] === 'string' && body[key].trim()) next[key] = body[key].trim()
  }
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
    next.apiKey = body.apiKey.trim()
  }
  for (const key of ['dimensions', 'batchSize', 'timeoutMs'] as const) {
    const value = readOptionalNumber(body[key])
    if (value !== undefined && value > 0) next[key] = value
  }
  if (typeof body.enabled === 'boolean') next.enabled = body.enabled
  return next
}

function publicEmbeddingConfig(config: Awaited<ReturnType<typeof getMemoryEmbeddingConfig>>) {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    dimensions: config.dimensions,
    batchSize: config.batchSize,
    timeoutMs: config.timeoutMs,
    enabled: config.enabled,
    hasApiKey: config.hasApiKey,
    method: config.method,
    source: config.source,
  }
}

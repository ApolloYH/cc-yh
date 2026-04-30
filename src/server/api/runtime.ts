import { getSessionIndex } from '../../runtime/sessionIndexService.js'
import { runtimeGlob, runtimeGrep } from '../../runtime/fsSearchService.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

export async function handleRuntimeApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const method = req.method
    const action = segments[2]

    if (method === 'GET' && action === 'session-index') {
      const limitRaw = url.searchParams.get('limit')
      const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined
      const project = url.searchParams.get('project') || undefined
      const query = url.searchParams.get('query') || undefined
      const result = await getSessionIndex({
        limit: Number.isFinite(limit) ? limit : undefined,
        project,
        query,
      })
      return Response.json(result)
    }

    if (method === 'POST' && action === 'fs-glob') {
      const body = await parseJsonBody(req)
      const cwd = typeof body.cwd === 'string' ? body.cwd : ''
      const pattern = typeof body.pattern === 'string' ? body.pattern : ''
      if (!cwd.trim()) throw ApiError.badRequest('cwd is required')
      if (!pattern.trim()) throw ApiError.badRequest('pattern is required')
      return Response.json(await runtimeGlob({
        cwd,
        pattern,
        limit: readOptionalNumber(body.limit),
        offset: readOptionalNumber(body.offset),
      }))
    }

    if (method === 'POST' && action === 'fs-grep') {
      const body = await parseJsonBody(req)
      const cwd = typeof body.cwd === 'string' ? body.cwd : ''
      const pattern = typeof body.pattern === 'string' ? body.pattern : ''
      if (!cwd.trim()) throw ApiError.badRequest('cwd is required')
      if (!pattern.trim()) throw ApiError.badRequest('pattern is required')
      return Response.json(await runtimeGrep({
        cwd,
        pattern,
        glob: typeof body.glob === 'string' ? body.glob : undefined,
        caseInsensitive:
          typeof body.caseInsensitive === 'boolean'
            ? body.caseInsensitive
            : undefined,
        limit: readOptionalNumber(body.limit),
        offset: readOptionalNumber(body.offset),
      }))
    }

    throw new ApiError(
      405,
      `Method ${method} not allowed on /api/runtime${action ? `/${action}` : ''}`,
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

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined
}

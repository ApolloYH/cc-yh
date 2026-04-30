import { getSessionIndex } from '../../runtime/sessionIndexService.js'
import { runtimeGlob, runtimeGrep } from '../../runtime/fsSearchService.js'
import { runtimeReadFile, runtimeWriteFile } from '../../runtime/fsOpsService.js'
import { runtimeClassifyShell } from '../../runtime/shellSafetyService.js'
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
        hidden: readOptionalBoolean(body.hidden),
        respectGitignore: readOptionalBoolean(body.respectGitignore),
        excludeDefaultDirs: readOptionalBoolean(body.excludeDefaultDirs),
        excludeGlobs: readOptionalStringArray(body.excludeGlobs),
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
        globs: readOptionalStringArray(body.globs),
        type: typeof body.type === 'string' ? body.type : undefined,
        caseInsensitive:
          typeof body.caseInsensitive === 'boolean'
            ? body.caseInsensitive
            : undefined,
        multiline: readOptionalBoolean(body.multiline),
        limit: readOptionalNumber(body.limit),
        offset: readOptionalNumber(body.offset),
        hidden: readOptionalBoolean(body.hidden),
        respectGitignore: readOptionalBoolean(body.respectGitignore),
        excludeDefaultDirs: readOptionalBoolean(body.excludeDefaultDirs),
        excludeGlobs: readOptionalStringArray(body.excludeGlobs),
        maxColumns: readOptionalNumber(body.maxColumns),
      }))
    }

    if (method === 'POST' && action === 'fs-read') {
      const body = await parseJsonBody(req)
      const filePath = typeof body.path === 'string' ? body.path : ''
      if (!filePath.trim()) throw ApiError.badRequest('path is required')
      return Response.json(await runtimeReadFile({
        cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
        path: filePath,
        maxBytes: readOptionalNumber(body.maxBytes),
      }))
    }

    if (method === 'POST' && action === 'fs-write') {
      const body = await parseJsonBody(req)
      const filePath = typeof body.path === 'string' ? body.path : ''
      const content = typeof body.content === 'string' ? body.content : undefined
      if (!filePath.trim()) throw ApiError.badRequest('path is required')
      if (content === undefined) throw ApiError.badRequest('content is required')
      return Response.json(await runtimeWriteFile({
        cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
        path: filePath,
        content,
        createDirs: readOptionalBoolean(body.createDirs),
        overwrite: readOptionalBoolean(body.overwrite),
      }))
    }

    if (method === 'POST' && action === 'shell-classify') {
      const body = await parseJsonBody(req)
      const command = typeof body.command === 'string' ? body.command : ''
      if (!command.trim()) throw ApiError.badRequest('command is required')
      return Response.json(await runtimeClassifyShell({
        shell: typeof body.shell === 'string' ? body.shell : 'bash',
        command,
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

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string')
}

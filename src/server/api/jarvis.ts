import { jarvisService } from '../services/jarvisService.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import type { JarvisModeConfig } from '../../jarvis/types.js'

export async function handleJarvisApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const method = req.method
    const action = segments[2]

    if (method === 'GET' && !action) {
      return Response.json(await jarvisService.getStatus())
    }

    if (method === 'PUT' && action === 'config') {
      const body = (await parseJsonBody(req)) as Partial<JarvisModeConfig>
      return Response.json(await jarvisService.updateConfig(body))
    }

    if (method === 'POST' && action === 'start') {
      return Response.json(await jarvisService.updateConfig({ enabled: true }))
    }

    if (method === 'POST' && action === 'stop') {
      return Response.json(await jarvisService.updateConfig({ enabled: false }))
    }

    if (method === 'POST' && action === 'tick') {
      const event = await jarvisService.tick('manual')
      const status = await jarvisService.getStatus()
      return Response.json({ event, status })
    }

    throw new ApiError(
      405,
      `Method ${method} not allowed on /api/jarvis${action ? `/${action}` : ''}`,
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

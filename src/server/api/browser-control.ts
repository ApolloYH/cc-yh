import {
  assessBrowserControlAction,
  BROWSER_CONTROL_BACKENDS,
  executeBrowserControl,
  readBrowserControlPolicy,
  updateBrowserControlPolicy,
  type BrowserControlAction,
  type BrowserControlExecuteRequest,
} from '../../browserControl/index.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

export async function handleBrowserControlApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const method = req.method
    const action = segments[2]

    if (method === 'GET' && !action) {
      return Response.json({
        policy: await readBrowserControlPolicy(),
        backends: BROWSER_CONTROL_BACKENDS,
      })
    }

    if (method === 'PUT' && action === 'policy') {
      const body = await parseJsonBody(req)
      return Response.json({
        policy: await updateBrowserControlPolicy(body),
        backends: BROWSER_CONTROL_BACKENDS,
      })
    }

    if (method === 'POST' && action === 'assess') {
      const body = await parseJsonBody(req)
      const backendId = typeof body.backendId === 'string' ? body.backendId : ''
      const backend = BROWSER_CONTROL_BACKENDS.find(item => item.id === backendId)
      if (!backend) throw ApiError.badRequest(`Unknown browser backend: ${backendId}`)
      const browserAction = body.action as BrowserControlAction | undefined
      if (!browserAction || typeof browserAction.capability !== 'string') {
        throw ApiError.badRequest('Field "action.capability" is required')
      }
      const policy = await readBrowserControlPolicy()
      return Response.json({
        decision: assessBrowserControlAction({
          backend,
          action: browserAction,
          policy,
        }),
        policy,
        backend,
      })
    }

    if (method === 'POST' && action === 'execute') {
      const body = await parseJsonBody(req)
      const backendId = typeof body.backendId === 'string' ? body.backendId : ''
      if (!backendId) throw ApiError.badRequest('Field "backendId" is required')
      const browserAction = body.action as BrowserControlAction | undefined
      if (!browserAction || typeof browserAction.capability !== 'string') {
        throw ApiError.badRequest('Field "action.capability" is required')
      }
      const result = await executeBrowserControl(body as BrowserControlExecuteRequest)
      const status = result.ok
        ? 200
        : 'statusCode' in result
          ? result.statusCode ?? 500
          : 500
      return Response.json(result, {
        status,
      })
    }

    throw new ApiError(
      405,
      `Method ${method} not allowed on /api/browser-control${action ? `/${action}` : ''}`,
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

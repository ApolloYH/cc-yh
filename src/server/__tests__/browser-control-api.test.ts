import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createServer } from 'node:net'
import WebSocket from 'ws'
import { getLocalTmwdBridge } from '../../browserControl/tmwdBridgeServer.js'
import { handleBrowserControlApi } from '../api/browser-control.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalTmwdWsPort: string | undefined

describe('BrowserControl API', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-control-api-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalTmwdWsPort = process.env.CLAUDE_YH_TMWD_WS_PORT
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    getLocalTmwdBridge().close()
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    if (originalTmwdWsPort === undefined) delete process.env.CLAUDE_YH_TMWD_WS_PORT
    else process.env.CLAUDE_YH_TMWD_WS_PORT = originalTmwdWsPort
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('persists policy and assesses actions through the service API', async () => {
    const policyReq = new Request('http://localhost/api/browser-control/policy', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: true,
        allowedDomains: ['example.com'],
      }),
    })
    const policyUrl = new URL(policyReq.url)
    const policyRes = await handleBrowserControlApi(policyReq, policyUrl, [
      'api',
      'browser-control',
      'policy',
    ])
    expect(policyRes.status).toBe(200)

    const assessReq = new Request('http://localhost/api/browser-control/assess', {
      method: 'POST',
      body: JSON.stringify({
        backendId: 'claude-in-chrome',
        action: {
          capability: 'page.read_dom',
          url: 'https://example.com/docs',
        },
      }),
    })
    const assessUrl = new URL(assessReq.url)
    const assessRes = await handleBrowserControlApi(assessReq, assessUrl, [
      'api',
      'browser-control',
      'assess',
    ])
    const body = await assessRes.json()

    expect(assessRes.status).toBe(200)
    expect(body.decision.decision).toBe('allow')
  })

  it('blocks execution when policy requires confirmation', async () => {
    await handleBrowserControlApi(
      new Request('http://localhost/api/browser-control/policy', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          allowedDomains: ['example.com'],
        }),
      }),
      new URL('http://localhost/api/browser-control/policy'),
      ['api', 'browser-control', 'policy'],
    )

    const executeReq = new Request('http://localhost/api/browser-control/execute', {
      method: 'POST',
      body: JSON.stringify({
        backendId: 'chrome-devtools',
        action: {
          capability: 'page.click',
          url: 'https://example.com',
          description: 'Click example page',
        },
        selector: 'a',
      }),
    })
    const executeRes = await handleBrowserControlApi(
      executeReq,
      new URL(executeReq.url),
      ['api', 'browser-control', 'execute'],
    )
    const body = await executeRes.json()

    expect(executeRes.status).toBe(409)
    expect(body.ok).toBe(false)
    expect(body.decision.decision).toBe('confirm')
  })

  it('allows read-only tabs execution to reach backend discovery', async () => {
    await handleBrowserControlApi(
      new Request('http://localhost/api/browser-control/policy', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          allowedDomains: ['example.com'],
        }),
      }),
      new URL('http://localhost/api/browser-control/policy'),
      ['api', 'browser-control', 'policy'],
    )

    const executeReq = new Request('http://localhost/api/browser-control/execute', {
      method: 'POST',
      body: JSON.stringify({
        backendId: 'chrome-devtools',
        action: { capability: 'tabs.read' },
      }),
    })
    const executeRes = await handleBrowserControlApi(
      executeReq,
      new URL(executeReq.url),
      ['api', 'browser-control', 'execute'],
    )
    const body = await executeRes.json()

    expect(executeRes.status).toBe(503)
    expect(body.ok).toBe(false)
    expect(body.decision.decision).toBe('allow')
    expect(body.error).toBe('chrome_devtools_endpoint_required')
  })

  it('executes through the GA-compatible local TMWD bridge', async () => {
    process.env.CLAUDE_YH_TMWD_WS_PORT = String(await getFreePort())
    await handleBrowserControlApi(
      new Request('http://localhost/api/browser-control/policy', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          allowedDomains: ['example.com'],
          allowHighRiskBackends: true,
        }),
      }),
      new URL('http://localhost/api/browser-control/policy'),
      ['api', 'browser-control', 'policy'],
    )

    const bridge = getLocalTmwdBridge()
    const state = await bridge.ensureStarted()
    expect(state.status).toBe('running')

    const extension = new WebSocket(`ws://127.0.0.1:${state.port}`)
    await waitForOpen(extension)
    extension.send(JSON.stringify({
      type: 'ext_ready',
      tabs: [{ id: 202, url: 'https://example.com', title: 'Example', active: true }],
    }))
    await bridge.waitForClient(1_000)
    await waitFor(() => bridge.listTabs().length === 1)
    extension.on('message', raw => {
      const request = JSON.parse(raw.toString()) as { id: string; tabId: number }
      extension.send(JSON.stringify({ type: 'ack', id: request.id }))
      extension.send(JSON.stringify({
        type: 'result',
        id: request.id,
        result: {
          title: 'Example Domain',
          url: 'https://example.com',
          text: 'Example Domain',
        },
      }))
    })

    const executeReq = new Request('http://localhost/api/browser-control/execute', {
      method: 'POST',
      body: JSON.stringify({
        backendId: 'tmwd-cdp-bridge',
        action: {
          capability: 'page.read_dom',
          url: 'https://example.com',
          domain: 'example.com',
          userConfirmed: true,
        },
      }),
    })
    const executeRes = await handleBrowserControlApi(
      executeReq,
      new URL(executeReq.url),
      ['api', 'browser-control', 'execute'],
    )
    const body = await executeRes.json()

    expect(executeRes.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.backendId).toBe('tmwd-cdp-bridge')
    expect(body.data.title).toBe('Example Domain')

    extension.close()
  })

  it('executes TMWD advanced upload, cookie, and CDP regression paths', async () => {
    process.env.CLAUDE_YH_TMWD_WS_PORT = String(await getFreePort())
    await handleBrowserControlApi(
      new Request('http://localhost/api/browser-control/policy', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          allowedDomains: ['example.com'],
          allowHighRiskBackends: true,
          allowHighRiskCapabilities: true,
          requireConfirmationForSensitiveActions: true,
        }),
      }),
      new URL('http://localhost/api/browser-control/policy'),
      ['api', 'browser-control', 'policy'],
    )

    const uploadFile = path.join(tmpDir, 'upload.txt')
    await fs.writeFile(uploadFile, 'upload', 'utf-8')
    const bridge = getLocalTmwdBridge()
    const state = await bridge.ensureStarted()
    const extension = new WebSocket(`ws://127.0.0.1:${state.port}`)
    await waitForOpen(extension)
    extension.send(JSON.stringify({
      type: 'ext_ready',
      tabs: [{ id: 303, url: 'https://example.com/upload', title: 'Upload', active: true }],
    }))
    await bridge.waitForClient(1_000)

    const methods: string[] = []
    extension.on('message', raw => {
      const request = JSON.parse(raw.toString()) as {
        id: string
        code: string | { cmd?: string; method?: string }
      }
      if (typeof request.code === 'object') methods.push(request.code.method ?? request.code.cmd ?? '')
      extension.send(JSON.stringify({ type: 'ack', id: request.id }))
      if (typeof request.code === 'object' && request.code.method === 'DOM.getDocument') {
        extension.send(JSON.stringify({ type: 'result', id: request.id, result: { root: { nodeId: 1 } } }))
      } else if (typeof request.code === 'object' && request.code.method === 'DOM.querySelector') {
        extension.send(JSON.stringify({ type: 'result', id: request.id, result: { nodeId: 7 } }))
      } else {
        extension.send(JSON.stringify({ type: 'result', id: request.id, result: { ok: true } }))
      }
    })

    const uploadReq = new Request('http://localhost/api/browser-control/execute', {
      method: 'POST',
      body: JSON.stringify({
        backendId: 'tmwd-cdp-bridge',
        action: {
          capability: 'files.upload',
          url: 'https://example.com/upload',
          domain: 'example.com',
          userConfirmed: true,
        },
        selector: 'input[type=file]',
        filePath: uploadFile,
      }),
    })
    const uploadRes = await handleBrowserControlApi(uploadReq, new URL(uploadReq.url), [
      'api',
      'browser-control',
      'execute',
    ])
    const uploadBody = await uploadRes.json()

    const cookieReq = new Request('http://localhost/api/browser-control/execute', {
      method: 'POST',
      body: JSON.stringify({
        backendId: 'tmwd-cdp-bridge',
        action: {
          capability: 'storage.read_cookies',
          url: 'https://example.com/upload',
          domain: 'example.com',
          userConfirmed: true,
        },
      }),
    })
    const cookieRes = await handleBrowserControlApi(cookieReq, new URL(cookieReq.url), [
      'api',
      'browser-control',
      'execute',
    ])

    expect(uploadRes.status).toBe(200)
    expect(uploadBody.ok).toBe(true)
    expect(cookieRes.status).toBe(200)
    expect(methods).toContain('DOM.setFileInputFiles')
    expect(methods).toContain('cookies')

    extension.close()
  })

  it('runs current Chrome TMWD smoke checks through the API', async () => {
    process.env.CLAUDE_YH_TMWD_WS_PORT = String(await getFreePort())
    const bridge = getLocalTmwdBridge()
    const state = await bridge.ensureStarted()
    const extension = new WebSocket(`ws://127.0.0.1:${state.port}`)
    await waitForOpen(extension)
    extension.send(JSON.stringify({
      type: 'ext_ready',
      tabs: [{ id: 404, url: 'https://example.com', title: 'Smoke', active: true }],
    }))
    await bridge.waitForClient(1_000)
    await waitFor(() => bridge.listTabs().length === 1)
    extension.on('message', raw => {
      const request = JSON.parse(raw.toString()) as { id: string; code: { method?: string } }
      extension.send(JSON.stringify({ type: 'ack', id: request.id }))
      extension.send(JSON.stringify({
        type: 'result',
        id: request.id,
        result: request.code?.method === 'Runtime.evaluate'
          ? { result: { value: 'https://example.com' } }
          : { ok: true },
      }))
    })

    const smokeReq = new Request('http://localhost/api/browser-control/smoke', {
      method: 'POST',
    })
    const smokeRes = await handleBrowserControlApi(smokeReq, new URL(smokeReq.url), [
      'api',
      'browser-control',
      'smoke',
    ])
    const body = await smokeRes.json()

    expect(smokeRes.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.checks.map((check: { name: string }) => check.name)).toContain('tabs.read')
    expect(body.checks.map((check: { name: string }) => check.name)).toContain('cdp.call Runtime.evaluate')

    extension.close()
  })
})

function waitForOpen(client: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once('open', () => resolve())
    client.once('error', reject)
  })
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 1_000) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('wait_timeout')
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('free_port_not_found'))
      })
    })
    server.on('error', reject)
  })
}

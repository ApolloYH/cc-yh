import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import WebSocket from 'ws'
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { appendBrowserControlAuditEvent } from './audit.js'
import { BROWSER_CONTROL_BACKENDS } from './backends.js'
import { assessBrowserControlAction } from './policy.js'
import { readBrowserControlPolicy } from './store.js'
import { recordBrowserTabRecoverySnapshot } from './tabRecovery.js'
import { getLocalTmwdBridge } from './tmwdBridgeServer.js'
import {
  executeViaBrowserControlOwner,
  isBridgePortInUse,
} from './ownerProxy.js'
import type {
  BrowserControlBackend,
  BrowserControlDecision,
  BrowserControlExecuteRequest,
  BrowserControlExecution,
} from './types.js'

type CdpTarget = {
  id: string
  type?: string
  title?: string
  url?: string
  webSocketDebuggerUrl?: string
}

type CdpMessage = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string }
  exceptionDetails?: unknown
}

type TmwdResponse = {
  r?: unknown
  data?: unknown
  error?: string
}

const DEFAULT_TMWD_ENDPOINT = 'http://127.0.0.1:18766/link'

export async function executeBrowserControl(
  input: BrowserControlExecuteRequest,
): Promise<BrowserControlExecution> {
  const backend = BROWSER_CONTROL_BACKENDS.find(item => item.id === input.backendId)
  if (!backend) {
    return blockedExecution(input.backendId, deny('unknown_backend'), 'unknown_backend', 400)
  }
  if (!input.action || typeof input.action.capability !== 'string') {
    return blockedExecution(backend.id, deny('missing_action_capability'), 'missing_action_capability', 400)
  }

  const policy = await readBrowserControlPolicy()
  const decision = assessBrowserControlAction({
    backend,
    action: input.action,
    policy,
  })
  if (decision.decision !== 'allow') {
    return finalizeExecution({
      backend,
      input,
      decision,
      ok: false,
      error: decision.reason,
      statusCode: decision.decision === 'confirm' ? 409 : 403,
    })
  }

  try {
    const data = await runBackend(backend, input)
    return finalizeExecution({
      backend,
      input,
      decision,
      ok: true,
      data,
    })
  } catch (error) {
    return finalizeExecution({
      backend,
      input,
      decision,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      statusCode: getExecutionStatus(error),
    })
  }
}

async function runBackend(
  backend: BrowserControlBackend,
  input: BrowserControlExecuteRequest,
): Promise<unknown> {
  switch (backend.kind) {
    case 'chrome-devtools':
      return executeChromeDevtools(input)
    case 'tmwd-cdp-bridge':
      return executeTmwdBridge(input)
    case 'mcp':
    case 'chrome-extension':
      return executeHttpBridge(backend, input)
    case 'computer-use':
    case 'playwright':
      throw new BrowserControlExecutionError(
        501,
        `${backend.id}_execution_not_wired`,
      )
    default:
      throw new BrowserControlExecutionError(501, 'backend_kind_not_supported')
  }
}

async function executeChromeDevtools(
  input: BrowserControlExecuteRequest,
): Promise<unknown> {
  const endpoint = await resolveDevtoolsEndpoint(input)

  if (input.action.capability === 'tabs.read') {
    return { tabs: await listCdpPages(endpoint) }
  }

  let target = await resolveCdpTarget(endpoint, input)
  const session = await CdpSession.connect(target.webSocketDebuggerUrl ?? '')
  try {
    await session.send('Runtime.enable')
    await session.send('Page.enable').catch(() => undefined)

    if (
      input.action.url &&
      ['page.navigate', 'page.read_dom', 'page.screenshot'].includes(
        input.action.capability,
      )
    ) {
      await session.send('Page.navigate', { url: input.action.url })
      await sleep(700)
      target = {
        ...target,
        url: input.action.url,
      }
    }

    switch (input.action.capability) {
      case 'page.navigate':
        return readCdpPageSummary(session)
      case 'page.read_dom':
        return readCdpDom(session, input.maxContentLength)
      case 'page.screenshot':
        return session.send('Page.captureScreenshot', {
          format: input.screenshotFormat ?? 'png',
          captureBeyondViewport: input.fullPage ?? true,
        })
      case 'page.click':
        return clickCdpSelector(session, requiredString(input.selector, 'selector'))
      case 'page.type':
        return typeCdpSelector(
          session,
          requiredString(input.selector, 'selector'),
          input.text ?? '',
          input.submit ?? false,
        )
      case 'files.upload':
        return uploadCdpFile(
          session,
          requiredString(input.selector, 'selector'),
          requiredString(input.filePath, 'filePath'),
        )
      case 'downloads.save':
        return configureCdpDownload(session, input)
      case 'page.read_console':
        return readCdpConsole(session)
      case 'page.read_network':
        return readCdpNetwork(session)
      case 'storage.read_cookies':
        return session.send('Network.getCookies', {
          urls: input.action.url ? [input.action.url] : undefined,
        })
      case 'cdp.call':
        if (!input.cdp?.method) throw new Error('cdp.method_required')
        return session.send(input.cdp.method, input.cdp.params ?? {})
      default:
        throw new BrowserControlExecutionError(
          501,
          `chrome_devtools_unsupported:${input.action.capability}`,
        )
    }
  } finally {
    session.close()
  }
}

async function executeTmwdBridge(
  input: BrowserControlExecuteRequest,
): Promise<unknown> {
  if (!input.tmwd?.endpoint && !process.env.CLAUDE_YH_TMWD_ENDPOINT) {
    return executeLocalTmwdBridge(input)
  }

  const endpoint =
    input.tmwd?.endpoint ??
    process.env.CLAUDE_YH_TMWD_ENDPOINT ??
    DEFAULT_TMWD_ENDPOINT
  const timeoutMs = input.tmwd?.timeoutMs ?? 15_000

  if (input.action.capability === 'tabs.read') {
    const response = await postTmwd(endpoint, { cmd: 'get_all_sessions' }, timeoutMs)
    return { sessions: response.r ?? response.data ?? [] }
  }

  const sessionId = await resolveTmwdSessionId(endpoint, input, timeoutMs)
  switch (input.action.capability) {
    case 'page.navigate':
      return executeTmwdJs(endpoint, sessionId, jsNavigate(input.action.url), timeoutMs)
    case 'page.read_dom':
      if (input.action.url) {
        await executeTmwdJs(endpoint, sessionId, jsNavigate(input.action.url), timeoutMs)
        await sleep(700)
      }
      return executeTmwdJs(endpoint, sessionId, jsReadDom(input.maxContentLength), timeoutMs)
    case 'page.click':
      return executeTmwdJs(
        endpoint,
        sessionId,
        jsClickSelector(requiredString(input.selector, 'selector')),
        timeoutMs,
      )
    case 'page.type':
      return executeTmwdJs(
        endpoint,
        sessionId,
        jsTypeSelector(
          requiredString(input.selector, 'selector'),
          input.text ?? '',
          input.submit ?? false,
        ),
        timeoutMs,
      )
    case 'files.upload':
      return uploadTmwdFile(endpoint, sessionId, input, timeoutMs)
    case 'downloads.save':
      return configureTmwdDownload(endpoint, sessionId, input, timeoutMs)
    case 'page.read_console':
      return executeTmwdJs(endpoint, sessionId, jsConsoleBuffer(), timeoutMs)
    case 'page.read_network':
      return executeTmwdJs(endpoint, sessionId, jsNetworkEntries(), timeoutMs)
    default:
      throw new BrowserControlExecutionError(
        501,
        `tmwd_operation_unsupported:${input.action.capability}`,
      )
  }
}

async function executeLocalTmwdBridge(
  input: BrowserControlExecuteRequest,
): Promise<unknown> {
  const bridge = getLocalTmwdBridge()
  const state = await bridge.ensureStarted()
  if (state.status !== 'running') {
    if (isBridgePortInUse(state.error)) {
      const ownerResult = await executeViaBrowserControlOwner(input)
      if (ownerResult?.ok) {
        return {
          ...(ownerResult.data && typeof ownerResult.data === 'object'
            ? ownerResult.data as Record<string, unknown>
            : { data: ownerResult.data }),
          proxiedToBridgeOwner: true,
        }
      }
      if (ownerResult && !ownerResult.ok) {
        const failure = ownerResult as Extract<BrowserControlExecution, { ok: false }>
        throw new BrowserControlExecutionError(
          failure.statusCode ?? 503,
          `tmwd_owner_bridge_error:${failure.error ?? 'unknown'}`,
        )
      }
    }
    throw new BrowserControlExecutionError(
      503,
      `tmwd_local_bridge_unavailable:${state.error ?? 'unknown'}`,
    )
  }

  if (input.action.capability === 'tabs.read') {
    return {
      bridge: 'local-websocket',
      port: state.port,
      connected: bridge.hasClients(),
      tabs: bridge.listTabs(),
    }
  }

  if (!bridge.hasClients()) {
    await bridge.waitForClient()
  }

  if (!bridge.hasClients()) {
    throw new BrowserControlExecutionError(
      503,
      'tmwd_extension_not_connected: reload the TMWD CDP Bridge extension after starting claude-yh',
    )
  }

  const requestedTabId = numericTabId(input.tabId)
  const selectedTab = bridge.findTab(input.action.url, requestedTabId)
  if (!selectedTab) {
    throw new BrowserControlExecutionError(404, 'tmwd_tab_not_found')
  }

  const timeoutMs = input.tmwd?.timeoutMs ?? 15_000
  switch (input.action.capability) {
    case 'page.navigate':
      return bridge.execute({
        tabId: selectedTab.id,
        code: jsNavigate(input.action.url),
        timeoutMs,
      })
    case 'page.read_dom': {
      if (input.action.url && safeHost(input.action.url) !== safeHost(selectedTab.url)) {
        await bridge.execute({
          tabId: selectedTab.id,
          code: jsNavigate(input.action.url),
          timeoutMs,
        })
        await sleep(800)
      }
      return bridge.execute({
        tabId: selectedTab.id,
        code: jsReadDom(input.maxContentLength),
        timeoutMs,
      })
    }
    case 'page.click':
      return clickLocalTmwdCdpSelector(
        bridge,
        selectedTab.id,
        requiredString(input.selector, 'selector'),
        timeoutMs,
      )
    case 'page.type':
      return typeLocalTmwdCdpSelector(
        bridge,
        selectedTab.id,
        requiredString(input.selector, 'selector'),
        input.text ?? '',
        input.submit ?? false,
        timeoutMs,
      )
    case 'files.upload':
      return uploadLocalTmwdFile(
        bridge,
        selectedTab.id,
        requiredString(input.selector, 'selector'),
        requiredString(input.filePath, 'filePath'),
        timeoutMs,
      )
    case 'downloads.save':
      return configureLocalTmwdDownload(bridge, selectedTab.id, input, timeoutMs)
    case 'page.screenshot':
      return bridge.execute({
        tabId: selectedTab.id,
        code: {
          cmd: 'cdp',
          method: 'Page.captureScreenshot',
          params: {
            format: input.screenshotFormat ?? 'png',
            captureBeyondViewport: input.fullPage ?? true,
          },
        },
        timeoutMs,
      })
    case 'page.read_console':
      return bridge.execute({
        tabId: selectedTab.id,
        code: jsConsoleBuffer(),
        timeoutMs,
      })
    case 'page.read_network':
      return bridge.execute({
        tabId: selectedTab.id,
        code: jsNetworkEntries(),
        timeoutMs,
      })
    case 'storage.read_cookies':
      return bridge.execute({
        tabId: selectedTab.id,
        code: {
          cmd: 'cookies',
          url: input.action.url ?? selectedTab.url,
          tabId: selectedTab.id,
        },
        timeoutMs,
      })
    case 'cdp.call':
      if (!input.cdp?.method) throw new Error('cdp.method_required')
      return bridge.execute({
        tabId: selectedTab.id,
        code: {
          cmd: 'cdp',
          tabId: selectedTab.id,
          method: input.cdp.method,
          params: input.cdp.params ?? {},
        },
        timeoutMs,
      })
    default:
      throw new BrowserControlExecutionError(
        501,
        `tmwd_local_operation_unsupported:${input.action.capability}`,
      )
  }
}

async function clickLocalTmwdCdpSelector(
  bridge: ReturnType<typeof getLocalTmwdBridge>,
  tabId: number,
  selector: string,
  timeoutMs: number,
): Promise<unknown> {
  const point = await getLocalTmwdElementCenter(bridge, tabId, selector, timeoutMs)
  await localTmwdCdp(bridge, tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'left',
  }, timeoutMs)
  await sleep(60)
  await localTmwdCdp(bridge, tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  }, timeoutMs)
  await sleep(60)
  await localTmwdCdp(bridge, tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  }, timeoutMs)
  return { clicked: true, selector, mode: 'cdp', x: point.x, y: point.y }
}

async function typeLocalTmwdCdpSelector(
  bridge: ReturnType<typeof getLocalTmwdBridge>,
  tabId: number,
  selector: string,
  text: string,
  submit: boolean,
  timeoutMs: number,
): Promise<unknown> {
  await clickLocalTmwdCdpSelector(bridge, tabId, selector, timeoutMs)
  if (text) {
    await localTmwdCdp(bridge, tabId, 'Input.insertText', { text }, timeoutMs)
    await localTmwdCdp(bridge, tabId, 'Runtime.evaluate', {
      expression: `(() => {
        const el = document.activeElement
        if (!el) return { active: false }
        try {
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(text)} }))
        } catch {
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return {
          active: true,
          tagName: el.tagName,
          value: 'value' in el ? String(el.value) : el.textContent
        }
      })()`,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs)
  }
  if (submit) {
    await localTmwdCdp(bridge, tabId, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, timeoutMs)
    await sleep(40)
    await localTmwdCdp(bridge, tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, timeoutMs)
  }
  return { typed: true, selector, length: text.length, submitted: submit, mode: 'cdp' }
}

async function getLocalTmwdElementCenter(
  bridge: ReturnType<typeof getLocalTmwdBridge>,
  tabId: number,
  selector: string,
  timeoutMs: number,
): Promise<{ x: number; y: number }> {
  await localTmwdCdp(bridge, tabId, 'Page.bringToFront', {}, timeoutMs)
  const response = await localTmwdCdp(bridge, tabId, 'Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      el.scrollIntoView({ block: 'center', inline: 'center' })
      const r = el.getBoundingClientRect()
      if (!r || r.width <= 0 || r.height <= 0) return { found: true, clickable: false }
      return {
        found: true,
        clickable: true,
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        width: r.width,
        height: r.height
      }
    })()`,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs)
  const result = asRecord(asRecord(response).result)
  const value = result.value
  if (!isRecord(value)) throw new Error(`selector_not_found:${selector}`)
  if (value.clickable === false) throw new Error(`selector_not_clickable:${selector}`)
  const x = Number(value.x)
  const y = Number(value.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`selector_not_clickable:${selector}`)
  }
  return { x, y }
}

async function localTmwdCdp(
  bridge: ReturnType<typeof getLocalTmwdBridge>,
  tabId: number,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  return bridge.execute({
    tabId,
    code: {
      cmd: 'cdp',
      tabId,
      method,
      params,
    },
    timeoutMs,
  })
}

async function uploadLocalTmwdFile(
  bridge: ReturnType<typeof getLocalTmwdBridge>,
  tabId: number,
  selector: string,
  filePath: string,
  timeoutMs: number,
): Promise<unknown> {
  const document = await bridge.execute({
    tabId,
    code: {
      cmd: 'cdp',
      tabId,
      method: 'DOM.getDocument',
      params: { depth: 1 },
    },
    timeoutMs,
  })
  const rootNodeId = Number(asRecord(asRecord(document).root).nodeId)
  const query = await bridge.execute({
    tabId,
    code: {
      cmd: 'cdp',
      tabId,
      method: 'DOM.querySelector',
      params: { nodeId: rootNodeId, selector },
    },
    timeoutMs,
  })
  const nodeId = Number(asRecord(query).nodeId)
  if (!Number.isFinite(nodeId) || nodeId <= 0) throw new Error('selector_not_found')
  await bridge.execute({
    tabId,
    code: {
      cmd: 'cdp',
      tabId,
      method: 'DOM.setFileInputFiles',
      params: { nodeId, files: [filePath] },
    },
    timeoutMs,
  })
  return { uploaded: true, selector, filePath }
}

async function configureLocalTmwdDownload(
  bridge: ReturnType<typeof getLocalTmwdBridge>,
  tabId: number,
  input: BrowserControlExecuteRequest,
  timeoutMs: number,
): Promise<unknown> {
  const downloadPath = input.downloadPath || path.join(getClaudeConfigHomeDir(), 'downloads')
  await fs.mkdir(downloadPath, { recursive: true })
  await bridge.execute({
    tabId,
    code: {
      cmd: 'cdp',
      tabId,
      method: 'Browser.setDownloadBehavior',
      params: { behavior: 'allow', downloadPath },
    },
    timeoutMs,
  })
  if (input.selector) {
    await bridge.execute({
      tabId,
      code: jsClickSelector(input.selector),
      timeoutMs,
    })
  }
  return { downloadBehavior: 'allow', downloadPath, clicked: Boolean(input.selector) }
}

async function executeHttpBridge(
  backend: BrowserControlBackend,
  input: BrowserControlExecuteRequest,
): Promise<unknown> {
  const envKey =
    backend.kind === 'mcp'
      ? 'CLAUDE_YH_BROWSER_MCP_BRIDGE_URL'
      : 'CLAUDE_YH_BROWSER_EXTENSION_BRIDGE_URL'
  const endpoint = process.env[envKey]
  if (!endpoint) {
    throw new BrowserControlExecutionError(503, `${envKey}_not_configured`)
  }

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw new BrowserControlExecutionError(
      response.status,
      `${backend.id}_bridge_failed:${await response.text()}`,
    )
  }
  return response.json()
}

async function resolveDevtoolsEndpoint(
  input: BrowserControlExecuteRequest,
): Promise<string> {
  const explicitEndpoint =
    input.devtools?.endpoint ?? process.env.CLAUDE_YH_BROWSER_CDP_ENDPOINT
  if (explicitEndpoint) {
    return waitForDevtoolsEndpoint(trimTrailingSlash(explicitEndpoint), input.devtools?.timeoutMs)
  }

  const envPort = Number(process.env.CLAUDE_YH_BROWSER_CDP_PORT || 0)
  const port = input.devtools?.port ?? (Number.isFinite(envPort) && envPort > 0 ? envPort : undefined)
  if (port) {
    const endpoint = `http://127.0.0.1:${port}`
    if (input.devtools?.launch) await launchChromeForCdp(port, input)
    return waitForDevtoolsEndpoint(endpoint, input.devtools?.timeoutMs)
  }

  if (input.devtools?.launch) {
    const launchPort = 9223
    await launchChromeForCdp(launchPort, input)
    return waitForDevtoolsEndpoint(`http://127.0.0.1:${launchPort}`, input.devtools.timeoutMs)
  }

  throw new BrowserControlExecutionError(503, 'chrome_devtools_endpoint_required')
}

async function waitForDevtoolsEndpoint(
  endpoint: string,
  timeoutMs = 5_000,
): Promise<string> {
  const started = Date.now()
  let lastError = ''
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetchWithTimeout(`${endpoint}/json/version`, {}, 1_000)
      if (response.ok) return endpoint
      lastError = `${response.status} ${response.statusText}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await sleep(150)
  }
  throw new BrowserControlExecutionError(
    503,
    `chrome_devtools_unavailable:${lastError}`,
  )
}

async function launchChromeForCdp(
  port: number,
  input: BrowserControlExecuteRequest,
): Promise<void> {
  const chromePath =
    input.devtools?.chromePath ??
    process.env.CLAUDE_YH_CHROME_PATH ??
    (await findChromePath())
  if (!chromePath) {
    throw new BrowserControlExecutionError(503, 'chrome_executable_not_found')
  }
  const userDataDir =
    input.devtools?.userDataDir ??
    path.join(getClaudeConfigHomeDir(), 'browser-control', 'chrome-profile')
  await fs.mkdir(userDataDir, { recursive: true })
  const child = spawn(
    chromePath,
    [
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  )
  child.unref()
}

async function findChromePath(): Promise<string | null> {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          path.join(
            process.env.LOCALAPPDATA ?? '',
            'Google\\Chrome\\Application\\chrome.exe',
          ),
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/microsoft-edge',
          ]
  for (const candidate of candidates.filter(Boolean)) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // try next candidate
    }
  }
  return null
}

async function listCdpPages(endpoint: string): Promise<CdpTarget[]> {
  const response = await fetchWithTimeout(`${endpoint}/json`)
  if (!response.ok) {
    throw new BrowserControlExecutionError(
      response.status,
      `chrome_devtools_list_failed:${response.statusText}`,
    )
  }
  const targets = (await response.json()) as CdpTarget[]
  return targets.filter(target => target.type === 'page' && target.webSocketDebuggerUrl)
}

async function resolveCdpTarget(
  endpoint: string,
  input: BrowserControlExecuteRequest,
): Promise<CdpTarget> {
  const pages = await listCdpPages(endpoint)
  if (input.tabId) {
    const found = pages.find(page => page.id === input.tabId)
    if (!found) throw new BrowserControlExecutionError(404, 'tab_not_found')
    await activateCdpTarget(endpoint, found.id)
    return found
  }
  if (input.action.url) {
    const matching = pages.find(page => page.url === input.action.url)
    if (matching) {
      await activateCdpTarget(endpoint, matching.id)
      return matching
    }
    const first = pages[0]
    if (first) {
      await activateCdpTarget(endpoint, first.id)
      return first
    }
    return createCdpTarget(endpoint, 'about:blank')
  }
  const first = pages[0]
  if (!first) return createCdpTarget(endpoint, 'about:blank')
  await activateCdpTarget(endpoint, first.id)
  return first
}

async function createCdpTarget(endpoint: string, url: string): Promise<CdpTarget> {
  const encoded = encodeURIComponent(url)
  let response = await fetchWithTimeout(`${endpoint}/json/new?${encoded}`, {
    method: 'PUT',
  })
  if (!response.ok) {
    response = await fetchWithTimeout(`${endpoint}/json/new?${encoded}`)
  }
  if (!response.ok) {
    throw new BrowserControlExecutionError(
      response.status,
      `chrome_devtools_new_tab_failed:${response.statusText}`,
    )
  }
  return response.json() as Promise<CdpTarget>
}

async function activateCdpTarget(endpoint: string, targetId: string): Promise<void> {
  await fetchWithTimeout(`${endpoint}/json/activate/${encodeURIComponent(targetId)}`).catch(
    () => undefined,
  )
}

async function readCdpPageSummary(session: CdpSession): Promise<unknown> {
  return evaluateCdp(session, `(() => ({
    title: document.title,
    url: location.href,
    readyState: document.readyState
  }))()`)
}

async function readCdpDom(
  session: CdpSession,
  maxContentLength = 80_000,
): Promise<unknown> {
  return evaluateCdp(session, `(() => {
    const html = document.documentElement ? document.documentElement.outerHTML : ''
    const text = document.body ? document.body.innerText : ''
    return {
      title: document.title,
      url: location.href,
      text: text.slice(0, ${Math.max(1, maxContentLength)}),
      html: html.slice(0, ${Math.max(1, maxContentLength)})
    }
  })()`)
}

async function clickCdpSelector(
  session: CdpSession,
  selector: string,
): Promise<unknown> {
  const rect = await evaluateCdp(session, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    el.scrollIntoView({ block: 'center', inline: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (!isRecord(rect)) throw new Error('selector_not_found')
  const x = Number(rect.x)
  const y = Number(rect.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('selector_not_clickable')
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'left',
  })
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  })
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
  })
  return { clicked: true, selector }
}

async function typeCdpSelector(
  session: CdpSession,
  selector: string,
  text: string,
  submit: boolean,
): Promise<unknown> {
  const focused = await evaluateCdp(session, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return false
    el.focus()
    return document.activeElement === el
  })()`)
  if (focused !== true) throw new Error('selector_not_focusable')
  if (text) await session.send('Input.insertText', { text })
  if (submit) {
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    })
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    })
  }
  return { typed: true, selector, length: text.length, submitted: submit }
}

async function uploadCdpFile(
  session: CdpSession,
  selector: string,
  filePath: string,
): Promise<unknown> {
  const root = await session.send('DOM.getDocument', { depth: 1 })
  const rootNodeId = Number(asRecord(root.root).nodeId)
  if (!Number.isFinite(rootNodeId)) throw new Error('dom_root_not_found')
  const query = await session.send('DOM.querySelector', {
    nodeId: rootNodeId,
    selector,
  })
  const nodeId = Number(query.nodeId)
  if (!Number.isFinite(nodeId) || nodeId <= 0) throw new Error('selector_not_found')
  await session.send('DOM.setFileInputFiles', {
    nodeId,
    files: [filePath],
  })
  return { uploaded: true, selector, filePath }
}

async function configureCdpDownload(
  session: CdpSession,
  input: BrowserControlExecuteRequest,
): Promise<unknown> {
  const downloadPath = input.downloadPath || path.join(getClaudeConfigHomeDir(), 'downloads')
  await fs.mkdir(downloadPath, { recursive: true })
  await session.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath,
  }).catch(() => session.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath,
  }))
  if (input.selector) {
    await clickCdpSelector(session, input.selector)
  }
  return { downloadBehavior: 'allow', downloadPath, clicked: Boolean(input.selector) }
}

async function readCdpConsole(session: CdpSession): Promise<unknown> {
  return evaluateCdp(session, jsConsoleBuffer())
}

async function readCdpNetwork(session: CdpSession): Promise<unknown> {
  return evaluateCdp(session, jsNetworkEntries())
}

async function evaluateCdp(session: CdpSession, expression: string): Promise<unknown> {
  const response = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  const record = asRecord(response)
  if (record.exceptionDetails) throw new Error('runtime_evaluate_exception')
  const result = asRecord(record.result)
  if (result.subtype === 'error') {
    throw new Error(String(result.description ?? 'runtime_evaluate_error'))
  }
  return result.value
}

class CdpSession {
  private nextId = 1
  private readonly pending = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', raw => this.handleMessage(raw.toString()))
    ws.on('close', () => this.rejectAll(new Error('cdp_connection_closed')))
    ws.on('error', error => this.rejectAll(error))
  }

  static async connect(wsUrl: string): Promise<CdpSession> {
    if (!wsUrl) throw new BrowserControlExecutionError(503, 'missing_cdp_websocket_url')
    const ws = new WebSocket(wsUrl)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new BrowserControlExecutionError(503, 'cdp_connect_timeout')),
        5_000,
      )
      ws.once('open', () => {
        clearTimeout(timer)
        resolve()
      })
      ws.once('error', error => {
        clearTimeout(timer)
        reject(error)
      })
    })
    return new CdpSession(ws)
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 10_000,
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new BrowserControlExecutionError(504, `cdp_timeout:${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ id, method, params }), error => {
        if (!error) return
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  close(): void {
    this.ws.close()
  }

  private handleMessage(raw: string): void {
    let message: CdpMessage
    try {
      message = JSON.parse(raw) as CdpMessage
    } catch {
      return
    }
    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (message.error) {
      pending.reject(new Error(message.error.message ?? 'cdp_error'))
      return
    }
    pending.resolve(asRecord(message.result))
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pending.delete(id)
    }
  }
}

async function resolveTmwdSessionId(
  endpoint: string,
  input: BrowserControlExecuteRequest,
  timeoutMs: number,
): Promise<string> {
  if (input.tmwd?.sessionId) return input.tmwd.sessionId
  if (input.tabId) return input.tabId
  const command = input.action.url
    ? { cmd: 'find_session', url_pattern: input.action.url }
    : { cmd: 'get_all_sessions' }
  const response = await postTmwd(endpoint, command, timeoutMs)
  const data = response.r ?? response.data
  if (Array.isArray(data) && data[0] && isRecord(data[0]) && typeof data[0].id === 'string') {
    return data[0].id
  }
  if (isRecord(data) && typeof data.id === 'string') return data.id
  throw new BrowserControlExecutionError(404, 'tmwd_session_not_found')
}

async function executeTmwdJs(
  endpoint: string,
  sessionId: string,
  code: string,
  timeoutMs: number,
): Promise<unknown> {
  const response = await postTmwd(
    endpoint,
    {
      cmd: 'execute_js',
      sessionId,
      code,
      timeout: Math.ceil(timeoutMs / 1000),
    },
    timeoutMs,
  )
  const result = response.r ?? response.data
  if (isRecord(result) && result.error) throw new Error(String(result.error))
  return result
}

async function uploadTmwdFile(
  endpoint: string,
  sessionId: string,
  input: BrowserControlExecuteRequest,
  timeoutMs: number,
): Promise<unknown> {
  const selector = requiredString(input.selector, 'selector')
  const filePath = requiredString(input.filePath, 'filePath')
  const document = await postTmwd(endpoint, {
    cmd: 'cdp',
    sessionId,
    method: 'DOM.getDocument',
    params: { depth: 1 },
  }, timeoutMs)
  const rootNodeId = Number(asRecord(asRecord(document.r ?? document.data).root).nodeId)
  const query = await postTmwd(endpoint, {
    cmd: 'cdp',
    sessionId,
    method: 'DOM.querySelector',
    params: { nodeId: rootNodeId, selector },
  }, timeoutMs)
  const nodeId = Number(asRecord(query.r ?? query.data).nodeId)
  if (!Number.isFinite(nodeId) || nodeId <= 0) throw new Error('selector_not_found')
  await postTmwd(endpoint, {
    cmd: 'cdp',
    sessionId,
    method: 'DOM.setFileInputFiles',
    params: { nodeId, files: [filePath] },
  }, timeoutMs)
  return { uploaded: true, selector, filePath }
}

async function configureTmwdDownload(
  endpoint: string,
  sessionId: string,
  input: BrowserControlExecuteRequest,
  timeoutMs: number,
): Promise<unknown> {
  const downloadPath = input.downloadPath || path.join(getClaudeConfigHomeDir(), 'downloads')
  await fs.mkdir(downloadPath, { recursive: true })
  await postTmwd(endpoint, {
    cmd: 'cdp',
    sessionId,
    method: 'Browser.setDownloadBehavior',
    params: { behavior: 'allow', downloadPath },
  }, timeoutMs)
  if (input.selector) {
    await executeTmwdJs(endpoint, sessionId, jsClickSelector(input.selector), timeoutMs)
  }
  return { downloadBehavior: 'allow', downloadPath, clicked: Boolean(input.selector) }
}

async function postTmwd(
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<TmwdResponse> {
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, timeoutMs)
  if (!response.ok) {
    throw new BrowserControlExecutionError(
      response.status,
      `tmwd_bridge_failed:${response.statusText}`,
    )
  }
  return response.json() as Promise<TmwdResponse>
}

function jsNavigate(url: string | undefined): string {
  if (!url) throw new Error('url_required')
  return `(() => {
    location.href = ${JSON.stringify(url)}
    return { navigating: true, url: location.href }
  })()`
}

function jsReadDom(maxContentLength = 80_000): string {
  const max = Math.max(1, maxContentLength)
  return `(() => {
    const html = document.documentElement ? document.documentElement.outerHTML : ''
    const text = document.body ? document.body.innerText : ''
    return {
      title: document.title,
      url: location.href,
      text: text.slice(0, ${max}),
      html: html.slice(0, ${max})
    }
  })()`
}

function jsClickSelector(selector: string): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return { clicked: false, error: 'selector_not_found' }
    el.scrollIntoView({ block: 'center', inline: 'center' })
    const rect = el.getBoundingClientRect()
    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
      buttons: 1,
    }
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const Ctor = type.startsWith('pointer') && typeof PointerEvent !== 'undefined'
        ? PointerEvent
        : MouseEvent
      el.dispatchEvent(new Ctor(type, eventInit))
    }
    return { clicked: true, selector: ${JSON.stringify(selector)} }
  })()`
}

function jsTypeSelector(selector: string, text: string, submit: boolean): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return { typed: false, error: 'selector_not_found' }
    el.focus()
    if ('value' in el) {
      const value = String(el.value || '') + ${JSON.stringify(text)}
      const proto = Object.getPrototypeOf(el)
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(el, value)
      } else {
        el.value = value
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(text)} }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    } else {
      el.textContent = (el.textContent || '') + ${JSON.stringify(text)}
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(text)} }))
    }
    if (${submit ? 'true' : 'false'}) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
      el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
      const form = el.form || el.closest?.('form')
      if (form) form.requestSubmit?.()
    }
    return { typed: true, selector: ${JSON.stringify(selector)}, length: ${text.length} }
  })()`
}

function jsConsoleBuffer(): string {
  return `(() => {
    window.__claudeYhConsoleLogs = window.__claudeYhConsoleLogs || []
    if (!window.__claudeYhConsolePatched) {
      const original = { log: console.log, warn: console.warn, error: console.error, info: console.info }
      for (const level of Object.keys(original)) {
        console[level] = (...args) => {
          window.__claudeYhConsoleLogs.push({
            level,
            time: new Date().toISOString(),
            args: args.map(value => {
              try { return typeof value === 'string' ? value : JSON.stringify(value) }
              catch { return String(value) }
            })
          })
          original[level].apply(console, args)
        }
      }
      window.__claudeYhConsolePatched = true
    }
    return window.__claudeYhConsoleLogs.slice(-100)
  })()`
}

function jsNetworkEntries(): string {
  return `(() => performance.getEntriesByType('resource').slice(-100).map(item => ({
    name: item.name,
    initiatorType: item.initiatorType,
    duration: item.duration,
    transferSize: item.transferSize
  })))()`
}

async function finalizeExecution(params: {
  backend: BrowserControlBackend
  input: BrowserControlExecuteRequest
  decision: BrowserControlDecision
  ok: true
  data: unknown
}): Promise<BrowserControlExecution>
async function finalizeExecution(params: {
  backend: BrowserControlBackend
  input: BrowserControlExecuteRequest
  decision: BrowserControlDecision
  ok: false
  error: string
  statusCode?: number
}): Promise<BrowserControlExecution>
async function finalizeExecution(params: {
  backend: BrowserControlBackend
  input: BrowserControlExecuteRequest
  decision: BrowserControlDecision
  ok: boolean
  data?: unknown
  error?: string
  statusCode?: number
}): Promise<BrowserControlExecution> {
  const auditId = await appendBrowserControlAuditEvent({
    backendId: params.backend.id,
    action: params.input.action,
    decision: params.decision,
    ok: params.ok,
    error: params.error,
    dataSummary: summarizeExecutionData(params.data),
  })
  logDiagnosticEvent({
    scope: 'browserControl.execute',
    event: 'finalize',
    ok: params.ok,
    severity: params.ok ? 'info' : 'warn',
    data: {
      backendId: params.backend.id,
      capability: params.input.action.capability,
      decision: params.decision.decision,
      reason: params.decision.reason,
      auditId,
      error: params.error,
      dataSummary: summarizeExecutionData(params.data),
    },
  })
  if (params.ok) {
    await recordRecoverySnapshot(params.backend.id, params.input, params.data)
    return {
      ok: true,
      backendId: params.backend.id,
      decision: params.decision,
      auditId,
      data: params.data,
    }
  }
  return {
    ok: false,
    backendId: params.backend.id,
    decision: params.decision,
    auditId,
    error: params.error ?? 'browser_control_failed',
    statusCode: params.statusCode,
    recovery: buildBrowserControlRecovery(params.input, params.error),
  }
}

function buildBrowserControlRecovery(
  input: BrowserControlExecuteRequest,
  error?: string,
): { summary: string; nextActions: string[] } {
  const actions = [
    'Run tabs.read and keep operating on an explicit tabId/session id.',
    'Run page.read_dom on the selected tab and choose a stable CSS selector from the returned DOM.',
    'If DOM is incomplete or the element is visually present, run page.screenshot and retry with a better selector or raw CDP box-model lookup.',
  ]
  if (
    input.action.capability === 'page.click' ||
    input.action.capability === 'page.type'
  ) {
    actions.push('For interactive controls, prefer BrowserControl page.click/page.type over injected JavaScript because JS click events may be untrusted.')
  }
  if (input.action.capability === 'files.upload') {
    actions.push('For file inputs, retry files.upload with the actual input[type=file] selector; the TMWD backend uses DOM.setFileInputFiles.')
  }
  if (/frame|iframe|shadow|node|selector/i.test(error ?? '')) {
    actions.push('For iframe or shadow DOM pages, use cdp.call DOM.getDocument with pierce=true, DOM.getBoxModel, or Runtime.evaluate inside the target frame.')
  }
  if (/timeout|connect|bridge|18765|websocket/i.test(error ?? '')) {
    actions.push('Check Settings -> Browser connection state, then reload the TMWD extension or restart the local claude-yh app/server owning ws://127.0.0.1:18765.')
  }
  return {
    summary: 'BrowserControl failed; recover by re-identifying the active tab and page evidence before retrying the action.',
    nextActions: actions,
  }
}

async function recordRecoverySnapshot(
  backendId: string,
  input: BrowserControlExecuteRequest,
  data: unknown,
): Promise<void> {
  try {
    const record = isRecord(data) ? data : {}
    const tabs = Array.isArray(record.tabs)
      ? record.tabs as Array<{ id?: unknown; url?: unknown; title?: unknown; active?: unknown }>
      : Array.isArray(record.sessions)
        ? record.sessions as Array<{ id?: unknown; url?: unknown; title?: unknown; active?: unknown }>
        : undefined
    await recordBrowserTabRecoverySnapshot({
      backendId,
      tabs,
      tabId: input.tabId,
      url: input.action.url,
    })
  } catch {
    // Recovery snapshots are best-effort and must not fail browser execution.
  }
}

async function blockedExecution(
  backendId: string,
  decision: BrowserControlDecision,
  error: string,
  statusCode: number,
): Promise<BrowserControlExecution> {
  const auditId = await appendBrowserControlAuditEvent({
    backendId,
    action: { capability: 'tabs.read' },
    decision,
    ok: false,
    error,
  })
  logDiagnosticEvent({
    scope: 'browserControl.execute',
    event: 'blocked',
    ok: false,
    severity: 'warn',
    data: {
      backendId,
      decision: decision.decision,
      reason: decision.reason,
      error,
      statusCode,
      auditId,
    },
  })
  return {
    ok: false,
    backendId,
    decision,
    auditId,
    error,
    statusCode,
    recovery: {
      summary: 'BrowserControl was blocked before execution.',
      nextActions: [
        'Check the policy decision reason.',
        'If the page shows captcha, login, payment, or another human-only step, pause and ask the user.',
      ],
    },
  }
}

function summarizeExecutionData(data: unknown): Record<string, unknown> | undefined {
  if (!data) return undefined
  if (isRecord(data)) {
    if (typeof data.data === 'string') {
      return { keys: Object.keys(data), dataLength: data.data.length }
    }
    if (Array.isArray(data.tabs)) return { tabs: data.tabs.length }
    if (Array.isArray(data.sessions)) return { sessions: data.sessions.length }
    return { keys: Object.keys(data).slice(0, 12) }
  }
  return { type: typeof data }
}

function getExecutionStatus(error: unknown): number {
  if (error instanceof BrowserControlExecutionError) return error.statusCode
  return 500
}

class BrowserControlExecutionError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'BrowserControlExecutionError'
  }
}

function deny(reason: string): BrowserControlDecision {
  return { decision: 'deny', reason }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field}_required`)
  }
  return value
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 5_000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '')
}

function numericTabId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function safeHost(url?: string): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

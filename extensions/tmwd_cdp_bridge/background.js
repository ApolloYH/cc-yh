const WS_URL = 'ws://127.0.0.1:18765'
let ws = null

function isScriptable(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

function scheduleProbe() {
  chrome.alarms.create('claude-yh-bridge-probe', { delayInMinutes: 0.083 })
}

function scheduleKeepalive() {
  chrome.alarms.create('claude-yh-bridge-keepalive', { delayInMinutes: 0.4 })
}

async function sendTabsUpdate(type = 'tabs_update') {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  const tabs = (await chrome.tabs.query({})).filter(tab => isScriptable(tab.url))
  ws.send(JSON.stringify({
    type,
    tabs: tabs.map(tab => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      active: tab.active,
      windowId: tab.windowId,
    })),
  }))
}

async function isServerAlive() {
  try {
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 2000)
    await fetch('http://127.0.0.1:18765', { signal: ctrl.signal })
    return true
  } catch {
    return false
  }
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'claude-yh-bridge-keepalive') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'ping' }))
      } catch {}
      scheduleKeepalive()
    } else {
      ws = null
      scheduleProbe()
    }
  }
  if (alarm.name === 'claude-yh-bridge-probe') {
    if (ws && ws.readyState <= WebSocket.OPEN) return
    if (await isServerAlive()) connectWS()
    else scheduleProbe()
  }
})

function connectWS() {
  if (ws && ws.readyState <= WebSocket.OPEN) return
  try {
    ws = new WebSocket(WS_URL)
  } catch {
    ws = null
    scheduleProbe()
    return
  }

  ws.onopen = async () => {
    scheduleKeepalive()
    await sendTabsUpdate('ext_ready')
  }

  ws.onmessage = async event => {
    try {
      const data = JSON.parse(event.data)
      if (!data.id || data.code === undefined) return
      await executeRequest(data)
    } catch (error) {
      console.warn('[Claude YH Bridge] message failed:', error?.message || error)
    }
  }

  ws.onclose = () => {
    ws = null
    scheduleProbe()
  }

  ws.onerror = () => {
    console.warn('[Claude YH Bridge] Local claude-yh bridge is not available yet.')
  }
}

async function executeRequest(data) {
  ws.send(JSON.stringify({ type: 'ack', id: data.id }))
  try {
    let code = data.code
    if (typeof code === 'string') {
      try {
        const parsed = JSON.parse(code)
        if (parsed && typeof parsed === 'object') code = parsed
      } catch {}
    }

    const tabId = data.tabId
    const result =
      code && typeof code === 'object' && code.cmd
        ? await handleCommand({ ...code, tabId: code.tabId ?? tabId })
        : await executePageScript(tabId, String(code))

    ws.send(JSON.stringify({
      type: result.ok ? 'result' : 'error',
      id: data.id,
      result: result.data ?? result.results ?? result,
      error: result.error,
      newTabs: result.newTabs ?? [],
    }))
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'error',
      id: data.id,
      error: error?.message || String(error),
    }))
  }
}

async function handleCommand(msg) {
  if (msg.cmd === 'tabs') {
    if (msg.method === 'switch') {
      const tab = await chrome.tabs.update(msg.tabId, { active: true })
      await chrome.windows.update(tab.windowId, { focused: true })
      return { ok: true, data: { tabId: tab.id } }
    }
    const tabs = (await chrome.tabs.query({})).filter(tab => isScriptable(tab.url))
    return {
      ok: true,
      data: tabs.map(tab => ({
        id: tab.id,
        url: tab.url,
        title: tab.title,
        active: tab.active,
        windowId: tab.windowId,
      })),
    }
  }

  if (msg.cmd === 'cookies') {
    const url = msg.url || (msg.tabId ? (await chrome.tabs.get(msg.tabId)).url : '')
    if (!url) return { ok: false, error: 'url_required' }
    const cookies = await chrome.cookies.getAll({ url })
    return { ok: true, data: cookies }
  }

  if (msg.cmd === 'cdp') {
    if (!msg.tabId) return { ok: false, error: 'tabId_required' }
    return sendCdpCommand(msg.tabId, msg.method, msg.params || {})
  }

  if (msg.cmd === 'batch') {
    const results = []
    let attachedTabId = null
    try {
      for (const command of msg.commands || []) {
        const tabId = command.tabId ?? msg.tabId
        const resolved = {
          ...command,
          tabId,
          params: resolveBatchRefs(command.params || {}, results),
        }

        if (resolved.cmd === 'cdp') {
          if (!tabId) return { ok: false, error: 'tabId_required' }
          if (attachedTabId !== tabId) {
            if (attachedTabId !== null) {
              try {
                await chrome.debugger.detach({ tabId: attachedTabId })
              } catch {}
            }
            await chrome.debugger.attach({ tabId }, '1.3')
            attachedTabId = tabId
          }
          const data = await chrome.debugger.sendCommand(
            { tabId },
            resolved.method,
            resolved.params || {},
          )
          results.push(data ?? {})
          continue
        }

        const result = await handleCommand(resolved)
        if (!result.ok) return result
        results.push(result.data ?? result.results ?? result)
      }
    } catch (error) {
      return { ok: false, error: error?.message || String(error) }
    } finally {
      if (attachedTabId !== null) {
        try {
          await chrome.debugger.detach({ tabId: attachedTabId })
        } catch {}
      }
    }
    return { ok: true, results }
  }

  if (msg.cmd === 'management' && msg.method === 'list') {
    const all = await chrome.management.getAll()
    return {
      ok: true,
      data: all.map(item => ({
        id: item.id,
        name: item.name,
        enabled: item.enabled,
        type: item.type,
        version: item.version,
      })),
    }
  }

  return { ok: false, error: `unknown_cmd:${msg.cmd}` }
}

async function sendCdpCommand(tabId, method, params) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3')
    const data = await chrome.debugger.sendCommand(
      { tabId },
      method,
      params || {},
    )
    await chrome.debugger.detach({ tabId })
    return { ok: true, data }
  } catch (error) {
    try {
      await chrome.debugger.detach({ tabId })
    } catch {}
    return { ok: false, error: error?.message || String(error) }
  }
}

function resolveBatchRefs(value, results) {
  if (typeof value === 'string') {
    const match = value.match(/^\$(\d+)\.(.+)$/)
    if (!match) return value
    return readPath(results[Number(match[1])], match[2])
  }
  if (Array.isArray(value)) {
    return value.map(item => resolveBatchRefs(item, results))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveBatchRefs(item, results)]),
    )
  }
  return value
}

function readPath(value, path) {
  let current = value
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return undefined
    current = current[part]
  }
  return current
}

async function executePageScript(tabId, code) {
  if (!tabId) return { ok: false, error: 'tabId_required' }
  const newTabIds = new Set()
  const onCreated = tab => newTabIds.add(tab.id)
  chrome.tabs.onCreated.addListener(onCreated)

  try {
    let result = await executeWithScripting(tabId, code)
    if (!result.ok && result.csp) result = await executeWithDebugger(tabId, code)
    await new Promise(resolve => setTimeout(resolve, 150))
    const newTabs = []
    for (const id of newTabIds) {
      try {
        const tab = await chrome.tabs.get(id)
        newTabs.push({ id: tab.id, url: tab.url, title: tab.title })
      } catch {}
    }
    return { ...result, newTabs }
  } finally {
    chrome.tabs.onCreated.removeListener(onCreated)
  }
}

async function executeWithScripting(tabId, code) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async source => {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
        return await new AsyncFunction(`return (${source})`)()
      },
      args: [wrapSource(code)],
    })
    return { ok: true, data: result[0]?.result }
  } catch (error) {
    const message = error?.message || String(error)
    return {
      ok: false,
      csp: /Content Security Policy|unsafe-eval|Refused/i.test(message),
      error: message,
    }
  }
}

async function executeWithDebugger(tabId, code) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3')
    const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: wrapSource(code),
      awaitPromise: true,
      returnByValue: true,
    })
    await chrome.debugger.detach({ tabId })
    if (result.exceptionDetails) {
      return {
        ok: false,
        error: result.exceptionDetails.exception?.description || 'Runtime.evaluate failed',
      }
    }
    return { ok: true, data: result.result?.value }
  } catch (error) {
    try {
      await chrome.debugger.detach({ tabId })
    } catch {}
    return { ok: false, error: error?.message || String(error) }
  }
}

function wrapSource(code) {
  return `(async () => {
    const value = await (${code})
    try { return JSON.parse(JSON.stringify(value)) } catch { return String(value) }
  })()`
}

connectWS()
chrome.runtime.onStartup.addListener(connectWS)
chrome.runtime.onInstalled.addListener(connectWS)
chrome.tabs.onUpdated.addListener((_, changeInfo) => {
  if (changeInfo.status === 'complete') sendTabsUpdate()
})
chrome.tabs.onRemoved.addListener(() => sendTabsUpdate())
chrome.tabs.onCreated.addListener(() => sendTabsUpdate())

export {}

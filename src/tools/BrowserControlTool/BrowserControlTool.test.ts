import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createServer } from 'node:net'
import { getLocalTmwdBridge } from '../../browserControl/tmwdBridgeServer.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { getTools } from '../../tools.js'
import { BrowserControlTool } from './BrowserControlTool.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalTmwdWsPort: string | undefined

describe('BrowserControlTool', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-tool-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalTmwdWsPort = process.env.CLAUDE_YH_TMWD_WS_PORT
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.CLAUDE_YH_TMWD_WS_PORT = String(await getFreePort())
  })

  afterEach(async () => {
    getLocalTmwdBridge().close()
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    if (originalTmwdWsPort === undefined) delete process.env.CLAUDE_YH_TMWD_WS_PORT
    else process.env.CLAUDE_YH_TMWD_WS_PORT = originalTmwdWsPort
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('is registered as a built-in model tool', () => {
    const tools = getTools(getEmptyToolPermissionContext())
    expect(tools.some(tool => tool.name === 'BrowserControl')).toBe(true)
  })

  it('requires explicit permission for sensitive browser capabilities', async () => {
    const permission = await BrowserControlTool.checkPermissions({
      backendId: 'tmwd-cdp-bridge',
      capability: 'storage.read_cookies',
      url: 'https://example.com',
      description: 'Read cookies for current logged-in browser tab',
    })
    expect(permission.behavior).toBe('ask')
    expect(JSON.stringify(permission)).toContain('actionUserConfirmed')
  })

  it('can discover local TMWD bridge status through tabs.read', async () => {
    const result = await BrowserControlTool.call({
      backendId: 'tmwd-cdp-bridge',
      capability: 'tabs.read',
    } as never)

    expect(result.data.ok).toBe(true)
    expect(result.data.backendId).toBe('tmwd-cdp-bridge')
    if (!result.data.ok) throw new Error('expected BrowserControl success')
    expect(JSON.stringify(result.data.data)).toContain('local-websocket')
  })
})

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

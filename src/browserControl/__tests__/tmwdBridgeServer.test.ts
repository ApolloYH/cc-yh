import { describe, it, expect } from 'bun:test'
import { createServer } from 'node:net'
import WebSocket from 'ws'
import { LocalTmwdBridge } from '../tmwdBridgeServer.js'

describe('LocalTmwdBridge', () => {
  it('speaks the GA tmwd_cdp_bridge WebSocket protocol', async () => {
    const port = await getFreePort()
    const bridge = new LocalTmwdBridge(port)
    const state = await bridge.ensureStarted()
    expect(state.status).toBe('running')

    const client = new WebSocket(`ws://127.0.0.1:${port}`)
    await waitForOpen(client)
    client.send(JSON.stringify({
      type: 'ext_ready',
      tabs: [
        {
          id: 101,
          url: 'https://example.com',
          title: 'Example',
          active: true,
          windowId: 1,
        },
      ],
    }))
    expect(await bridge.waitForClient(1_000)).toBe(true)
    await waitFor(() => bridge.listTabs().length === 1)
    expect(bridge.listTabs()).toHaveLength(1)

    client.on('message', raw => {
      const request = JSON.parse(raw.toString()) as {
        id: string
        tabId: number
        code: string
      }
      expect(request.tabId).toBe(101)
      expect(request.code).toBe('document.title')
      client.send(JSON.stringify({ type: 'ack', id: request.id }))
      client.send(JSON.stringify({
        type: 'result',
        id: request.id,
        result: { title: 'Example Domain' },
      }))
    })

    const result = await bridge.execute({
      tabId: 101,
      code: 'document.title',
      timeoutMs: 1_000,
    })
    expect(result).toEqual({ title: 'Example Domain' })

    client.close()
    bridge.close()
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

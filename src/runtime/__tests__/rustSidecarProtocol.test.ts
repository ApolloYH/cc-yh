import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  createRustSidecarRequest,
  encodeRustSidecarRequest,
  getRustSidecarLaunchConfig,
  parseRustSidecarResponse,
  RUST_SIDECAR_PROTOCOL_VERSION,
} from '../rustSidecarProtocol.js'

describe('rust sidecar protocol', () => {
  it('creates newline-delimited requests', () => {
    const request = createRustSidecarRequest('1', 'runtime.echo', {
      value: 42,
    })

    expect(request.protocolVersion).toBe(RUST_SIDECAR_PROTOCOL_VERSION)
    expect(encodeRustSidecarRequest(request)).toBe(
      '{"protocolVersion":1,"id":"1","method":"runtime.echo","params":{"value":42}}\n',
    )
  })

  it('parses success and failure responses', () => {
    const success = parseRustSidecarResponse(
      '{"protocolVersion":1,"id":"1","ok":true,"result":{"ready":true}}',
    )
    const failure = parseRustSidecarResponse(
      '{"protocolVersion":1,"id":"2","ok":false,"error":{"code":"method_not_found","message":"missing"}}',
    )

    expect(success.ok).toBe(true)
    if (success.ok === true) {
      expect(success.result).toEqual({ ready: true })
    }
    expect(failure.ok).toBe(false)
    if (failure.ok === false) {
      expect(failure.error.code).toBe('method_not_found')
    }
  })

  it('rejects malformed responses', () => {
    expect(() => parseRustSidecarResponse('not-json')).toThrow()
    expect(() =>
      parseRustSidecarResponse(
        '{"protocolVersion":999,"id":"1","ok":true,"result":{}}',
      ),
    ).toThrow()
    expect(() =>
      parseRustSidecarResponse('{"protocolVersion":1,"id":"1","ok":false}'),
    ).toThrow()
  })

  it('uses an explicit sidecar path when configured', () => {
    expect(getRustSidecarLaunchConfig({}, [])).toBeNull()
    expect(
      getRustSidecarLaunchConfig({
        CLAUDE_YH_RUST_SIDECAR_PATH: 'C:\\tools\\claude-yh-runtime.exe',
      }, []),
    ).toEqual({
      command: 'C:\\tools\\claude-yh-runtime.exe',
      args: [],
    })
  })

  it('can discover a bundled sidecar when no env path is set', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-sidecar-'))
    const sidecarName =
      process.platform === 'win32'
        ? 'claude-yh-runtime-sidecar.exe'
        : 'claude-yh-runtime-sidecar'
    const sidecarPath = path.join(
      root,
      'native',
      `${process.platform}-${process.arch}`,
      sidecarName,
    )
    await fs.mkdir(path.dirname(sidecarPath), { recursive: true })
    await fs.writeFile(sidecarPath, '', 'utf-8')

    try {
      expect(getRustSidecarLaunchConfig({}, [root])).toEqual({
        command: sidecarPath,
        args: [],
      })
      expect(
        getRustSidecarLaunchConfig({
          CLAUDE_YH_DISABLE_RUST_SIDECAR: '1',
        }, [root]),
      ).toBeNull()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('walks parent directories when discovering a sidecar', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-sidecar-parent-'))
    const sidecarName =
      process.platform === 'win32'
        ? 'claude-yh-runtime-sidecar.exe'
        : 'claude-yh-runtime-sidecar'
    const sidecarPath = path.join(
      root,
      'native',
      `${process.platform}-${process.arch}`,
      sidecarName,
    )
    const nestedRoot = path.join(root, 'desktop', 'src-tauri', 'target', 'debug')
    await fs.mkdir(path.dirname(sidecarPath), { recursive: true })
    await fs.mkdir(nestedRoot, { recursive: true })
    await fs.writeFile(sidecarPath, '', 'utf-8')

    try {
      expect(getRustSidecarLaunchConfig({}, [nestedRoot])).toEqual({
        command: sidecarPath,
        args: [],
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

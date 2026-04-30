import { describe, expect, it } from 'bun:test'
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

  it('is disabled unless an explicit sidecar path is configured', () => {
    expect(getRustSidecarLaunchConfig({})).toBeNull()
    expect(
      getRustSidecarLaunchConfig({
        CLAUDE_YH_RUST_SIDECAR_PATH: 'C:\\tools\\claude-yh-runtime.exe',
      }),
    ).toEqual({
      command: 'C:\\tools\\claude-yh-runtime.exe',
      args: [],
    })
  })
})

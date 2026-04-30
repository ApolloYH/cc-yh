import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { runtimeReadFile, runtimeWriteFile } from '../fsOpsService.js'
import { runtimeClassifyShell } from '../shellSafetyService.js'

let tmpDir = ''
let originalDisableRustSidecar: string | undefined

describe('runtime fs ops and shell safety fallback', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-fs-ops-'))
    originalDisableRustSidecar = process.env.CLAUDE_YH_DISABLE_RUST_SIDECAR
    process.env.CLAUDE_YH_DISABLE_RUST_SIDECAR = '1'
  })

  afterEach(async () => {
    if (originalDisableRustSidecar === undefined) {
      delete process.env.CLAUDE_YH_DISABLE_RUST_SIDECAR
    } else {
      process.env.CLAUDE_YH_DISABLE_RUST_SIDECAR = originalDisableRustSidecar
    }
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('writes and reads files through the runtime service', async () => {
    const write = await runtimeWriteFile({
      cwd: tmpDir,
      path: 'notes/memory.txt',
      content: 'hello memory',
      overwrite: true,
    })
    expect(write.source).toBe('typescript')
    expect(write.bytes).toBe(12)

    const read = await runtimeReadFile({
      cwd: tmpDir,
      path: 'notes/memory.txt',
    })
    expect(read.source).toBe('typescript')
    expect(read.content).toBe('hello memory')
    expect(read.truncated).toBe(false)
  })

  it('classifies high-risk shell commands', async () => {
    const result = await runtimeClassifyShell({
      shell: 'powershell',
      command: 'Invoke-Expression $payload',
    })
    expect(result.source).toBe('typescript')
    expect(result.risk).toBe('high')
    expect(result.readOnly).toBe(false)
  })
})

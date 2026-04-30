import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleRuntimeApi } from '../api/runtime.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalRustSidecarPath: string | undefined
let originalDisableRustSidecar: string | undefined

describe('Runtime API', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-api-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalRustSidecarPath = process.env.CLAUDE_YH_RUST_SIDECAR_PATH
    originalDisableRustSidecar = process.env.CLAUDE_YH_DISABLE_RUST_SIDECAR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    delete process.env.CLAUDE_YH_RUST_SIDECAR_PATH
    process.env.CLAUDE_YH_DISABLE_RUST_SIDECAR = '1'
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    if (originalRustSidecarPath === undefined) {
      delete process.env.CLAUDE_YH_RUST_SIDECAR_PATH
    } else {
      process.env.CLAUDE_YH_RUST_SIDECAR_PATH = originalRustSidecarPath
    }
    if (originalDisableRustSidecar === undefined) {
      delete process.env.CLAUDE_YH_DISABLE_RUST_SIDECAR
    } else {
      process.env.CLAUDE_YH_DISABLE_RUST_SIDECAR = originalDisableRustSidecar
    }
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('returns a searchable session index through the API', async () => {
    const dir = path.join(tmpDir, 'projects', '-repo')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, 'session-1.jsonl'),
      `${JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Implement browser control' },
        timestamp: '2026-04-26T01:00:00.000Z',
      })}\n`,
      'utf-8',
    )

    const url = new URL('http://localhost/api/runtime/session-index?query=browser')
    const req = new Request(url)
    const response = await handleRuntimeApi(req, url, ['api', 'runtime', 'session-index'])
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.source).toBe('typescript')
    expect(body.total).toBe(1)
    expect(body.sessions[0].title).toBe('Implement browser control')
  })

  it('runs runtime fs glob through the API fallback', async () => {
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'ignored.ts\n', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'src', 'app.ts'), 'export {}\n', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'ignored.ts'), 'export {}\n', 'utf-8')

    const url = new URL('http://localhost/api/runtime/fs-glob')
    const req = new Request(url, {
      method: 'POST',
      body: JSON.stringify({ cwd: tmpDir, pattern: '**/*.ts' }),
    })
    const response = await handleRuntimeApi(req, url, ['api', 'runtime', 'fs-glob'])
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.source).toBe('typescript')
    expect(body.total).toBe(1)
    expect(body.files[0].replace(/\\/g, '/')).toEndWith('/src/app.ts')
  })

  it('runs runtime fs grep through the API fallback', async () => {
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'src', 'app.ts'),
      'const alpha = true\nconst needle = "one"\n',
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'src', 'readme.md'),
      'needle in markdown\n',
      'utf-8',
    )

    const url = new URL('http://localhost/api/runtime/fs-grep')
    const req = new Request(url, {
      method: 'POST',
      body: JSON.stringify({
        cwd: tmpDir,
        pattern: 'needle',
        glob: '**/*.ts',
      }),
    })
    const response = await handleRuntimeApi(req, url, ['api', 'runtime', 'fs-grep'])
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.source).toBe('typescript')
    expect(body.total).toBe(1)
    expect(body.matches[0].lineNumber).toBe(2)
    expect(body.matches[0].line).toContain('needle')
  })

  it('runs runtime fs read/write and shell classification through the API fallback', async () => {
    const writeUrl = new URL('http://localhost/api/runtime/fs-write')
    const writeReq = new Request(writeUrl, {
      method: 'POST',
      body: JSON.stringify({
        cwd: tmpDir,
        path: 'runtime/file.txt',
        content: 'runtime content',
        overwrite: true,
      }),
    })
    const writeRes = await handleRuntimeApi(writeReq, writeUrl, ['api', 'runtime', 'fs-write'])
    const writeBody = await writeRes.json()
    expect(writeRes.status).toBe(200)
    expect(writeBody.source).toBe('typescript')
    expect(writeBody.bytes).toBe(15)

    const readUrl = new URL('http://localhost/api/runtime/fs-read')
    const readReq = new Request(readUrl, {
      method: 'POST',
      body: JSON.stringify({
        cwd: tmpDir,
        path: 'runtime/file.txt',
      }),
    })
    const readRes = await handleRuntimeApi(readReq, readUrl, ['api', 'runtime', 'fs-read'])
    const readBody = await readRes.json()
    expect(readBody.content).toBe('runtime content')

    const classifyUrl = new URL('http://localhost/api/runtime/shell-classify')
    const classifyReq = new Request(classifyUrl, {
      method: 'POST',
      body: JSON.stringify({
        shell: 'bash',
        command: 'rm -rf dist',
      }),
    })
    const classifyRes = await handleRuntimeApi(classifyReq, classifyUrl, ['api', 'runtime', 'shell-classify'])
    const classifyBody = await classifyRes.json()
    expect(classifyBody.risk).toBe('high')
    expect(classifyBody.readOnly).toBe(false)
  })
})

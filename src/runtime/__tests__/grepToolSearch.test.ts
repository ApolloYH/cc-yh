import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { runWithCwdOverride } from '../../utils/cwd.js'
import { buildRuntimeGrepToolOutput } from '../grepToolSearch.js'

let tmpDir = ''
let originalDisableRustSidecar: string | undefined

async function writeFixtureFile(relativePath: string, content: string) {
  const filePath = path.join(tmpDir, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}

function toSlash(value: string): string {
  return value.replace(/\\/g, '/')
}

describe('runtime GrepTool parity output', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-grep-tool-'))
    originalDisableRustSidecar = process.env.CLAUDE_YH_DISABLE_RUST_SIDECAR
    process.env.CLAUDE_YH_DISABLE_RUST_SIDECAR = '1'
    await writeFixtureFile(
      'src/app.ts',
      ['zero', 'one needle', 'two', 'three needle', 'four'].join('\n'),
    )
    await writeFixtureFile('src/second.ts', 'needle again\n')
    await writeFixtureFile('src/readme.md', 'needle in markdown\n')
    await writeFixtureFile('src/plain.js', 'needle javascript\n')
    await writeFixtureFile('long.ts', `${'x'.repeat(600)} needle\n`)
    await writeFixtureFile('src/multi.ts', ['start alpha', 'middle beta', 'end'].join('\n'))
  })

  afterEach(async () => {
    if (originalDisableRustSidecar === undefined) {
      delete process.env.CLAUDE_YH_DISABLE_RUST_SIDECAR
    } else {
      process.env.CLAUDE_YH_DISABLE_RUST_SIDECAR = originalDisableRustSidecar
    }
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('formats files_with_matches with pagination', async () => {
    const output = await runWithCwdOverride(tmpDir, () =>
      buildRuntimeGrepToolOutput({
        cwd: tmpDir,
        pattern: 'needle',
        globPatterns: ['**/*.ts'],
        outputMode: 'files_with_matches',
        headLimit: 1,
        maxColumns: 500,
      }),
    )

    expect(output).toMatchObject({
      mode: 'files_with_matches',
      filenames: [output.filenames[0]],
      numFiles: 1,
      appliedLimit: 1,
    })
    expect(toSlash(output.filenames[0] ?? '')).toBe('src/app.ts')
  })

  it('formats count mode from matching line counts', async () => {
    const output = await runWithCwdOverride(tmpDir, () =>
      buildRuntimeGrepToolOutput({
        cwd: tmpDir,
        pattern: 'needle',
        globPatterns: ['**/*.ts'],
        outputMode: 'count',
        maxColumns: 500,
      }),
    )

    expect(output.mode).toBe('count')
    expect(output.numFiles).toBe(2)
    expect(output.numMatches).toBe(3)
    expect(output.content?.split('\n').map(toSlash)).toEqual([
      'src/app.ts:2',
      'src/second.ts:1',
    ])
  })

  it('formats content mode with line numbers and context', async () => {
    const output = await runWithCwdOverride(tmpDir, () =>
      buildRuntimeGrepToolOutput({
        cwd: tmpDir,
        pattern: 'needle',
        globPatterns: ['src/app.ts'],
        outputMode: 'content',
        beforeContext: 1,
        afterContext: 1,
        maxColumns: 500,
      }),
    )

    expect(output.mode).toBe('content')
    expect(output.content?.split('\n').map(toSlash)).toEqual([
      'src/app.ts-1-zero',
      'src/app.ts:2:one needle',
      'src/app.ts-3-two',
      'src/app.ts:4:three needle',
      'src/app.ts-5-four',
    ])
    expect(output.numLines).toBe(5)
  })

  it('supports type filtering and multiline matching through runtime', async () => {
    const typed = await runWithCwdOverride(tmpDir, () =>
      buildRuntimeGrepToolOutput({
        cwd: tmpDir,
        pattern: 'needle',
        type: 'js',
        outputMode: 'files_with_matches',
        maxColumns: 500,
      }),
    )
    expect(typed.filenames.map(toSlash)).toEqual(['src/plain.js'])

    const multiline = await runWithCwdOverride(tmpDir, () =>
      buildRuntimeGrepToolOutput({
        cwd: tmpDir,
        pattern: 'alpha.*beta',
        type: 'ts',
        outputMode: 'count',
        multiline: true,
        maxColumns: 500,
      }),
    )
    expect(multiline.numFiles).toBe(1)
    expect(multiline.numMatches).toBe(1)
    expect(multiline.content && toSlash(multiline.content)).toBe('src/multi.ts:1')
  })
})

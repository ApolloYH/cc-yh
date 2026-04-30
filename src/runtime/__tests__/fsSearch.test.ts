import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { buildRuntimeGlob, buildRuntimeGrep } from '../fsSearch.js'

let tmpDir = ''

async function writeFixtureFile(relativePath: string, content: string) {
  const filePath = path.join(tmpDir, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}

function relativeFiles(files: string[]) {
  return files.map(file => file.replace(tmpDir, '').replace(/^[/\\]/, '').replace(/\\/g, '/'))
}

describe('runtime fs search fallback', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-fs-search-'))
    await writeFixtureFile('.gitignore', 'ignored.ts\n')
    await writeFixtureFile('src/app.ts', 'const keep = true\nconst target = "one"\n')
    await writeFixtureFile('src/second.ts', 'const target = "two"\n')
    await writeFixtureFile('src/readme.md', 'target in markdown\n')
    await writeFixtureFile('ignored.ts', 'const target = "ignored"\n')
    await writeFixtureFile('.secret.ts', 'const target = "hidden"\n')
    await writeFixtureFile('node_modules/pkg/index.ts', 'const target = "dependency"\n')
    await writeFixtureFile('dist/bundle.ts', 'const target = "bundle"\n')
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('finds files with glob while respecting default exclusions and root gitignore', async () => {
    const result = await buildRuntimeGlob({
      cwd: tmpDir,
      pattern: '**/*.ts',
    })

    expect(result.source).toBe('typescript')
    expect(result.cwd).toBe(await fs.realpath(tmpDir))
    expect(relativeFiles(result.files)).toEqual([
      '.secret.ts',
      'src/app.ts',
      'src/second.ts',
    ])
    expect(result.total).toBe(3)
    expect(result.truncated).toBe(false)
  })

  it('can mirror CLI glob behavior without gitignore or default directory exclusions', async () => {
    const result = await buildRuntimeGlob({
      cwd: tmpDir,
      pattern: '**/*.ts',
      respectGitignore: false,
      excludeDefaultDirs: false,
      excludeGlobs: ['dist/**'],
    })

    expect(relativeFiles(result.files)).toEqual([
      '.secret.ts',
      'ignored.ts',
      'node_modules/pkg/index.ts',
      'src/app.ts',
      'src/second.ts',
    ])
    expect(result.total).toBe(5)
  })

  it('can exclude hidden files when requested', async () => {
    const result = await buildRuntimeGlob({
      cwd: tmpDir,
      pattern: '**/*.ts',
      hidden: false,
    })

    expect(relativeFiles(result.files)).toEqual(['src/app.ts', 'src/second.ts'])
  })

  it('greps matching lines with glob filtering and pagination', async () => {
    const result = await buildRuntimeGrep({
      cwd: tmpDir,
      pattern: 'target',
      glob: '**/*.ts',
      limit: 1,
    })

    expect(result.source).toBe('typescript')
    expect(result.total).toBe(3)
    expect(result.truncated).toBe(true)
    expect(result.matches).toHaveLength(1)
    expect(relativeFiles([result.matches[0]!.filePath])).toEqual(['.secret.ts'])
    expect(result.matches[0]!.lineNumber).toBe(1)
  })
})

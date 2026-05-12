#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const callerDir = process.env.CALLER_DIR || process.cwd()
const cliArgs = process.argv.slice(2)

function ensureRuntimeAliases() {
  const nodeModulesDir = join(rootDir, 'node_modules')
  const srcAlias = join(nodeModulesDir, 'src')

  try {
    if (!existsSync(srcAlias)) {
      mkdirSync(nodeModulesDir, { recursive: true })
      symlinkSync(join(rootDir, 'src'), srcAlias, 'junction')
    }
  } catch {
    // Some package managers may install into read-only locations. Keep going so
    // any real module-resolution error is reported by Bun with context.
  }

  const aliases = [
    [
      join(nodeModulesDir, '@ant', 'claude-for-chrome-mcp'),
      "export * from '../../../stubs/ant-claude-for-chrome-mcp.ts'\n",
    ],
    [
      join(nodeModulesDir, 'color-diff-napi'),
      "export * from '../../stubs/color-diff-napi.ts'\n",
    ],
  ]

  for (const [aliasDir, source] of aliases) {
    try {
      const indexPath = join(aliasDir, 'index.js')
      if (existsSync(indexPath)) continue
      mkdirSync(aliasDir, { recursive: true })
      writeFileSync(
        join(aliasDir, 'package.json'),
        JSON.stringify({ type: 'module', main: './index.js' }, null, 2),
      )
      writeFileSync(indexPath, source)
    } catch {
      // Best-effort runtime aliases for tsconfig path stubs.
    }
  }
}

function takeEnvFileArg(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--env-file') {
      const value = args[index + 1]
      if (!value) {
        console.error('Missing value for --env-file')
        process.exit(2)
      }
      args.splice(index, 2)
      return value
    }
    if (arg?.startsWith('--env-file=')) {
      args.splice(index, 1)
      return arg.slice('--env-file='.length)
    }
  }
  return process.env.CLAUDE_YH_ENV_FILE || null
}

const explicitEnvFile = takeEnvFileArg(cliArgs)
const emptyEnvFile = join(tmpdir(), 'claude-yh-empty.env')
if (!existsSync(emptyEnvFile)) {
  writeFileSync(emptyEnvFile, '')
}

ensureRuntimeAliases()

const hasBundledRipgrep = existsSync(
  join(rootDir, 'src', 'utils', 'vendor', 'ripgrep'),
)

const bunArgs = []
if (existsSync(join(rootDir, 'preload.ts'))) {
  bunArgs.push(`--preload=${join(rootDir, 'preload.ts')}`)
}

if (explicitEnvFile && process.env.CLAUDE_YH_SKIP_DOTENV !== '1') {
  bunArgs.push(`--env-file=${explicitEnvFile}`)
} else if (
  process.env.CLAUDE_YH_USE_DOTENV === '1' &&
  process.env.CLAUDE_YH_SKIP_DOTENV !== '1' &&
  existsSync(join(rootDir, '.env'))
) {
  bunArgs.push('--env-file=.env')
} else {
  bunArgs.push(`--env-file=${emptyEnvFile}`)
}

const entrypoint =
  process.env.CLAUDE_CODE_FORCE_RECOVERY_CLI === '1'
    ? './src/localRecoveryCli.ts'
    : './src/entrypoints/cli.tsx'

bunArgs.push(entrypoint, ...cliArgs)

const result = spawnSync('bun', bunArgs, {
  cwd: rootDir,
  env: {
    ...process.env,
    CALLER_DIR: callerDir,
    ...(explicitEnvFile || process.env.CLAUDE_YH_USE_DOTENV === '1'
      ? { CLAUDE_YH_EXPLICIT_ENV_FILE: '1' }
      : {}),
    ...(hasBundledRipgrep
      ? {}
      : { USE_BUILTIN_RIPGREP: process.env.USE_BUILTIN_RIPGREP ?? '0' }),
    CLAUDE_CONFIG_DIR:
      process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude-yh'),
  },
  stdio: 'inherit',
})

if (result.error) {
  console.error(`Failed to start claude-yh: ${result.error.message}`)
  console.error('Install Bun first: https://bun.sh')
  process.exit(1)
}

process.exit(result.status ?? (result.signal ? 1 : 0))

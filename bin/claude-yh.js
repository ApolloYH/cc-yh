#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const callerDir = process.env.CALLER_DIR || process.cwd()
const cliArgs = process.argv.slice(2)

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

const bunArgs = []
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

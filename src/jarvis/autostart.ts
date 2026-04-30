import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export type JarvisAutostartStatus = {
  supported: boolean
  enabled: boolean
  targetPath: string
  watchdogPath: string
  command: string
  restartDelaySeconds: number
  note?: string
}

export async function getJarvisAutostartStatus(): Promise<JarvisAutostartStatus> {
  const targetPath = getAutostartPath()
  return {
    supported: process.platform === 'win32',
    enabled: await exists(targetPath),
    targetPath,
    watchdogPath: getWatchdogPath(),
    command: getServerCommand(),
    restartDelaySeconds: getRestartDelaySeconds(),
    note: process.platform === 'win32'
      ? undefined
      : 'Automatic service installation is currently implemented for Windows startup scripts.',
  }
}

export async function setJarvisAutostart(enabled: boolean): Promise<JarvisAutostartStatus> {
  const targetPath = getAutostartPath()
  if (process.platform !== 'win32') return getJarvisAutostartStatus()
  if (!enabled) {
    await fs.rm(targetPath, { force: true })
    await fs.rm(getWatchdogPath(), { force: true })
    return getJarvisAutostartStatus()
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.mkdir(path.dirname(getWatchdogPath()), { recursive: true })
  await fs.writeFile(getWatchdogPath(), buildWindowsWatchdogScript(), 'utf-8')
  await fs.writeFile(targetPath, buildWindowsStartupScript(), 'utf-8')
  return getJarvisAutostartStatus()
}

export function buildWindowsStartupScript(): string {
  const watchdogPath = getWatchdogPath()
  return [
    '@echo off',
    'setlocal',
    `start "claude-yh jarvis watchdog" /min powershell -NoProfile -ExecutionPolicy Bypass -File "${escapeCmd(watchdogPath)}"`,
    'endlocal',
    '',
  ].join('\r\n')
}

export function buildWindowsWatchdogScript(): string {
  const logPath = path.join(getClaudeConfigHomeDir(), 'jarvis_autostart.log')
  const pidPath = path.join(getClaudeConfigHomeDir(), 'jarvis_watchdog.pid')
  const packageRoot = getPackageRoot()
  const command = getServerCommand()
  const restartDelay = getRestartDelaySeconds()
  return [
    '$ErrorActionPreference = "Continue"',
    `$logPath = '${escapePowerShell(logPath)}'`,
    `$pidPath = '${escapePowerShell(pidPath)}'`,
    `$packageRoot = '${escapePowerShell(packageRoot)}'`,
    `$command = '${escapePowerShell(command)}'`,
    `$restartDelaySeconds = ${restartDelay}`,
    'New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null',
    '[System.Diagnostics.Process]::GetCurrentProcess().Id | Set-Content -LiteralPath $pidPath -Encoding UTF8',
    'while ($true) {',
    '  $startedAt = Get-Date -Format o',
    '  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "[$startedAt] starting claude-yh Jarvis server"',
    '  Push-Location -LiteralPath $packageRoot',
    '  try {',
    '    powershell -NoProfile -ExecutionPolicy Bypass -Command $command *>> $logPath',
    '    $exitCode = $LASTEXITCODE',
    '  } catch {',
    '    $exitCode = 1',
    '    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value $_.Exception.Message',
    '  } finally {',
    '    Pop-Location',
    '  }',
    '  $endedAt = Get-Date -Format o',
    '  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "[$endedAt] server exited with code $exitCode; restarting in $restartDelaySeconds seconds"',
    '  Start-Sleep -Seconds $restartDelaySeconds',
    '}',
    '',
  ].join('\n')
}

function getAutostartPath(): string {
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Startup',
      'claude-yh-jarvis.cmd',
    )
  }
  return path.join(getClaudeConfigHomeDir(), 'claude-yh-jarvis.service')
}

function getWatchdogPath(): string {
  return path.join(getClaudeConfigHomeDir(), 'claude-yh-jarvis-watchdog.ps1')
}

function getServerCommand(): string {
  const port = process.env.SERVER_PORT || '3456'
  return `bun run src/server/index.ts --port ${port}`
}

function getPackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
}

function getRestartDelaySeconds(): number {
  const parsed = Number.parseInt(process.env.CLAUDE_YH_JARVIS_RESTART_DELAY_SECONDS || '10', 10)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 3600) : 10
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''")
}

function escapeCmd(value: string): string {
  return value.replace(/"/g, '""')
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

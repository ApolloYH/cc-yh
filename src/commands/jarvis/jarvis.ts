import type { LocalCommandCall } from '../../types/command.js'
import {
  appendJarvisEvent,
  getJarvisSettingsPath,
  readJarvisConfig,
  updateJarvisConfig,
} from '../../jarvis/store.js'
import type { JarvisRiskMode } from '../../jarvis/types.js'

export const call: LocalCommandCall = async (args) => {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const [action, value] = tokens

  if (!action || action === 'status') {
    return text(await formatStatus())
  }

  if (action === 'on' || action === 'enable' || action === 'start') {
    const config = await updateJarvisConfig({ enabled: true })
    await appendJarvisEvent({
      type: 'config',
      title: 'Jarvis Mode enabled from CLI',
      message: `interval=${Math.round(config.intervalMs / 60_000)}m, mode=${config.riskMode}`,
    })
    return text(await formatStatus('Jarvis Mode enabled.'))
  }

  if (action === 'off' || action === 'disable' || action === 'stop') {
    const config = await updateJarvisConfig({ enabled: false })
    await appendJarvisEvent({
      type: 'config',
      title: 'Jarvis Mode disabled from CLI',
      message: `mode=${config.riskMode}`,
    })
    return text(await formatStatus('Jarvis Mode disabled.'))
  }

  if (action === 'interval') {
    const minutes = Number.parseInt(value ?? '', 10)
    if (!Number.isFinite(minutes) || minutes < 1) {
      return text('Usage: /jarvis interval <minutes>. Minimum is 1 minute.')
    }
    await updateJarvisConfig({ intervalMs: minutes * 60_000 })
    return text(await formatStatus(`Jarvis checkpoint interval set to ${minutes} minute(s).`))
  }

  if (action === 'mode') {
    if (!isRiskMode(value)) {
      return text('Usage: /jarvis mode observe|assisted.')
    }
    await updateJarvisConfig({ riskMode: value })
    return text(await formatStatus(`Jarvis mode set to ${value}.`))
  }

  if (action === 'source') {
    const source = tokens[1]
    const state = tokens[2]
    if (
      !isSource(source) ||
      (state !== 'on' && state !== 'off' && state !== 'enable' && state !== 'disable')
    ) {
      return text('Usage: /jarvis source scheduledTasks|sessions|git on|off.')
    }
    await updateJarvisConfig({
      sources: { [source]: state === 'on' || state === 'enable' },
    })
    return text(await formatStatus(`Jarvis source ${source} ${state}.`))
  }

  return text(
    [
      'Usage:',
      '/jarvis status',
      '/jarvis on',
      '/jarvis off',
      '/jarvis interval <minutes>',
      '/jarvis mode observe|assisted',
      '/jarvis source scheduledTasks|sessions|git on|off',
      '',
      `Config file: ${getJarvisSettingsPath()}`,
    ].join('\n'),
  )
}

async function formatStatus(prefix?: string): Promise<string> {
  const config = await readJarvisConfig()
  const sources = Object.entries(config.sources)
    .filter(([, enabled]) => enabled)
    .map(([source]) => source)
    .join(', ')
  const lines = [
    ...(prefix ? [prefix, ''] : []),
    `Jarvis Mode: ${config.enabled ? 'on' : 'off'}`,
    `Mode: ${config.riskMode}`,
    `Interval: ${Math.round(config.intervalMs / 60_000)} minute(s)`,
    `Sources: ${sources || 'none'}`,
    `Notifications: ${config.notificationChannels.join(', ')}`,
    `Approval guard: ${config.requireApprovalForExternalActions ? 'on' : 'off'}`,
    `Config file: ${getJarvisSettingsPath()}`,
  ]
  return lines.join('\n')
}

function text(value: string) {
  return { type: 'text' as const, value }
}

function isRiskMode(value: string | undefined): value is JarvisRiskMode {
  return value === 'observe' || value === 'assisted'
}

function isSource(
  value: string | undefined,
): value is 'scheduledTasks' | 'sessions' | 'git' {
  return value === 'scheduledTasks' || value === 'sessions' || value === 'git'
}

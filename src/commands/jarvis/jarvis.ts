import type { LocalCommandCall } from '../../types/command.js'
import {
  appendJarvisEvent,
  getJarvisSettingsPath,
  readJarvisConfig,
  updateJarvisCloudToken,
  updateJarvisConfig,
} from '../../jarvis/store.js'
import { getJarvisAutostartStatus, setJarvisAutostart } from '../../jarvis/autostart.js'
import { listJarvisQueue, updateJarvisQueueItem } from '../../jarvis/queue.js'
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
      title: 'Jarvis enabled from CLI',
      message: `interval=${Math.round(config.intervalMs / 60_000)}m, mode=${config.riskMode}`,
    })
    return text(await formatStatus('Jarvis enabled.'))
  }

  if (action === 'off' || action === 'disable' || action === 'stop') {
    const config = await updateJarvisConfig({ enabled: false })
    await appendJarvisEvent({
      type: 'config',
      title: 'Jarvis disabled from CLI',
      message: `mode=${config.riskMode}`,
    })
    return text(await formatStatus('Jarvis disabled.'))
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
      return text('Usage: /jarvis mode observe|assisted|autonomous.')
    }
    const mode = normalizeRiskMode(value)
    await updateJarvisConfig({ riskMode: mode })
    return text(await formatStatus(`Jarvis mode set to ${mode}.`))
  }

  if (action === 'companion' || action === 'lobster' || action === 'xiaolongxia') {
    if (value !== 'on' && value !== 'off') {
      return text('Usage: /jarvis companion on|off')
    }
    await updateJarvisConfig(value === 'on'
      ? {
          companionModeEnabled: true,
          enabled: true,
          riskMode: 'autonomous',
        }
      : { companionModeEnabled: false })
    return text(await formatStatus(`Jarvis proactive mode ${value}.`))
  }

  if (action === 'task') {
    const taskPrompt = args.slice(action.length).trim()
    if (!taskPrompt) {
      await updateJarvisConfig({ taskPrompt: undefined })
      return text(await formatStatus('Jarvis continuous task cleared.'))
    }
    return text('Use `/jarvis enqueue <goal>` to hand work to the Jarvis background agent. Continuous prompt storage is kept for compatibility only.')
  }

  if (action === 'enqueue') {
    const prompt = args.slice(action.length).trim()
    if (!prompt) return text('Usage: /jarvis enqueue <task prompt>')
    const { jarvisService } = await import('../../server/services/jarvisService.js')
    const status = await jarvisService.submitGoal(prompt, 70, 'cli')
    return text(`Jarvis accepted the goal. Queue pending=${status.queue?.pending ?? 0}, running=${status.queue?.running ?? 0}.`)
  }

  if (action === 'queue') {
    const items = await listJarvisQueue()
    return text([
      `Jarvis queue: ${items.length}`,
      ...items.slice(0, 20).map(item =>
        `${item.status.padEnd(9)} p=${item.priority} attempts=${item.attempts}/${item.maxAttempts} ${item.id} ${item.prompt.slice(0, 80)}`,
      ),
    ].join('\n'))
  }

  if (action === 'pause' || action === 'resume') {
    const id = value
    if (!id) return text(`Usage: /jarvis ${action} <queue-id>`)
    const item = await updateJarvisQueueItem(id, {
      status: action === 'pause' ? 'paused' : 'pending',
      checkpoint: action === 'pause' ? 'Paused from CLI.' : 'Resumed from CLI.',
    })
    return text(item ? `Jarvis task ${id} ${action}d.` : `Jarvis task not found: ${id}`)
  }

  if (action === 'delete' || action === 'remove') {
    const id = value
    if (!id) return text(`Usage: /jarvis ${action} <queue-id>`)
    const { jarvisService } = await import('../../server/services/jarvisService.js')
    const result = await jarvisService.deleteQueueItem(id)
    return text(result.item
      ? `Jarvis task ${id} deleted.${result.cancelledRunningProcess ? ' Running process cancelled.' : ''}`
      : `Jarvis task not found: ${id}`)
  }

  if (action === 'checkpoint') {
    const id = value
    if (!id) return text('Usage: /jarvis checkpoint <queue-id>')
    const item = (await listJarvisQueue()).find(entry => entry.id === id)
    return text(item?.checkpoint || `No checkpoint found for ${id}.`)
  }

  if (action === 'autostart') {
    if (value !== 'on' && value !== 'off' && value !== 'status') {
      return text('Usage: /jarvis autostart on|off|status')
    }
    const status = value === 'status'
      ? await getJarvisAutostartStatus()
      : await setJarvisAutostart(value === 'on')
    return text([
      `Autostart: ${status.enabled ? 'on' : 'off'}`,
      `Supported: ${status.supported ? 'yes' : 'no'}`,
      `Path: ${status.targetPath}`,
      `Command: ${status.command}`,
      ...(status.note ? [`Note: ${status.note}`] : []),
    ].join('\n'))
  }

  if (action === 'cloud') {
    const sub = value
    const rest = tokens.slice(2).join(' ')
    const config = await readJarvisConfig()
    if (!sub || sub === 'status') {
      return text([
        `Cloud runner: ${config.cloud.enabled ? 'on' : 'off'}`,
        `Endpoint: ${config.cloud.endpoint || '(none)'}`,
        `Runner ID: ${config.cloud.runnerId}`,
        `Sync queue: ${config.cloud.syncQueue ? 'on' : 'off'}`,
        `Token: ${config.cloud.tokenSet ? 'set' : 'not set'}`,
        `Last heartbeat: ${config.cloud.lastHeartbeatAt || '(none)'}`,
        `Last status: ${config.cloud.lastRunnerStatus || '(none)'}`,
      ].join('\n'))
    }
    if (sub === 'on' || sub === 'off') {
      await updateJarvisConfig({
        cloud: {
          ...config.cloud,
          enabled: sub === 'on',
        },
      })
      return text(await formatStatus(`Jarvis cloud runner ${sub}.`))
    }
    if (sub === 'endpoint') {
      await updateJarvisConfig({
        cloud: {
          ...config.cloud,
          endpoint: rest || undefined,
        },
      })
      return text(await formatStatus('Jarvis cloud endpoint updated.'))
    }
    if (sub === 'token') {
      if (!rest) return text('Usage: /jarvis cloud token <secret>')
      await updateJarvisCloudToken(rest)
      return text('Jarvis cloud token saved. It will not be printed by status commands.')
    }
    return text('Usage: /jarvis cloud status|on|off|endpoint <url>|token <secret>')
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
      '/jarvis mode observe|assisted|autonomous',
      '/jarvis companion on|off',
      '/jarvis enqueue <goal>',
      '/jarvis queue',
      '/jarvis pause <queue-id>',
      '/jarvis resume <queue-id>',
      '/jarvis delete <queue-id>',
      '/jarvis checkpoint <queue-id>',
      '/jarvis autostart on|off|status',
      '/jarvis cloud status|on|off|endpoint <url>|token <secret>',
      '/jarvis source scheduledTasks|sessions|git on|off',
      '',
      `Config file: ${getJarvisSettingsPath()}`,
    ].join('\n'),
  )
}

async function formatStatus(prefix?: string): Promise<string> {
  const config = await readJarvisConfig()
  const autostart = await getJarvisAutostartStatus()
  const sources = Object.entries(config.sources)
    .filter(([, enabled]) => enabled)
    .map(([source]) => source)
    .join(', ')
  const lines = [
    ...(prefix ? [prefix, ''] : []),
    `Jarvis: ${config.enabled ? 'on' : 'off'}`,
    `Mode: ${normalizeRiskMode(config.riskMode)}`,
    `Proactive mode: ${config.companionModeEnabled ? 'on' : 'off'}`,
    `Interval: ${Math.round(config.intervalMs / 60_000)} minute(s)`,
    `Sources: ${sources || 'none'}`,
    `Notifications: ${config.notificationChannels.join(', ')}`,
    `Approval guard: ${config.requireApprovalForExternalActions ? 'on' : 'off'}`,
    `Autostart: ${autostart.enabled ? 'on' : 'off'}${autostart.supported ? '' : ' (unsupported)'}`,
    `Watchdog: ${autostart.watchdogPath}`,
    `Cloud runner: ${config.cloud.enabled ? 'on' : 'off'}${config.cloud.endpoint ? ` (${config.cloud.endpoint})` : ''}`,
    `Continuous task: ${config.taskPrompt ? config.taskPrompt.slice(0, 80) : '(none)'}`,
    `Config file: ${getJarvisSettingsPath()}`,
  ]
  return lines.join('\n')
}

function text(value: string) {
  return { type: 'text' as const, value }
}

function isRiskMode(value: string | undefined): value is JarvisRiskMode {
  return value === 'observe' ||
    value === 'assisted' ||
    value === 'autonomous' ||
    value === 'full_autonomous'
}

function normalizeRiskMode(value: JarvisRiskMode): JarvisRiskMode {
  return value === 'full_autonomous' ? 'autonomous' : value
}

function isSource(
  value: string | undefined,
): value is 'scheduledTasks' | 'sessions' | 'git' {
  return value === 'scheduledTasks' || value === 'sessions' || value === 'git'
}

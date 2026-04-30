import type { Command } from '../../commands.js'

const browser = {
  type: 'local',
  name: 'browser',
  aliases: ['browser-control'],
  description: 'Use the current Chrome browser bridge',
  argumentHint: 'status|on|off|tabs|allow <domain>|deny <domain>',
  supportsNonInteractive: true,
  load: () => import('./browser.js'),
} satisfies Command

export default browser

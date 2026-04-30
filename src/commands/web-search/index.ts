import type { Command } from '../../commands.js'

const webSearch = {
  type: 'local',
  name: 'web-search',
  aliases: ['websearch', 'search-config'],
  description: 'Configure WebSearch for Claude, DuckDuckGo, or custom search APIs',
  argumentHint: 'status|on|off|mode auto|anthropic|local|off|max <n>',
  supportsNonInteractive: true,
  load: () => import('./web-search.js'),
} satisfies Command

export default webSearch

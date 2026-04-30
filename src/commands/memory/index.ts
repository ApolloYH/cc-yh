import type { Command } from '../../commands.js'

const memory: Command = {
  type: 'local-jsx',
  name: 'memory',
  description: 'View, search, summarize, distill, and edit claude-yh memory',
  argumentHint: 'list|show|search|summarize|stale|distill|set',
  load: () => import('./memory.js'),
}

export default memory

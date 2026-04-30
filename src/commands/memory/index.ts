import type { Command } from '../../commands.js'

const memory: Command = {
  type: 'local-jsx',
  name: 'memory',
  description: 'View, search, and edit claude-yh memory',
  argumentHint: 'list|show|search|set',
  load: () => import('./memory.js'),
}

export default memory

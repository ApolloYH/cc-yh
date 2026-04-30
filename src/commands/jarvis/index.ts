import type { Command } from '../../commands.js'

const jarvis = {
  type: 'local',
  name: 'jarvis',
  description: 'Configure the 24h Jarvis companion daemon',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => import('./jarvis.js'),
} satisfies Command

export default jarvis

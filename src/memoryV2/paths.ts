import * as path from 'node:path'
import { getMemoryBaseDir } from '../memdir/paths.js'

const GLOBAL_MEMORY_DIRNAME = 'memory'

export function getGlobalMemoryRoot(): string {
  return (
    path.join(getMemoryBaseDir(), GLOBAL_MEMORY_DIRNAME) + path.sep
  ).normalize('NFC')
}

export function getGlobalMemorySkillsDir(): string {
  return path.join(getGlobalMemoryRoot(), 'sops', 'skills')
}

export function getLegacyUserSkillsDir(): string {
  return path.join(getMemoryBaseDir(), 'skills')
}

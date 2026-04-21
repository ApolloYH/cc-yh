export function getStats() {
  return {
    collapsedSpans: 0,
    collapsedMessages: 0,
    stagedSpans: 0,
    health: {
      totalSpawns: 0,
      totalErrors: 0,
      lastError: '',
      emptySpawnWarningEmitted: false,
      totalEmptySpawns: 0,
    },
  }
}

export function isContextCollapseEnabled(): boolean {
  return false
}

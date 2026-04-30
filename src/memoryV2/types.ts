export type MemoryLayer = 'L1' | 'L2' | 'L3' | 'L4'

export type MemoryV2WriteInput = {
  title: string
  content: string
  source?: string
  verified: boolean
}

export type MemoryV2Entry = {
  layer: MemoryLayer
  id: string
  title: string
  path: string
  source?: string
  verified: boolean
  content?: string
  summary?: string
  updatedAt?: string
}

export type MemoryV2LayerStatus = {
  layer: MemoryLayer
  title: string
  description: string
  path: string
  entries: MemoryV2Entry[]
}

export type MemoryV2SearchResult = {
  entry: MemoryV2Entry
  score: number
  matchedTerms: string[]
  method: 'keyword'
}

export type MemoryV2DistillCandidate = {
  id: string
  layer: 'L2' | 'L3'
  title: string
  content: string
  source: string
  confidence: number
  reason: string
  verified: true
}

export type MemoryV2Status = {
  root: string
  indexPath: string
  factsDir: string
  sopsDir: string
  sessionsDir: string
  summariesDir: string
  candidatePath: string
  entries: MemoryV2Entry[]
  facts: MemoryV2Entry[]
  sops: MemoryV2Entry[]
  layers: MemoryV2LayerStatus[]
}

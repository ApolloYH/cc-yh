export type KeybindingContextName = string
export type KeybindingAction = string

export type ParsedKeystroke = {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  meta?: boolean
  super?: boolean
}

export type ParsedBinding = {
  context: KeybindingContextName
  chord: ParsedKeystroke[]
  action: KeybindingAction | null
}

export type Chord = ParsedKeystroke[]

export type KeybindingBlock = {
  context: KeybindingContextName
  bindings: Record<string, KeybindingAction | null>
}

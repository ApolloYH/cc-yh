/**
 * Shared attachment types for IM adapters.
 */

import type { ImPlatform } from '../platform.js'
import type { AttachmentRef } from '../ws-bridge.js'
export type { AttachmentRef, ImPlatform }

/** Result of downloading an IM resource into the local stage dir. */
export interface LocalAttachment {
  kind: 'image' | 'file'
  name: string
  path: string
  size: number
  mimeType: string
  buffer: Buffer
}

/** Pending outbound media found in Agent stream output. */
export interface PendingUpload {
  id: string
  source:
    | { kind: 'base64'; data: string; mime: string }
    | { kind: 'path'; path: string; mime?: string }
    | { kind: 'url'; url: string; mime?: string }
  alt?: string
}

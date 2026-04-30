import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

type BrowserControlOwnerRecord = {
  baseUrl: string
  pid: number
  updatedAt: string
}

function ownerRegistryPath(): string {
  return path.join(getClaudeConfigHomeDir(), 'browser-control', 'owner.json')
}

export async function publishBrowserControlOwner(baseUrl: string): Promise<void> {
  const filePath = ownerRegistryPath()
  const record: BrowserControlOwnerRecord = {
    baseUrl: baseUrl.replace(/\/$/, ''),
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8')
}

export async function readBrowserControlOwnerUrl(): Promise<string | null> {
  try {
    const raw = await fs.readFile(ownerRegistryPath(), 'utf-8')
    const record = JSON.parse(raw) as Partial<BrowserControlOwnerRecord>
    if (!record.baseUrl || typeof record.baseUrl !== 'string') return null
    const updatedAt = record.updatedAt ? Date.parse(record.updatedAt) : 0
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > 24 * 60 * 60 * 1000) {
      return null
    }
    return record.baseUrl.replace(/\/$/, '')
  } catch {
    return null
  }
}

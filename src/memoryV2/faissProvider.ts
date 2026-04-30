import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { promisify } from 'node:util'
import type { MemoryV2Entry } from './types.js'

const execFileAsync = promisify(execFile)

export type MemoryVectorProvider = 'faiss' | 'local'

export type MemoryVectorRecord = {
  layer: MemoryV2Entry['layer']
  id: string
  path: string
  title: string
  embedding: number[]
  dimensions: number
  updatedAt?: string
}

export type FaissWriteResult = {
  provider: MemoryVectorProvider
  indexPath: string
  metaPath: string
  native: boolean
  records: number
  dimensions: number
  error?: string
}

export type FaissSearchMatch = {
  layer: MemoryVectorRecord['layer']
  id: string
  score: number
  index: number
}

export function getMemoryVectorProvider(): MemoryVectorProvider {
  const raw = process.env.CLAUDE_YH_MEMORY_VECTOR_PROVIDER?.trim().toLowerCase()
  return raw === 'local' ? 'local' : 'faiss'
}

export async function searchFaissVectorIndex(params: {
  indexPath: string
  metaPath: string
  queryEmbedding: number[]
  limit: number
}): Promise<FaissSearchMatch[]> {
  if (getMemoryVectorProvider() !== 'faiss') return []
  try {
    await fs.access(params.indexPath)
    await fs.access(params.metaPath)
  } catch {
    return []
  }

  const queryPath = `${params.indexPath}.query.${process.pid}.${Date.now()}.json`
  await fs.writeFile(queryPath, JSON.stringify({
    embedding: params.queryEmbedding,
    limit: params.limit,
  }), 'utf-8')

  try {
    const python = process.env.CLAUDE_YH_FAISS_PYTHON || 'python'
    const script = [
      'import json, sys',
      'import numpy as np',
      'import faiss',
      'index_path, meta_path, query_path = sys.argv[1], sys.argv[2], sys.argv[3]',
      'index = faiss.read_index(index_path)',
      'meta = json.load(open(meta_path, "r", encoding="utf-8"))',
      'query = json.load(open(query_path, "r", encoding="utf-8"))',
      'records = meta.get("records", [])',
      'limit = min(int(query.get("limit") or 20), max(len(records), 1))',
      'vector = np.array([query.get("embedding", [])], dtype="float32")',
      'if vector.size:',
      '    faiss.normalize_L2(vector)',
      'scores, indexes = index.search(vector, limit)',
      'matches = []',
      'for score, idx in zip(scores[0].tolist(), indexes[0].tolist()):',
      '    if idx < 0 or idx >= len(records):',
      '        continue',
      '    record = records[idx]',
      '    matches.append({"layer": record.get("layer"), "id": record.get("id"), "score": float(score), "index": int(idx)})',
      'print(json.dumps(matches, ensure_ascii=False))',
    ].join('\n')
    const { stdout } = await execFileAsync(python, [
      '-c',
      script,
      params.indexPath,
      params.metaPath,
      queryPath,
    ], {
      timeout: 20_000,
      windowsHide: true,
    })
    const parsed = JSON.parse(stdout || '[]') as FaissSearchMatch[]
    return Array.isArray(parsed) ? parsed.filter(isFaissSearchMatch) : []
  } catch {
    return []
  } finally {
    await fs.unlink(queryPath).catch(() => {})
  }
}

export async function writeFaissVectorIndex(params: {
  indexPath: string
  metaPath: string
  records: MemoryVectorRecord[]
  dimensions: number
}): Promise<FaissWriteResult> {
  const provider = getMemoryVectorProvider()
  const result: FaissWriteResult = {
    provider,
    indexPath: params.indexPath,
    metaPath: params.metaPath,
    native: false,
    records: params.records.length,
    dimensions: params.dimensions,
  }

  await fs.mkdir(path.dirname(params.metaPath), { recursive: true })
  await fs.writeFile(
    params.metaPath,
    JSON.stringify({
      provider,
      generatedAt: new Date().toISOString(),
      dimensions: params.dimensions,
      records: params.records,
      nativeIndexPath: params.indexPath,
    }, null, 2) + '\n',
    'utf-8',
  )

  if (provider !== 'faiss' || params.records.length === 0) {
    return result
  }

  try {
    await buildNativeFaissIndex(params)
    await fs.unlink(params.indexPath + '.unavailable.txt').catch(() => {})
    return { ...result, native: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await fs.writeFile(
      params.indexPath + '.unavailable.txt',
      [
        'FAISS native index was not generated.',
        'Install Python faiss-cpu or set CLAUDE_YH_MEMORY_VECTOR_PROVIDER=local to silence this fallback.',
        message,
        '',
      ].join('\n'),
      'utf-8',
    )
    return { ...result, error: message }
  }
}

async function buildNativeFaissIndex(params: {
  indexPath: string
  metaPath: string
  records: MemoryVectorRecord[]
  dimensions: number
}): Promise<void> {
  const python = process.env.CLAUDE_YH_FAISS_PYTHON || 'python'
  const script = [
    'import json, sys',
    'import numpy as np',
    'import faiss',
    'meta_path, index_path = sys.argv[1], sys.argv[2]',
    'payload = json.load(open(meta_path, "r", encoding="utf-8"))',
    'vectors = [r["embedding"] for r in payload.get("records", [])]',
    'dim = int(payload.get("dimensions") or 0)',
    'arr = np.array(vectors, dtype="float32") if vectors else np.zeros((0, dim), dtype="float32")',
    'index = faiss.IndexFlatIP(dim)',
    'if arr.size:',
    '    faiss.normalize_L2(arr)',
    '    index.add(arr)',
    'faiss.write_index(index, index_path)',
  ].join('\n')

  await execFileAsync(python, ['-c', script, params.metaPath, params.indexPath], {
    timeout: 20_000,
    windowsHide: true,
  })
}

function isFaissSearchMatch(value: unknown): value is FaissSearchMatch {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as FaissSearchMatch).layer === 'string' &&
      typeof (value as FaissSearchMatch).id === 'string' &&
      typeof (value as FaissSearchMatch).score === 'number' &&
      typeof (value as FaissSearchMatch).index === 'number',
  )
}

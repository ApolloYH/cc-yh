import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'
import type {
  JarvisManagerPlan,
  JarvisReportPolicy,
  JarvisRun,
  JarvisRunStatus,
  JarvisWorkerStatus,
  JarvisWorkerTask,
} from './types.js'

const RUNS_FILE = 'jarvis_runs.json'
const MAX_RUNS = 200

export const DEFAULT_JARVIS_REPORT_POLICY: JarvisReportPolicy = {
  progressMode: 'normal',
  progressIntervalMs: 30_000,
  reportOnlyWhenChanged: true,
  reportOnBlocked: true,
  reportOnRisk: true,
  finalReportRequired: true,
}

type JarvisRunStore = {
  version: 1
  runs: JarvisRun[]
}

export async function createJarvisRun(input: {
  goal: string
  managerPlan?: JarvisManagerPlan
  reportPolicy?: Partial<JarvisReportPolicy>
}): Promise<JarvisRun> {
  const now = new Date().toISOString()
  const run: JarvisRun = {
    id: crypto.randomUUID(),
    goal: input.goal,
    status: 'planning',
    managerPlan: input.managerPlan,
    workers: [],
    reportPolicy: normalizeReportPolicy({
      ...input.managerPlan?.reportPolicy,
      ...input.reportPolicy,
    }),
    createdAt: now,
    updatedAt: now,
  }
  const store = await readJarvisRunStore()
  await writeJarvisRunStore({ version: 1, runs: [run, ...store.runs] })
  logRunDiagnostic('create_run', true, { runId: run.id, goalLength: run.goal.length })
  return run
}

export async function listJarvisRuns(limit = 20): Promise<JarvisRun[]> {
  return (await readJarvisRunStore()).runs.slice(0, limit)
}

export async function getJarvisRun(id: string): Promise<JarvisRun | null> {
  return (await readJarvisRunStore()).runs.find(run => run.id === id) ?? null
}

export async function findActiveJarvisRuns(): Promise<JarvisRun[]> {
  return (await readJarvisRunStore()).runs.filter(run =>
    run.status === 'planning' ||
    run.status === 'running' ||
    run.status === 'blocked' ||
    run.status === 'paused',
  )
}

export async function updateJarvisRun(
  id: string,
  patch: Partial<Omit<JarvisRun, 'id' | 'createdAt' | 'workers'>> & {
    workers?: JarvisWorkerTask[]
  },
): Promise<JarvisRun | null> {
  const store = await readJarvisRunStore()
  const current = store.runs.find(run => run.id === id)
  if (!current) return null
  const next: JarvisRun = {
    ...current,
    ...patch,
    reportPolicy: normalizeReportPolicy({
      ...current.reportPolicy,
      ...patch.reportPolicy,
    }),
    workers: patch.workers ?? current.workers,
    updatedAt: new Date().toISOString(),
  }
  await writeJarvisRunStore({
    version: 1,
    runs: store.runs.map(run => run.id === id ? next : run),
  })
  logRunDiagnostic('update_run', true, {
    runId: id,
    status: next.status,
    patchKeys: Object.keys(patch),
  })
  return next
}

export async function addJarvisWorker(
  runId: string,
  worker: Omit<JarvisWorkerTask, 'id' | 'runId' | 'status'> & {
    id?: string
    status?: JarvisWorkerStatus
  },
): Promise<JarvisWorkerTask | null> {
  const run = await getJarvisRun(runId)
  if (!run) return null
  const now = new Date().toISOString()
  const nextWorker: JarvisWorkerTask = {
    id: worker.id ?? crypto.randomUUID(),
    runId,
    role: worker.role,
    title: worker.title,
    prompt: worker.prompt,
    expectedOutput: worker.expectedOutput,
    queueItemId: worker.queueItemId,
    status: worker.status ?? 'pending',
    assignedAt: worker.assignedAt,
    lastProgressAt: worker.lastProgressAt,
    timeoutAt: worker.timeoutAt,
    checkpoint: worker.checkpoint,
    result: worker.result,
    error: worker.error,
  }
  await updateJarvisRun(runId, {
    status: run.status === 'planning' ? 'running' : run.status,
    workers: [...run.workers, nextWorker],
    updatedAt: now,
  })
  logRunDiagnostic('add_worker', true, {
    runId,
    workerId: nextWorker.id,
    queueItemId: nextWorker.queueItemId ?? null,
    role: nextWorker.role,
  })
  return nextWorker
}

export async function updateJarvisWorker(
  workerId: string,
  patch: Partial<Omit<JarvisWorkerTask, 'id' | 'runId'>>,
): Promise<JarvisWorkerTask | null> {
  const store = await readJarvisRunStore()
  let nextWorker: JarvisWorkerTask | null = null
  const runs = store.runs.map(run => {
    const index = run.workers.findIndex(worker => worker.id === workerId)
    if (index === -1) return run
    const workers = [...run.workers]
    nextWorker = {
      ...workers[index],
      ...patch,
      lastProgressAt: patch.lastProgressAt ?? workers[index].lastProgressAt,
    }
    workers[index] = nextWorker
    return {
      ...run,
      workers,
      updatedAt: new Date().toISOString(),
    }
  })
  if (!nextWorker) return null
  await writeJarvisRunStore({ version: 1, runs })
  logRunDiagnostic('update_worker', true, {
    workerId,
    status: nextWorker.status,
    patchKeys: Object.keys(patch),
  })
  return nextWorker
}

export async function updateJarvisWorkerByQueueItem(
  queueItemId: string,
  patch: Partial<Omit<JarvisWorkerTask, 'id' | 'runId'>>,
): Promise<JarvisWorkerTask | null> {
  const store = await readJarvisRunStore()
  const worker = store.runs
    .flatMap(run => run.workers)
    .find(entry => entry.queueItemId === queueItemId)
  return worker ? updateJarvisWorker(worker.id, patch) : null
}

export function normalizeReportPolicy(input: Partial<JarvisReportPolicy> | undefined): JarvisReportPolicy {
  return {
    progressMode: input?.progressMode === 'quiet' || input?.progressMode === 'silent'
      ? input.progressMode
      : 'normal',
    progressIntervalMs: typeof input?.progressIntervalMs === 'number' && Number.isFinite(input.progressIntervalMs)
      ? Math.max(10_000, Math.min(30 * 60_000, Math.round(input.progressIntervalMs)))
      : DEFAULT_JARVIS_REPORT_POLICY.progressIntervalMs,
    reportOnlyWhenChanged: input?.reportOnlyWhenChanged ?? DEFAULT_JARVIS_REPORT_POLICY.reportOnlyWhenChanged,
    reportOnBlocked: input?.reportOnBlocked ?? DEFAULT_JARVIS_REPORT_POLICY.reportOnBlocked,
    reportOnRisk: input?.reportOnRisk ?? DEFAULT_JARVIS_REPORT_POLICY.reportOnRisk,
    finalReportRequired: input?.finalReportRequired ?? DEFAULT_JARVIS_REPORT_POLICY.finalReportRequired,
  }
}

async function readJarvisRunStore(): Promise<JarvisRunStore> {
  try {
    const raw = await fs.readFile(getJarvisRunsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<JarvisRunStore>
    return {
      version: 1,
      runs: Array.isArray(parsed.runs)
        ? parsed.runs.filter(isJarvisRun).map(normalizeJarvisRun)
        : [],
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, runs: [] }
    }
    throw error
  }
}

async function writeJarvisRunStore(store: JarvisRunStore): Promise<void> {
  const filePath = getJarvisRunsPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(
    filePath,
    JSON.stringify({ version: 1, runs: store.runs.slice(0, MAX_RUNS) }, null, 2) + '\n',
    'utf-8',
  )
}

function getJarvisRunsPath(): string {
  return path.join(getClaudeConfigHomeDir(), RUNS_FILE)
}

function isJarvisRun(value: unknown): value is JarvisRun {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as JarvisRun).id === 'string' &&
      typeof (value as JarvisRun).goal === 'string' &&
      typeof (value as JarvisRun).status === 'string' &&
      Array.isArray((value as JarvisRun).workers),
  )
}

function normalizeJarvisRun(run: JarvisRun): JarvisRun {
  return {
    ...run,
    reportPolicy: normalizeReportPolicy(run.reportPolicy),
    workers: run.workers.filter(isJarvisWorker),
  }
}

function isJarvisWorker(value: unknown): value is JarvisWorkerTask {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as JarvisWorkerTask).id === 'string' &&
      typeof (value as JarvisWorkerTask).runId === 'string' &&
      typeof (value as JarvisWorkerTask).title === 'string' &&
      typeof (value as JarvisWorkerTask).prompt === 'string' &&
      typeof (value as JarvisWorkerTask).status === 'string',
  )
}

function logRunDiagnostic(
  event: string,
  ok: boolean,
  data: Record<string, unknown>,
): void {
  logDiagnosticEvent({
    scope: 'jarvis.run',
    event,
    ok,
    data,
  })
}

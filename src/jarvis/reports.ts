import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { logDiagnosticEvent } from '../utils/diagnosticLog.js'

export type JarvisReportStatus = 'completed' | 'failed' | 'paused' | 'running'

export type JarvisReport = {
  id: string
  taskId?: string
  title: string
  goal?: string
  status: JarvisReportStatus
  summary: string
  checkpoint?: string
  reportPath: string
  createdAt: string
}

export function getJarvisWorkDir(): string {
  return path.join(getClaudeConfigHomeDir(), 'jarvis')
}

export function getJarvisReportsDir(): string {
  return path.join(getJarvisWorkDir(), 'reports')
}

export function getJarvisTodoPath(): string {
  return path.join(getJarvisWorkDir(), 'TODO.md')
}

export function getJarvisHistoryPath(): string {
  return path.join(getJarvisWorkDir(), 'history.md')
}

export async function ensureJarvisWorkspace(): Promise<void> {
  await fs.mkdir(getJarvisReportsDir(), { recursive: true })
  await ensureMarkdownFile(getJarvisTodoPath(), '# Jarvis TODO\n\n')
  await ensureMarkdownFile(getJarvisHistoryPath(), '# Jarvis History\n\n')
}

export async function appendJarvisTodo(item: string): Promise<void> {
  await ensureJarvisWorkspace()
  await fs.appendFile(getJarvisTodoPath(), `- [ ] ${item.trim()}\n`, 'utf-8')
}

export async function writeJarvisReport(input: {
  taskId?: string
  title: string
  goal?: string
  status: JarvisReportStatus
  summary: string
  checkpoint?: string
}): Promise<JarvisReport> {
  await ensureJarvisWorkspace()
  const createdAt = new Date().toISOString()
  const id = `report-${createdAt.replace(/[:.]/g, '-')}`
  const reportPath = path.join(getJarvisReportsDir(), `${id}.md`)
  const report: JarvisReport = {
    id,
    taskId: input.taskId,
    title: input.title,
    goal: input.goal,
    status: input.status,
    summary: input.summary,
    checkpoint: input.checkpoint,
    reportPath,
    createdAt,
  }
  const markdown = [
    '---',
    `id: ${JSON.stringify(report.id)}`,
    report.taskId ? `taskId: ${JSON.stringify(report.taskId)}` : '',
    `status: ${JSON.stringify(report.status)}`,
    `createdAt: ${JSON.stringify(report.createdAt)}`,
    '---',
    '',
    `# ${report.title}`,
    '',
    report.goal ? `Goal: ${report.goal}` : '',
    '',
    `Status: ${report.status}`,
    '',
    '## Summary',
    '',
    report.summary,
    '',
    report.checkpoint ? '## Checkpoint' : '',
    report.checkpoint ?? '',
    '',
  ].filter(line => line !== '').join('\n')

  await fs.writeFile(reportPath, markdown, 'utf-8')
  await fs.appendFile(
    getJarvisHistoryPath(),
    `- ${createdAt} [${report.status}] ${report.title} -> ${path.relative(getJarvisWorkDir(), reportPath).replace(/\\/g, '/')}\n`,
    'utf-8',
  )
  logDiagnosticEvent({
    scope: 'jarvis.report',
    event: 'written',
    ok: true,
    data: {
      id,
      taskId: report.taskId,
      status: report.status,
      reportPath,
    },
  })
  return report
}

export async function readJarvisReports(limit = 20): Promise<JarvisReport[]> {
  try {
    await ensureJarvisWorkspace()
    const files = (await fs.readdir(getJarvisReportsDir()))
      .filter(file => file.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, limit)
    const reports = await Promise.all(files.map(file => readJarvisReport(path.join(getJarvisReportsDir(), file))))
    return reports.filter((report): report is JarvisReport => report !== null)
  } catch {
    return []
  }
}

async function readJarvisReport(reportPath: string): Promise<JarvisReport | null> {
  try {
    const raw = await fs.readFile(reportPath, 'utf-8')
    const title = raw.match(/^# (.+)$/m)?.[1]?.trim() || path.basename(reportPath, '.md')
    const status = (raw.match(/^status: \"?([^\"\n]+)\"?$/m)?.[1] ?? 'completed') as JarvisReportStatus
    const createdAt = raw.match(/^createdAt: \"?([^\"\n]+)\"?$/m)?.[1] ?? ''
    const taskId = raw.match(/^taskId: \"?([^\"\n]+)\"?$/m)?.[1]
    const summary = raw.match(/## Summary\s+([\s\S]*?)(?:\n## |\n?$)/)?.[1]?.trim() || ''
    const checkpoint = raw.match(/## Checkpoint\s+([\s\S]*?)$/)?.[1]?.trim()
    return {
      id: path.basename(reportPath, '.md'),
      taskId,
      title,
      status,
      summary,
      checkpoint,
      reportPath,
      createdAt,
    }
  } catch {
    return null
  }
}

async function ensureMarkdownFile(filePath: string, initialContent: string): Promise<void> {
  try {
    await fs.access(filePath)
  } catch {
    await writeMarkdownFileWithParentRetry(filePath, initialContent)
  }
}

async function writeMarkdownFileWithParentRetry(
  filePath: string,
  content: string,
): Promise<void> {
  const parent = path.dirname(filePath)
  await fs.mkdir(parent, { recursive: true })
  try {
    await fs.writeFile(filePath, content, 'utf-8')
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
    if (code !== 'ENOENT') throw error
    await fs.mkdir(parent, { recursive: true })
    await fs.writeFile(filePath, content, 'utf-8')
  }
}

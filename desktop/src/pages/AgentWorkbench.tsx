import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '../components/shared/Button'
import {
  agentWorkbenchApi,
  type BrowserControlDecision,
  type BrowserControlExecutionResult,
  type MemoryV2Entry,
  type RuntimeDiagnostics,
  type RuntimeGlobResult,
  type RuntimeGrepResult,
} from '../api/agentWorkbench'

type StepStatus = 'idle' | 'running' | 'passed' | 'failed'

type WorkbenchStep = {
  id: string
  label: string
  status: StepStatus
  detail: string
}

const initialSteps: WorkbenchStep[] = [
  { id: 'diagnostics', label: 'Runtime diagnostics', status: 'idle', detail: 'Waiting' },
  { id: 'runtime', label: 'Rust/TS runtime search', status: 'idle', detail: 'Waiting' },
  { id: 'memory', label: 'MemoryV2 promotion', status: 'idle', detail: 'Waiting' },
  { id: 'skill', label: 'Reviewed Skill distillation', status: 'idle', detail: 'Waiting' },
  { id: 'browser', label: 'BrowserControl policy', status: 'idle', detail: 'Waiting' },
  { id: 'jarvis', label: 'Jarvis checkpoint', status: 'idle', detail: 'Waiting' },
]

export function AgentWorkbench() {
  const [cwd, setCwd] = useState('')
  const [globPattern, setGlobPattern] = useState('src/runtime/**/*.ts')
  const [grepPattern, setGrepPattern] = useState('runtime')
  const [steps, setSteps] = useState<WorkbenchStep[]>(initialSteps)
  const [isRunning, setIsRunning] = useState(false)
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics | null>(null)
  const [globResult, setGlobResult] = useState<RuntimeGlobResult | null>(null)
  const [grepResult, setGrepResult] = useState<RuntimeGrepResult | null>(null)
  const [memoryEntry, setMemoryEntry] = useState<MemoryV2Entry | null>(null)
  const [sopEntry, setSopEntry] = useState<MemoryV2Entry | null>(null)
  const [skillRoot, setSkillRoot] = useState('')
  const [browserDecision, setBrowserDecision] = useState<BrowserControlDecision | null>(null)
  const [browserExecution, setBrowserExecution] = useState<BrowserControlExecutionResult | null>(null)
  const [jarvisMessage, setJarvisMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    agentWorkbenchApi.diagnostics()
      .then(result => {
        setDiagnostics(result)
        setCwd(result.cwd)
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const passedCount = useMemo(
    () => steps.filter(step => step.status === 'passed').length,
    [steps],
  )

  const setStep = (id: string, status: StepStatus, detail: string) => {
    setSteps(current =>
      current.map(step => step.id === id ? { ...step, status, detail } : step),
    )
  }

  const runWorkbenchTask = async () => {
    const resolvedCwd = cwd.trim()
    if (!resolvedCwd) {
      setError('CWD is required before running the workbench task.')
      return
    }

    setIsRunning(true)
    setError(null)
    setSteps(initialSteps.map(step => ({ ...step, status: 'idle', detail: 'Waiting' })))
    setGlobResult(null)
    setGrepResult(null)
    setMemoryEntry(null)
    setSopEntry(null)
    setSkillRoot('')
    setBrowserDecision(null)
    setBrowserExecution(null)
    setJarvisMessage('')

    try {
      setStep('diagnostics', 'running', 'Reading server runtime context')
      const diag = await agentWorkbenchApi.diagnostics()
      setDiagnostics(diag)
      setStep('diagnostics', 'passed', `${diag.platform}/${diag.arch}, config ${diag.configDir}`)

      setStep('runtime', 'running', 'Running fs.glob and fs.grep')
      const [glob, grep] = await Promise.all([
        agentWorkbenchApi.glob(resolvedCwd, globPattern.trim() || '**/*.ts'),
        agentWorkbenchApi.grep(
          resolvedCwd,
          grepPattern.trim() || 'runtime',
          globPattern.trim() || '**/*.ts',
        ),
      ])
      setGlobResult(glob)
      setGrepResult(grep)
      setStep(
        'runtime',
        'passed',
        `${glob.source} glob ${glob.total}; ${grep.source} grep ${grep.total}`,
      )

      setStep('memory', 'running', 'Writing verified fact and SOP')
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const fact = await agentWorkbenchApi.writeFact({
        title: `Workbench runtime proof ${stamp}`,
        source: 'agent-workbench',
        content: `Verified from web UI. Runtime source: ${glob.source}. Glob hits: ${glob.total}. Grep hits: ${grep.total}.`,
      })
      const sop = await agentWorkbenchApi.writeSop({
        title: `Workbench smoke SOP ${stamp}`,
        source: 'agent-workbench',
        content: [
          '1. Open Agent Workbench.',
          '2. Run the integrated task.',
          '3. Confirm Runtime search, MemoryV2, Skill distillation, BrowserControl, and Jarvis all pass.',
        ].join('\n'),
      })
      setMemoryEntry(fact.entry)
      setSopEntry(sop.entry)
      setStep('memory', 'passed', `Saved ${fact.entry.id} and ${sop.entry.id}`)

      setStep('skill', 'running', 'Saving reviewed SKILL.md into project scope')
      const skill = await agentWorkbenchApi.distillSkill({
        name: 'agent-workbench-smoke',
        projectRoot: resolvedCwd,
        markdown: [
          '---',
          'name: agent-workbench-smoke',
          'version: "0.1.0"',
          'description: Verify the integrated Claude YH workbench from the web UI.',
          'user-invocable: true',
          '---',
          '',
          '# Agent Workbench Smoke',
          '',
          'Use this skill when validating that the web UI can drive Runtime search, MemoryV2, BrowserControl, and Jarvis checkpoints.',
          '',
          '## Workflow',
          '',
          '1. Run the Agent Workbench task.',
          '2. Check that every step passes.',
          '3. Inspect the generated memory and skill paths.',
        ].join('\n'),
      })
      setSkillRoot(skill.skillRoot)
      setStep('skill', 'passed', `Saved ${skill.skill.name}`)

      setStep('browser', 'running', 'Updating policy and reading current browser tabs through the extension bridge')
      await agentWorkbenchApi.updateBrowserPolicy({
        enabled: true,
        allowedDomains: ['*'],
        deniedDomains: [],
        allowHighRiskBackends: true,
        allowHighRiskCapabilities: false,
        requireConfirmationForSensitiveActions: true,
      })
      const browser = await agentWorkbenchApi.assessBrowserAction({
        backendId: 'tmwd-cdp-bridge',
        capability: 'tabs.read',
        domain: '',
        url: '',
        userConfirmed: true,
      })
      const execution = await agentWorkbenchApi.executeBrowserAction({
        backendId: 'tmwd-cdp-bridge',
        capability: 'tabs.read',
        userConfirmed: true,
      })
      setBrowserDecision(browser.decision)
      setBrowserExecution(execution)
      const tabCount = extractBrowserTabCount(execution.data)
      setStep(
        'browser',
        execution.ok ? 'passed' : 'failed',
        execution.ok
          ? `${browser.decision.reason}; ${tabCount} current tabs`
          : execution.error || 'Browser execution failed',
      )
      if (!execution.ok) {
        throw new Error(execution.error || 'Browser execution failed')
      }

      setStep('jarvis', 'running', 'Creating a manual checkpoint')
      const jarvis = await agentWorkbenchApi.jarvisTick()
      setJarvisMessage(jarvis.event.message)
      setStep('jarvis', 'passed', jarvis.event.title)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setSteps(current => {
        const running = current.find(step => step.status === 'running')
        if (!running) return current
        return current.map(step =>
          step.id === running.id ? { ...step, status: 'failed', detail: message } : step,
        )
      })
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-8 py-7">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-[23px] text-[var(--color-brand)]">hub</span>
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Agent Workbench</h1>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-[var(--color-text-secondary)]">
              Run the integrated Rust runtime, MemoryV2, Skill distillation, BrowserControl policy, and Jarvis checkpoint flow from the web UI.
            </p>
          </div>
          <Button
            loading={isRunning}
            icon={<span className="material-symbols-outlined text-[16px]">play_arrow</span>}
            onClick={() => void runWorkbenchTask()}
          >
            Run task
          </Button>
        </header>

        {error && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-error)]/25 bg-[var(--color-error)]/6 px-4 py-3 text-sm text-[var(--color-error)]">
            {error}
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Task input</h2>
              <span className="text-xs text-[var(--color-text-tertiary)]">{passedCount}/{steps.length} passed</span>
            </div>
            <div className="grid gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">Working directory</span>
                <input
                  value={cwd}
                  onChange={event => setCwd(event.target.value)}
                  className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">Glob</span>
                  <input
                    value={globPattern}
                    onChange={event => setGlobPattern(event.target.value)}
                    className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">Grep pattern</span>
                  <input
                    value={grepPattern}
                    onChange={event => setGrepPattern(event.target.value)}
                    className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Runtime</h2>
            <dl className="grid gap-2 text-xs">
              <Info label="cwd" value={diagnostics?.cwd || 'Loading'} />
              <Info label="config" value={diagnostics?.configDir || 'Loading'} />
              <Info label="platform" value={diagnostics ? `${diagnostics.platform}/${diagnostics.arch}` : 'Loading'} />
            </dl>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {steps.map(step => (
            <StepCard key={step.id} step={step} />
          ))}
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <ResultPanel title="Runtime search">
            <ResultLine label="Glob source" value={globResult ? `${globResult.source} (${globResult.total})` : 'Not run'} />
            <ResultLine label="Grep source" value={grepResult ? `${grepResult.source} (${grepResult.total})` : 'Not run'} />
            <pre className="mt-3 max-h-48 overflow-auto rounded-[var(--radius-md)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-text-secondary)]">
              {JSON.stringify({
                files: globResult?.files.slice(0, 4) ?? [],
                matches: grepResult?.matches.slice(0, 4) ?? [],
              }, null, 2)}
            </pre>
          </ResultPanel>

          <ResultPanel title="Memory and Skill">
            <ResultLine label="Fact" value={memoryEntry?.path || 'Not saved'} />
            <ResultLine label="SOP" value={sopEntry?.path || 'Not saved'} />
            <ResultLine label="Skill" value={skillRoot || 'Not saved'} />
          </ResultPanel>

          <ResultPanel title="BrowserControl">
            <ResultLine label="Decision" value={browserDecision?.decision || 'Not assessed'} />
            <ResultLine label="Backend" value={browserExecution?.backendId || 'Not executed'} />
            <ResultLine label="Audit" value={browserExecution?.auditId || 'No audit event'} />
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
              {browserExecution
                ? browserExecution.ok
                  ? `Current Chrome bridge returned ${extractBrowserTabCount(browserExecution.data)} tabs.`
                  : browserExecution.error
                : browserDecision?.reason || 'No browser policy assessment yet.'}
            </p>
          </ResultPanel>

          <ResultPanel title="Jarvis">
            <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
              {jarvisMessage || 'No checkpoint yet.'}
            </p>
          </ResultPanel>
        </section>
      </div>
    </div>
  )
}

function extractBrowserTabCount(data: unknown): number {
  if (!isRecord(data)) return 0
  return Array.isArray(data.tabs) ? data.tabs.length : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function StepCard({ step }: { step: WorkbenchStep }) {
  const tone = {
    idle: 'bg-[var(--color-text-tertiary)]',
    running: 'bg-[var(--color-brand)]',
    passed: 'bg-[var(--color-success)]',
    failed: 'bg-[var(--color-error)]',
  }[step.status]

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${tone}`} />
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{step.label}</h3>
      </div>
      <p className="text-xs leading-5 text-[var(--color-text-secondary)]">{step.detail}</p>
    </div>
  )
}

function ResultPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container)] p-4">
      <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">{title}</h2>
      {children}
    </section>
  )
}

function ResultLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 grid gap-2 text-sm md:grid-cols-[120px_minmax(0,1fr)]">
      <span className="text-[var(--color-text-tertiary)]">{label}</span>
      <span className="truncate text-[var(--color-text-primary)]" title={value}>{value}</span>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
      <dt className="text-[var(--color-text-tertiary)]">{label}</dt>
      <dd className="truncate text-[var(--color-text-primary)]" title={value}>{value}</dd>
    </div>
  )
}

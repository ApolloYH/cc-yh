import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface } from 'readline'
import {
  createRustSidecarRequest,
  encodeRustSidecarRequest,
  parseRustSidecarResponse,
  type RustSidecarMethod,
} from './rustSidecarProtocol.js'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type RustSidecarClientOptions = {
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

export class RustSidecarRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RustSidecarRequestError'
  }
}

export class RustSidecarClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private readonly pending = new Map<string, PendingRequest>()
  private readonly timeoutMs: number

  constructor(private readonly options: RustSidecarClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 5_000
  }

  start(): void {
    if (this.child) return

    const child = spawn(this.options.command, this.options.args ?? [], {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.child = child

    const lines = createInterface({ input: child.stdout })
    lines.on('line', line => this.handleLine(line))

    child.on('error', error => {
      this.rejectAll(new Error(`Rust sidecar failed to start: ${error.message}`))
    })
    child.on('exit', (code, signal) => {
      this.child = null
      this.rejectAll(
        new Error(
          `Rust sidecar exited before replying (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
        ),
      )
    })
  }

  async hello(): Promise<unknown> {
    return this.request('runtime.hello', {})
  }

  async request(
    method: RustSidecarMethod,
    params?: unknown,
    timeoutMs = this.timeoutMs,
  ): Promise<unknown> {
    this.start()

    const child = this.child
    if (!child) {
      throw new Error('Rust sidecar is not running')
    }

    const id = String(this.nextId++)
    const request = createRustSidecarRequest(id, method, params)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Rust sidecar request timed out: ${method}`))
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(encodeRustSidecarRequest(request), error => {
        if (!error) return
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error(`Rust sidecar write failed: ${error.message}`))
      })
    })
  }

  close(): void {
    const child = this.child
    this.child = null
    this.rejectAll(new Error('Rust sidecar closed'))
    child?.kill()
  }

  private handleLine(line: string): void {
    let response
    try {
      response = parseRustSidecarResponse(line)
    } catch (error) {
      this.rejectAll(
        error instanceof Error
          ? error
          : new Error('Rust sidecar emitted an invalid response'),
      )
      return
    }

    const pending = this.pending.get(response.id)
    if (!pending) return

    clearTimeout(pending.timer)
    this.pending.delete(response.id)

    if (response.ok) {
      pending.resolve(response.result)
      return
    }

    pending.reject(
      new RustSidecarRequestError(response.error.code, response.error.message),
    )
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

import { z } from 'zod/v4'
import {
  BROWSER_CONTROL_BACKENDS,
  executeBrowserControl,
  type BrowserControlCapability,
  type BrowserControlExecuteRequest,
  type BrowserControlExecution,
} from '../../browserControl/index.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const BROWSER_CONTROL_TOOL_NAME = 'BrowserControl'

const capabilitySchema = z.enum([
  'tabs.read',
  'page.navigate',
  'page.screenshot',
  'page.read_dom',
  'page.click',
  'page.type',
  'page.read_console',
  'page.read_network',
  'files.upload',
  'downloads.save',
  'storage.read_cookies',
  'cdp.call',
  'headers.modify',
  'extensions.manage',
])

const inputSchema = lazySchema(() =>
  z.strictObject({
    backendId: z
      .string()
      .default('tmwd-cdp-bridge')
      .describe(
        'Browser backend to use. Prefer tmwd-cdp-bridge for the user\'s existing Chrome session and cookies. Use chrome-devtools only when an explicit CDP endpoint is configured.',
      ),
    capability: capabilitySchema.describe('Browser capability to execute'),
    url: z
      .string()
      .optional()
      .describe('Target URL for navigation, page reads, cookies, or tab matching'),
    domain: z
      .string()
      .optional()
      .describe('Target domain when there is no URL. Used for policy checks.'),
    tabId: z
      .string()
      .optional()
      .describe('Existing browser tab id/session id to operate on'),
    selector: z
      .string()
      .optional()
      .describe('CSS selector for click/type/upload actions'),
    filePath: z
      .string()
      .optional()
      .describe('Local file path for files.upload'),
    downloadPath: z
      .string()
      .optional()
      .describe('Local directory path for downloads.save'),
    text: z.string().optional().describe('Text to type into the selected element'),
    submit: z
      .boolean()
      .optional()
      .describe('Press Enter after typing when capability is page.type'),
    fullPage: z
      .boolean()
      .optional()
      .describe('Capture beyond viewport for screenshots'),
    screenshotFormat: z.enum(['png', 'jpeg']).optional(),
    maxContentLength: z
      .number()
      .int()
      .positive()
      .max(250_000)
      .optional()
      .describe('Maximum DOM/text characters returned by page.read_dom'),
    cdp: z
      .object({
        method: z.string(),
        params: z.record(z.string(), z.unknown()).optional(),
      })
      .optional()
      .describe('Raw CDP method and params for cdp.call'),
    devtools: z
      .object({
        endpoint: z.string().optional(),
        port: z.number().int().positive().optional(),
        launch: z.boolean().optional(),
        chromePath: z.string().optional(),
        userDataDir: z.string().optional(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .optional()
      .describe('Chrome DevTools backend options'),
    tmwd: z
      .object({
        endpoint: z.string().optional(),
        timeoutMs: z.number().int().positive().optional(),
        sessionId: z.string().optional(),
      })
      .optional()
      .describe('TMWD bridge options'),
    description: z
      .string()
      .optional()
      .describe('Human-readable reason for sensitive browser actions'),
    pageSignals: z
      .array(z.enum([
        'login',
        'captcha',
        'two_factor',
        'payment',
        'sensitive_confirmation',
      ]))
      .optional()
      .describe(
        'Observed page signals. captcha, two_factor, payment, and sensitive_confirmation are human-only and will be blocked.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    ok: z.boolean(),
    backendId: z.string(),
    decision: z.unknown(),
    auditId: z.string(),
    data: z.unknown().optional(),
    error: z.string().optional(),
    statusCode: z.number().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = BrowserControlExecution

const SENSITIVE_CAPABILITIES = new Set<BrowserControlCapability>([
  'page.click',
  'page.type',
  'files.upload',
  'downloads.save',
  'storage.read_cookies',
  'cdp.call',
  'headers.modify',
  'extensions.manage',
])

export const BrowserControlTool = buildTool({
  name: BROWSER_CONTROL_TOOL_NAME,
  searchHint:
    'control the user browser through TMWD, CDP, or MCP: tabs, DOM, click, type, screenshots, cookies',
  maxResultSizeChars: 120_000,
  alwaysLoad: true,
  async description(input) {
    return `Control browser via ${input.backendId ?? 'tmwd-cdp-bridge'}: ${input.capability}`
  },
  async prompt() {
    const backends = BROWSER_CONTROL_BACKENDS.map(
      backend =>
        `- ${backend.id}: ${backend.displayName}; capabilities ${backend.capabilities.join(', ')}`,
    ).join('\n')
    return [
      'Use BrowserControl when you need to inspect or operate the user browser.',
      'Prefer tmwd-cdp-bridge because it attaches to the user\'s existing Chrome tabs and logged-in cookies through the installed extension.',
      'Do not use it to bypass captcha, 2FA, payment confirmation, password prompts, or other human-only decisions.',
      'For sensitive actions such as click, type, upload, download, cookie read, raw CDP, header changes, or extension management, provide a clear description; the permission layer will require confirmation.',
      'Start with tabs.read to discover connected tabs, then use tabId for multi-tab workflows so recovery is stable.',
      '',
      'Available backends:',
      backends,
    ].join('\n')
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'Browser'
  },
  isConcurrencySafe(input) {
    return input.capability === 'tabs.read' || input.capability === 'page.read_dom'
  },
  isReadOnly(input) {
    return [
      'tabs.read',
      'page.screenshot',
      'page.read_dom',
      'page.read_console',
      'page.read_network',
    ].includes(input.capability)
  },
  isDestructive(input) {
    return ['page.click', 'page.type', 'files.upload', 'downloads.save'].includes(
      input.capability,
    )
  },
  toAutoClassifierInput(input) {
    return {
      backendId: input.backendId,
      capability: input.capability,
      url: input.url,
      domain: input.domain,
      selector: input.selector,
      cdpMethod: input.cdp?.method,
    }
  },
  async validateInput(input) {
    const backend = BROWSER_CONTROL_BACKENDS.find(
      item => item.id === input.backendId,
    )
    if (!backend) {
      return {
        result: false,
        message: `Unknown browser backend: ${input.backendId}`,
        errorCode: 1,
      }
    }
    if (!backend.capabilities.includes(input.capability)) {
      return {
        result: false,
        message: `${input.backendId} does not support ${input.capability}`,
        errorCode: 2,
      }
    }
    if (['page.click', 'page.type', 'files.upload'].includes(input.capability) && !input.selector) {
      return {
        result: false,
        message: `${input.capability} requires selector`,
        errorCode: 3,
      }
    }
    if (input.capability === 'cdp.call' && !input.cdp?.method) {
      return {
        result: false,
        message: 'cdp.call requires cdp.method',
        errorCode: 4,
      }
    }
    if (input.capability === 'files.upload' && !input.filePath) {
      return {
        result: false,
        message: 'files.upload requires filePath',
        errorCode: 5,
      }
    }
    return { result: true }
  },
  async checkPermissions(input) {
    if (!SENSITIVE_CAPABILITIES.has(input.capability)) {
      return { behavior: 'allow' as const, updatedInput: input }
    }
    return {
      behavior: 'ask' as const,
      message: input.description ?? `Run browser action ${input.capability}`,
      updatedInput: {
        ...input,
        actionUserConfirmed: true,
      },
    }
  },
  renderToolUseMessage() {
    return null
  },
  renderToolUseProgressMessage() {
    return null
  },
  renderToolResultMessage() {
    return null
  },
  async call(input) {
    const request = toBrowserControlRequest(input)
    const result = await executeBrowserControl(request)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.ok) {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: `BrowserControl succeeded on ${output.backendId}.\nDecision: ${jsonStringify(output.decision)}\nAudit: ${output.auditId}\nData: ${jsonStringify(output.data)}`,
      }
    }
    const failure = output as Extract<Output, { ok: false }>
    return {
      type: 'tool_result' as const,
      tool_use_id: toolUseID,
      content: `BrowserControl failed on ${failure.backendId}.\nDecision: ${jsonStringify(failure.decision)}\nAudit: ${failure.auditId}\nError: ${failure.error}`,
      is_error: true as const,
    }
  },
} satisfies ToolDef<InputSchema, Output>)

function toBrowserControlRequest(input: Input): BrowserControlExecuteRequest {
  const confirmed = (input as Input & { actionUserConfirmed?: boolean })
    .actionUserConfirmed
  return {
    backendId: input.backendId,
    action: {
      capability: input.capability,
      url: input.url,
      domain: input.domain,
      description: input.description,
      pageSignals: input.pageSignals,
      userConfirmed: confirmed === true,
    },
    tabId: input.tabId,
    selector: input.selector,
    filePath: input.filePath,
    downloadPath: input.downloadPath,
    text: input.text,
    submit: input.submit,
    fullPage: input.fullPage,
    screenshotFormat: input.screenshotFormat,
    maxContentLength: input.maxContentLength,
    cdp: input.cdp,
    devtools: input.devtools,
    tmwd: input.tmwd,
  }
}

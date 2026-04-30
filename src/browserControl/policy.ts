import type {
  BrowserControlAction,
  BrowserControlBackend,
  BrowserControlCapability,
  BrowserControlDecision,
  BrowserControlPolicy,
  BrowserPageSignal,
} from './types.js'

const HIGH_RISK_CAPABILITIES = new Set<BrowserControlCapability>([
  'storage.read_cookies',
  'cdp.call',
  'headers.modify',
  'extensions.manage',
])

const CONFIRMATION_CAPABILITIES = new Set<BrowserControlCapability>([
  'page.click',
  'page.type',
  'files.upload',
  'downloads.save',
  'storage.read_cookies',
  'cdp.call',
  'headers.modify',
  'extensions.manage',
])

const HUMAN_ONLY_SIGNALS = new Set<BrowserPageSignal>([
  'captcha',
  'two_factor',
  'payment',
  'sensitive_confirmation',
])

export const DEFAULT_BROWSER_CONTROL_POLICY: BrowserControlPolicy = {
  enabled: true,
  allowedDomains: ['*'],
  deniedDomains: [],
  allowHighRiskBackends: true,
  allowHighRiskCapabilities: true,
  requireConfirmationForSensitiveActions: true,
}

export function normalizeBrowserDomain(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ''

  try {
    return new URL(trimmed).hostname.toLowerCase()
  } catch {
    return trimmed.replace(/^\.+/, '').replace(/\.+$/, '')
  }
}

export function getBrowserActionDomain(
  action: BrowserControlAction,
): string | null {
  if (action.domain) return normalizeBrowserDomain(action.domain)
  if (!action.url) return null
  try {
    return new URL(action.url).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function browserDomainMatchesRule(
  domain: string,
  rule: string,
): boolean {
  const normalizedDomain = normalizeBrowserDomain(domain)
  const normalizedRule = normalizeBrowserDomain(rule)

  if (!normalizedDomain || !normalizedRule) return false
  if (normalizedRule === '*') return true
  if (normalizedRule.startsWith('*.')) {
    const suffix = normalizedRule.slice(2)
    return (
      normalizedDomain === suffix || normalizedDomain.endsWith(`.${suffix}`)
    )
  }
  return normalizedDomain === normalizedRule
}

function matchesAnyDomainRule(
  domain: string,
  rules: readonly string[] | undefined,
): boolean {
  return (rules ?? []).some(rule => browserDomainMatchesRule(domain, rule))
}

function deny(reason: string): BrowserControlDecision {
  return { decision: 'deny', reason }
}

function confirm(
  reason: string,
  confirmation: string,
): BrowserControlDecision {
  return { decision: 'confirm', reason, confirmation }
}

function allow(reason: string): BrowserControlDecision {
  return { decision: 'allow', reason }
}

export function assessBrowserControlAction(params: {
  backend: BrowserControlBackend
  action: BrowserControlAction
  policy?: BrowserControlPolicy
}): BrowserControlDecision {
  const policy = {
    ...DEFAULT_BROWSER_CONTROL_POLICY,
    ...(params.policy ?? {}),
  }
  const { backend, action } = params

  if (!policy.enabled) {
    return deny('browser_control_disabled')
  }

  if (!backend.capabilities.includes(action.capability)) {
    return deny('backend_missing_capability')
  }

  if (
    backend.risk === 'high' &&
    backend.requiresExplicitInstall &&
    !policy.allowHighRiskBackends
  ) {
    return deny('high_risk_backend_not_enabled')
  }

  const blockingSignal = action.pageSignals?.find(signal =>
    HUMAN_ONLY_SIGNALS.has(signal),
  )
  if (blockingSignal) {
    return deny(`human_only_page_signal:${blockingSignal}`)
  }

  const domain = getBrowserActionDomain(action)
  if (domain) {
    if (matchesAnyDomainRule(domain, policy.deniedDomains)) {
      return deny('domain_denied')
    }
    if (!matchesAnyDomainRule(domain, policy.allowedDomains)) {
      return deny('domain_not_allowed')
    }
  } else if (
    policy.allowedDomains.length > 0 &&
    action.capability !== 'tabs.read'
  ) {
    return deny('domain_required')
  }

  if (
    HIGH_RISK_CAPABILITIES.has(action.capability) &&
    !policy.allowHighRiskCapabilities
  ) {
    return deny('high_risk_capability_not_enabled')
  }

  if (
    (policy.requireConfirmationForSensitiveActions ?? true) &&
    CONFIRMATION_CAPABILITIES.has(action.capability) &&
    !action.userConfirmed
  ) {
    return confirm(
      'sensitive_action_requires_confirmation',
      `Confirm browser action: ${action.description ?? action.capability}`,
    )
  }

  return allow('policy_allowed')
}

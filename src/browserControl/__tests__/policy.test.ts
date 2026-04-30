import { describe, expect, it } from 'bun:test'
import {
  CLAUDE_IN_CHROME_BACKEND,
  COMPUTER_USE_BACKEND,
  TMWD_CDP_BRIDGE_BACKEND,
} from '../backends.js'
import {
  assessBrowserControlAction,
  browserDomainMatchesRule,
  getBrowserActionDomain,
  normalizeBrowserDomain,
} from '../policy.js'
import type { BrowserControlPolicy } from '../types.js'

const enabledPolicy: BrowserControlPolicy = {
  enabled: true,
  allowedDomains: ['example.com', '*.example.org'],
}

describe('browser control policy', () => {
  it('normalizes domains and matches allowlist rules', () => {
    expect(normalizeBrowserDomain('https://Sub.Example.COM/path')).toBe(
      'sub.example.com',
    )
    expect(getBrowserActionDomain({ capability: 'page.navigate', url: 'https://example.com/a' })).toBe(
      'example.com',
    )
    expect(browserDomainMatchesRule('docs.example.org', '*.example.org')).toBe(
      true,
    )
    expect(browserDomainMatchesRule('example.net', '*.example.org')).toBe(false)
  })

  it('enables BrowserControl by default with wildcard domains', () => {
    const decision = assessBrowserControlAction({
      backend: CLAUDE_IN_CHROME_BACKEND,
      action: {
        capability: 'page.screenshot',
        url: 'https://example.com',
      },
    })

    expect(decision).toEqual({
      decision: 'allow',
      reason: 'policy_allowed',
    })
  })

  it('allows low-risk read actions on allowed domains', () => {
    const decision = assessBrowserControlAction({
      backend: CLAUDE_IN_CHROME_BACKEND,
      policy: enabledPolicy,
      action: {
        capability: 'page.screenshot',
        url: 'https://docs.example.org/page',
      },
    })

    expect(decision).toEqual({
      decision: 'allow',
      reason: 'policy_allowed',
    })
  })

  it('denies domains outside the allowlist and explicit denied domains', () => {
    const outside = assessBrowserControlAction({
      backend: CLAUDE_IN_CHROME_BACKEND,
      policy: enabledPolicy,
      action: {
        capability: 'page.screenshot',
        url: 'https://blocked.test',
      },
    })
    const denied = assessBrowserControlAction({
      backend: CLAUDE_IN_CHROME_BACKEND,
      policy: {
        ...enabledPolicy,
        allowedDomains: ['*'],
        deniedDomains: ['private.example.com'],
      },
      action: {
        capability: 'page.screenshot',
        url: 'https://private.example.com',
      },
    })

    expect(outside).toEqual({
      decision: 'deny',
      reason: 'domain_not_allowed',
    })
    expect(denied).toEqual({
      decision: 'deny',
      reason: 'domain_denied',
    })
  })

  it('requires confirmation for sensitive browser actions', () => {
    const pending = assessBrowserControlAction({
      backend: CLAUDE_IN_CHROME_BACKEND,
      policy: enabledPolicy,
      action: {
        capability: 'page.click',
        url: 'https://example.com',
        description: 'click submit',
      },
    })
    const confirmed = assessBrowserControlAction({
      backend: CLAUDE_IN_CHROME_BACKEND,
      policy: enabledPolicy,
      action: {
        capability: 'page.click',
        url: 'https://example.com',
        description: 'click submit',
        userConfirmed: true,
      },
    })

    expect(pending.decision).toBe('confirm')
    expect(pending.reason).toBe('sensitive_action_requires_confirmation')
    expect(confirmed).toEqual({
      decision: 'allow',
      reason: 'policy_allowed',
    })
  })

  it('treats captcha, two-factor, payment, and sensitive confirmation as human-only', () => {
    for (const signal of [
      'captcha',
      'two_factor',
      'payment',
      'sensitive_confirmation',
    ] as const) {
      const decision = assessBrowserControlAction({
        backend: COMPUTER_USE_BACKEND,
        policy: { ...enabledPolicy, allowedDomains: ['*'] },
        action: {
          capability: 'page.click',
          url: 'https://example.com',
          userConfirmed: true,
          pageSignals: [signal],
        },
      })

      expect(decision).toEqual({
        decision: 'deny',
        reason: `human_only_page_signal:${signal}`,
      })
    }
  })

  it('can explicitly block the TMWebDriver CDP bridge high-risk layers', () => {
    const backendBlocked = assessBrowserControlAction({
      backend: TMWD_CDP_BRIDGE_BACKEND,
      policy: {
        ...enabledPolicy,
        allowedDomains: ['*'],
        allowHighRiskBackends: false,
      },
      action: {
        capability: 'page.screenshot',
        url: 'https://example.com',
      },
    })
    const capabilityBlocked = assessBrowserControlAction({
      backend: TMWD_CDP_BRIDGE_BACKEND,
      policy: {
        ...enabledPolicy,
        allowedDomains: ['*'],
        allowHighRiskBackends: true,
        allowHighRiskCapabilities: false,
      },
      action: {
        capability: 'storage.read_cookies',
        url: 'https://example.com',
        userConfirmed: true,
      },
    })
    const allowed = assessBrowserControlAction({
      backend: TMWD_CDP_BRIDGE_BACKEND,
      policy: {
        ...enabledPolicy,
        allowedDomains: ['*'],
        allowHighRiskBackends: true,
        allowHighRiskCapabilities: true,
      },
      action: {
        capability: 'storage.read_cookies',
        url: 'https://example.com',
        userConfirmed: true,
      },
    })

    expect(backendBlocked).toEqual({
      decision: 'deny',
      reason: 'high_risk_backend_not_enabled',
    })
    expect(capabilityBlocked).toEqual({
      decision: 'deny',
      reason: 'high_risk_capability_not_enabled',
    })
    expect(allowed).toEqual({
      decision: 'allow',
      reason: 'policy_allowed',
    })
  })
})

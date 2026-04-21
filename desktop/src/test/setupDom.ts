import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

type DomTestLockState = {
  tail: Promise<void>
  release: (() => void) | null
}

// Bun's Vitest compatibility layer does not currently expose every helper
// used by the desktop tests. Provide the minimal shims centrally.
;(vi as any).hoisted ??= <T>(factory: () => T) => factory()
;(vi as any).advanceTimersByTimeAsync ??= async (ms: number) => {
  vi.advanceTimersByTime(ms)
  await Promise.resolve()
}

const DOM_TEST_LOCK_KEY = '__cc_haha_dom_test_lock__'
const domTestLockState = ((globalThis as typeof globalThis & {
  [DOM_TEST_LOCK_KEY]?: DomTestLockState
})[DOM_TEST_LOCK_KEY] ??= {
  tail: Promise.resolve(),
  release: null,
})

if (typeof globalThis.window === 'undefined' || typeof globalThis.document === 'undefined') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  const { window } = dom

  Object.assign(globalThis, {
    window,
    self: window,
    document: window.document,
    navigator: window.navigator,
    Document: window.Document,
    HTMLElement: window.HTMLElement,
    HTMLBodyElement: window.HTMLBodyElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    CustomEvent: window.CustomEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame:
      window.requestAnimationFrame?.bind(window) ??
      ((cb: FrameRequestCallback) =>
        setTimeout(() => cb(Date.now()), 16) as unknown as number),
    cancelAnimationFrame:
      window.cancelAnimationFrame?.bind(window) ??
      ((id: number) => clearTimeout(id)),
  })
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.assign(globalThis, { ResizeObserver: ResizeObserverMock })
}

if (typeof globalThis.MutationObserver === 'undefined' && globalThis.window?.MutationObserver) {
  Object.assign(globalThis, {
    MutationObserver: globalThis.window.MutationObserver,
  })
}

if (typeof globalThis.HTMLElement !== 'undefined') {
  const prototype = globalThis.HTMLElement.prototype as {
    attachEvent?: (...args: unknown[]) => void
    detachEvent?: (...args: unknown[]) => void
  }
  prototype.attachEvent ??= () => {}
  prototype.detachEvent ??= () => {}
}

beforeEach(async () => {
  await domTestLockState.tail
  domTestLockState.tail = new Promise<void>((resolve) => {
    domTestLockState.release = resolve
  })
})

afterEach(() => {
  cleanup()
  globalThis.document.body.innerHTML = ''
  domTestLockState.release?.()
  domTestLockState.release = null
})

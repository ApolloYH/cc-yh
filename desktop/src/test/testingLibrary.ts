import './setupDom'

export * from '@testing-library/react'
export { within } from '@testing-library/react'

import {
  cleanup,
  render as rtlRender,
  within,
  type RenderOptions,
} from '@testing-library/react'
import type { ReactElement } from 'react'

export function render(ui: ReactElement, options?: Omit<RenderOptions, 'queries'>) {
  cleanup()
  globalThis.document.body.innerHTML = ''
  return rtlRender(ui, options)
}

export const screen = within(globalThis.document.body)

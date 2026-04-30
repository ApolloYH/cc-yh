import '../test/setupDom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '../test/testingLibrary'
import '@testing-library/jest-dom'

import { Settings } from '../pages/Settings'
import { useSettingsStore } from '../stores/settingsStore'

const createProvider = vi.fn()
const updateProvider = vi.fn()
const testConfig = vi.fn()

vi.mock('../stores/providerStore', () => ({
  useProviderStore: () => ({
    providers: [],
    activeId: null,
    isLoading: false,
    fetchProviders: vi.fn(),
    deleteProvider: vi.fn(),
    activateProvider: vi.fn(),
    activateOfficial: vi.fn(),
    testProvider: vi.fn(),
    createProvider,
    updateProvider,
    testConfig,
  }),
}))

vi.mock('../api/providers', () => ({
  providersApi: {
    authStatus: vi.fn().mockResolvedValue({ connected: false }),
  },
}))

vi.mock('../api/settings', () => ({
  settingsApi: {
    getUser: vi.fn().mockResolvedValue({ env: {} }),
    updateUser: vi.fn().mockResolvedValue({ ok: true }),
  },
}))

vi.mock('../pages/AdapterSettings', () => ({
  AdapterSettings: () => <div>Adapter Settings Mock</div>,
}))

describe('Settings > Provider form', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'zh' })
    createProvider.mockReset()
    updateProvider.mockReset()
    testConfig.mockReset()
  })

  it('allows preset base URL and API format to be edited before saving', () => {
    const { container } = render(<Settings />)

    fireEvent.click(screen.getByText('添加服务商'))
    fireEvent.click(screen.getByText('MiniMax'))

    const baseUrlInput = screen.getByDisplayValue('https://api.minimaxi.com/anthropic') as HTMLInputElement
    expect(baseUrlInput).toBeEnabled()

    fireEvent.change(baseUrlInput, {
      target: { value: 'https://gateway.example.com/openai/v1' },
    })
    expect(baseUrlInput.value).toBe('https://gateway.example.com/openai/v1')

    const apiFormatSelect = container.querySelector('select') as HTMLSelectElement | null
    expect(apiFormatSelect).toBeTruthy()
    expect(apiFormatSelect).toBeEnabled()
    expect(apiFormatSelect?.value).toBe('anthropic')

    fireEvent.change(apiFormatSelect!, { target: { value: 'openai_chat' } })
    expect(apiFormatSelect?.value).toBe('openai_chat')
  })
})

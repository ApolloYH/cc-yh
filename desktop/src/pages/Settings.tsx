import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useProviderStore } from '../stores/providerStore'
import { useTranslation } from '../i18n'
import { Modal } from '../components/shared/Modal'
import { Input } from '../components/shared/Input'
import { Button } from '../components/shared/Button'
import type { PermissionMode, EffortLevel, WebSearchSettings as WebSearchSettingsConfig } from '../types/settings'
import type { Locale } from '../i18n'
import { PROVIDER_PRESETS } from '../config/providerPresets'
import type { ProviderPreset } from '../config/providerPresets'
import type { SavedProvider, UpdateProviderInput, ProviderTestResult, ModelMapping, ApiFormat } from '../types/provider'
import { AdapterSettings } from './AdapterSettings'
import { useAgentStore } from '../stores/agentStore'
import { useSessionStore } from '../stores/sessionStore'
import type { AgentDefinition, AgentSource } from '../api/agents'
import { MarkdownRenderer } from '../components/markdown/MarkdownRenderer'
import { useSkillStore } from '../stores/skillStore'
import { SkillList } from '../components/skills/SkillList'
import { SkillDetail } from '../components/skills/SkillDetail'
import { ComputerUseSettings } from './ComputerUseSettings'
import { UsageSettings } from './UsageSettings'
import { useUIStore, type SettingsTab } from '../stores/uiStore'
import { useUpdateStore } from '../stores/updateStore'
import { settingsApi } from '../api/settings'
import { providersApi, type AuthStatusResponse } from '../api/providers'
import {
  browserControlApi,
  type BrowserControlPolicy,
  type BrowserControlExecutionResult,
} from '../api/browserControl'
import { memoryApi, type MemoryEvent, type MemoryLayer, type MemoryV2Entry, type MemoryV2SearchResult } from '../api/memory'

export function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers')
  const pendingSettingsTab = useUIStore((s) => s.pendingSettingsTab)
  const t = useTranslation()

  useEffect(() => {
    if (!pendingSettingsTab) return
    setActiveTab(pendingSettingsTab)
    useUIStore.getState().setPendingSettingsTab(null)
  }, [pendingSettingsTab])

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-surface)]">
      <div className="flex-1 flex overflow-hidden">
        {/* Tab navigation */}
        <div className="w-[180px] border-r border-[var(--color-border)] py-3 flex-shrink-0 flex flex-col">
          <div className="flex-1">
            <TabButton icon="dns" label={t('settings.tab.providers')} active={activeTab === 'providers'} onClick={() => setActiveTab('providers')} />
            <TabButton icon="shield" label={t('settings.tab.permissions')} active={activeTab === 'permissions'} onClick={() => setActiveTab('permissions')} />
            <TabButton icon="tune" label={t('settings.tab.general')} active={activeTab === 'general'} onClick={() => setActiveTab('general')} />
            <TabButton icon="chat" label={t('settings.tab.adapters')} active={activeTab === 'adapters'} onClick={() => setActiveTab('adapters')} />
            <TabButton icon="smart_toy" label={t('settings.tab.agents')} active={activeTab === 'agents'} onClick={() => setActiveTab('agents')} />
            <TabButton icon="auto_awesome" label={t('settings.tab.skills')} active={activeTab === 'skills'} onClick={() => setActiveTab('skills')} />
            <TabButton icon="language" label={t('settings.tab.browser')} active={activeTab === 'browser'} onClick={() => setActiveTab('browser')} />
            <TabButton icon="travel_explore" label={t('settings.tab.webSearch')} active={activeTab === 'webSearch'} onClick={() => setActiveTab('webSearch')} />
            <TabButton icon="psychology" label={t('settings.tab.memory')} active={activeTab === 'memory'} onClick={() => setActiveTab('memory')} />
            <TabButton icon="mouse" label={t('settings.tab.computerUse')} active={activeTab === 'computerUse'} onClick={() => setActiveTab('computerUse')} />
            <TabButton icon="bar_chart" label="使用统计" active={activeTab === 'usage'} onClick={() => setActiveTab('usage')} />
          </div>
          <div className="border-t border-[var(--color-border)]/40 pt-1">
            <TabButton icon="info" label={t('settings.tab.about')} active={activeTab === 'about'} onClick={() => setActiveTab('about')} />
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {activeTab === 'providers' && <ProviderSettings />}
          {activeTab === 'permissions' && <PermissionSettings />}
          {activeTab === 'general' && <GeneralSettings />}
          {activeTab === 'adapters' && <AdapterSettings />}
          {activeTab === 'agents' && <AgentsSettings />}
          {activeTab === 'skills' && <SkillSettings />}
          {activeTab === 'browser' && <BrowserSettings />}
          {activeTab === 'webSearch' && <WebSearchSettings />}
          {activeTab === 'memory' && <MemorySettings active={activeTab === 'memory'} />}
          {activeTab === 'computerUse' && <ComputerUseSettings />}
          {activeTab === 'usage' && <UsageSettings />}
          {activeTab === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
  )
}

function TabButton({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors ${
        active
          ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] font-medium'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      {label}
    </button>
  )
}

function BrowserSettings() {
  const [policy, setPolicy] = useState<BrowserControlPolicy | null>(null)
  const [tabsResult, setTabsResult] = useState<BrowserControlExecutionResult | null>(null)
  const [diagnostics, setDiagnostics] = useState<Awaited<ReturnType<typeof browserControlApi.status>>['diagnostics'] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isTesting, setIsTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useTranslation()

  useEffect(() => {
    let cancelled = false
    browserControlApi.status()
      .then(result => {
        if (cancelled) return
        setPolicy(result.policy)
        setDiagnostics(result.diagnostics ?? null)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const savePolicy = async (patch: Partial<BrowserControlPolicy>) => {
    setError(null)
    try {
      const result = await browserControlApi.updatePolicy(patch)
      setPolicy(result.policy)
      setDiagnostics(result.diagnostics ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const tabs = extractTabs(tabsResult?.data)

  return (
    <div className="max-w-3xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('settings.browser.title')}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--color-text-tertiary)]">{t('settings.browser.description')}</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setIsTesting(true)
            setError(null)
            browserControlApi.readTabs()
              .then(setTabsResult)
              .catch(err => setError(err instanceof Error ? err.message : String(err)))
              .finally(() => setIsTesting(false))
          }}
          loading={isTesting}
        >
          <span className="material-symbols-outlined text-[16px]">tab</span>
          {t('settings.browser.testTabs')}
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-[var(--color-error)]/25 bg-[var(--color-error)]/6 px-4 py-3 text-sm text-[var(--color-error)]">
          {error}
        </div>
      )}

      {isLoading || !policy ? (
        <div className="py-8 text-sm text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
      ) : (
        <div className="grid gap-4">
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <BrowserToggle label={t('settings.browser.enabled')} detail={t('settings.browser.enabledHint')} checked={policy.enabled} onChange={enabled => void savePolicy({ enabled })} />
              <BrowserToggle
                label={t('settings.browser.highRisk')}
                detail={t('settings.browser.highRiskHint')}
                checked={Boolean(policy.allowHighRiskBackends && policy.allowHighRiskCapabilities)}
                onChange={enabled => void savePolicy({ allowHighRiskBackends: enabled, allowHighRiskCapabilities: enabled })}
              />
              <BrowserToggle
                label={t('settings.browser.confirm')}
                detail={t('settings.browser.confirmHint')}
                checked={policy.requireConfirmationForSensitiveActions !== false}
                onChange={enabled => void savePolicy({ requireConfirmationForSensitiveActions: enabled })}
              />
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">{t('settings.browser.backend')}</div>
                <div className="mt-2 text-sm font-semibold text-[var(--color-text-primary)]">tmwd-cdp-bridge</div>
                <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">{diagnostics?.tmwd.wsUrl ?? 'ws://127.0.0.1:18765'}</div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">TMWD 连接状态</h3>
              <span className={`rounded-full px-2 py-1 text-xs ${diagnostics?.tmwd.connected ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'}`}>
                {diagnostics?.tmwd.connected ? '已连接' : '未连接'}
              </span>
            </div>
            <div className="grid gap-2 text-xs text-[var(--color-text-tertiary)]">
              <div>扩展目录：{diagnostics?.tmwd.installPath ?? 'extensions/tmwd_cdp_bridge'}</div>
              <div>恢复快照：{diagnostics?.recovery.savedTabs ?? 0} 个 tab{diagnostics?.recovery.lastUpdatedAt ? `，最近 ${diagnostics.recovery.lastUpdatedAt}` : ''}</div>
              {(diagnostics?.tmwd.guidance ?? []).map(item => (
                <div key={item} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                  {item}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.browser.currentTabs')}</h3>
              <span className="text-xs text-[var(--color-text-tertiary)]">{tabsResult ? tabsResult.ok ? `${tabs.length} tabs` : tabsResult.error : t('settings.browser.notTested')}</span>
            </div>
            {tabs.length > 0 ? (
              <div className="grid gap-2">
                {tabs.slice(0, 8).map(tab => (
                  <div key={tab.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                    <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">{tab.title || '(untitled)'}</div>
                    <div className="mt-0.5 truncate text-xs text-[var(--color-text-tertiary)]">{tab.url}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-tertiary)]">{t('settings.browser.noTabs')}</p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function BrowserToggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="mt-1 h-4 w-4 accent-[var(--color-brand)]" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--color-text-primary)]">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-[var(--color-text-tertiary)]">{detail}</span>
      </span>
    </label>
  )
}

function extractTabs(data: unknown): Array<{ id: number; title?: string; url?: string }> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const tabs = (data as { tabs?: unknown }).tabs
  if (!Array.isArray(tabs)) return []
  return tabs.filter((tab): tab is { id: number; title?: string; url?: string } =>
    tab !== null && typeof tab === 'object' && typeof (tab as { id?: unknown }).id === 'number',
  )
}

type NormalizedWebSearchSettings = Required<Omit<WebSearchSettingsConfig, 'custom'>> & {
  custom: Required<NonNullable<WebSearchSettingsConfig['custom']>>
}

const DEFAULT_WEB_SEARCH_SETTINGS: NormalizedWebSearchSettings = {
  enabled: true,
  mode: 'auto',
  localProvider: 'duckduckgo',
  maxResults: 8,
  custom: {
    endpoint: '',
    method: 'GET',
    apiKey: '',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    queryParam: 'q',
    headers: {},
    bodyTemplate: '',
    resultsPath: 'results',
    titlePath: 'title',
    urlPath: 'url',
    snippetPath: 'snippet',
  },
}

function WebSearchSettings() {
  const [config, setConfig] = useState<NormalizedWebSearchSettings>(DEFAULT_WEB_SEARCH_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    settingsApi.getUser()
      .then((settings) => {
        if (!cancelled) setConfig(normalizeWebSearchSettings(settings.webSearch))
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const save = async (patch: Partial<WebSearchSettingsConfig>) => {
    const next = normalizeWebSearchSettings({ ...config, ...patch })
    setConfig(next)
    setIsSaving(true)
    setError(null)
    setMessage('')
    try {
      await settingsApi.updateUser({ webSearch: next })
      setMessage('已保存到 ~/.claude-yh/settings.json。CLI 同步命令：/web-search status、/web-search provider custom。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Web 搜索</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--color-text-tertiary)]">
          非 Claude 官方服务商不能使用 Anthropic 服务端 web_search。这里可以配置本地 DuckDuckGo fallback，或接入你购买的第三方搜索 JSON API。
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-[var(--color-error)]/25 bg-[var(--color-error)]/6 px-4 py-3 text-sm text-[var(--color-error)]">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 rounded-xl border border-[var(--color-success)]/25 bg-[var(--color-success)]/8 px-4 py-3 text-sm text-[var(--color-success)]">
          {message}
        </div>
      )}

      {isLoading ? (
        <div className="py-8 text-sm text-[var(--color-text-tertiary)]">加载中...</div>
      ) : (
        <div className="grid gap-4">
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <BrowserToggle
                label="启用 WebSearch"
                detail="模型可以调用 WebSearch 工具；关闭后所有服务商都不会搜索。"
                checked={config.enabled}
                onChange={enabled => void save({ enabled, mode: enabled ? config.mode === 'off' ? 'auto' : config.mode : 'off' })}
              />
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <label className="text-sm font-medium text-[var(--color-text-primary)]">搜索模式</label>
                <select
                  value={config.mode}
                  disabled={isSaving}
                  onChange={event => void save({ mode: event.target.value as NormalizedWebSearchSettings['mode'], enabled: event.target.value !== 'off' })}
                  className="mt-2 h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                >
                  <option value="auto">自动：Claude 服务端优先，本地 provider fallback</option>
                  <option value="anthropic">只用 Anthropic 服务端搜索</option>
                  <option value="local">只用本地 provider</option>
                  <option value="off">关闭</option>
                </select>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <label className="text-sm font-medium text-[var(--color-text-primary)]">本地 Provider</label>
                <select
                  value={config.localProvider}
                  disabled={isSaving}
                  onChange={event => void save({ localProvider: event.target.value as NormalizedWebSearchSettings['localProvider'] })}
                  className="mt-2 h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                >
                  <option value="duckduckgo">DuckDuckGo HTML fallback</option>
                  <option value="custom">第三方搜索 JSON API</option>
                </select>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
                  选 custom 后，模型调用 WebSearch 时会请求你配置的第三方搜索服务，不走 Claude 服务端搜索。
                </p>
              </div>
              <label className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">最大结果数</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={config.maxResults}
                  disabled={isSaving}
                  onChange={event => void save({ maxResults: Number.parseInt(event.target.value, 10) || 8 })}
                  className="mt-2 h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                />
              </label>
            </div>
          </section>

          {config.localProvider === 'custom' && (
            <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">第三方搜索 API</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
                  支持 GET 或 POST JSON。结果会按下面的 JSON path 解析成 title/url/snippet。
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <TextSetting
                  label="Endpoint"
                  value={config.custom.endpoint}
                  placeholder="https://api.example.com/search"
                  disabled={isSaving}
                  onBlur={endpoint => void save({ custom: { ...config.custom, endpoint } })}
                />
                <label className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">Method</span>
                  <select
                    value={config.custom.method}
                    disabled={isSaving}
                    onChange={event => void save({ custom: { ...config.custom, method: event.target.value as 'GET' | 'POST' } })}
                    className="mt-2 h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                  </select>
                </label>
                <TextSetting
                  label="API Key"
                  type="password"
                  value={config.custom.apiKey}
                  placeholder="sk-..."
                  disabled={isSaving}
                  onBlur={apiKey => void save({ custom: { ...config.custom, apiKey } })}
                />
                <TextSetting
                  label="认证 Header"
                  value={config.custom.authHeader}
                  placeholder="Authorization 或 X-API-Key"
                  disabled={isSaving}
                  onBlur={authHeader => void save({ custom: { ...config.custom, authHeader } })}
                />
                <TextSetting
                  label="认证前缀"
                  value={config.custom.authPrefix}
                  placeholder="Bearer；如果服务商不需要前缀就留空"
                  disabled={isSaving}
                  onBlur={authPrefix => void save({ custom: { ...config.custom, authPrefix } })}
                />
                <TextSetting
                  label="GET 查询参数"
                  value={config.custom.queryParam}
                  placeholder="q"
                  disabled={isSaving}
                  onBlur={queryParam => void save({ custom: { ...config.custom, queryParam } })}
                />
                <TextSetting
                  label="结果数组 path"
                  value={config.custom.resultsPath}
                  placeholder="results 或 data.items"
                  disabled={isSaving}
                  onBlur={resultsPath => void save({ custom: { ...config.custom, resultsPath } })}
                />
                <TextSetting
                  label="标题 path"
                  value={config.custom.titlePath}
                  placeholder="title"
                  disabled={isSaving}
                  onBlur={titlePath => void save({ custom: { ...config.custom, titlePath } })}
                />
                <TextSetting
                  label="URL path"
                  value={config.custom.urlPath}
                  placeholder="url 或 link"
                  disabled={isSaving}
                  onBlur={urlPath => void save({ custom: { ...config.custom, urlPath } })}
                />
                <TextSetting
                  label="摘要 path"
                  value={config.custom.snippetPath}
                  placeholder="snippet 或 content"
                  disabled={isSaving}
                  onBlur={snippetPath => void save({ custom: { ...config.custom, snippetPath } })}
                />
              </div>
              <label className="mt-3 block rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">POST Body 模板</span>
                <textarea
                  value={config.custom.bodyTemplate}
                  disabled={isSaving}
                  placeholder={'{"query":"{{query}}","limit":{{maxResults}}}'}
                  onChange={event => setConfig({ ...config, custom: { ...config.custom, bodyTemplate: event.target.value } })}
                  onBlur={event => void save({ custom: { ...config.custom, bodyTemplate: event.target.value } })}
                  rows={3}
                  className="mt-2 w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                />
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
                  可用变量：{'{{query}}'}、{'{{maxResults}}'}。GET 模式会忽略这个模板。
                </p>
              </label>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function normalizeWebSearchSettings(value: unknown): NormalizedWebSearchSettings {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as WebSearchSettingsConfig
    : {}
  const mode = input.mode === 'anthropic' || input.mode === 'local' || input.mode === 'off'
    ? input.mode
    : 'auto'
  const maxResults = typeof input.maxResults === 'number'
    ? Math.max(1, Math.min(20, Math.floor(input.maxResults)))
    : DEFAULT_WEB_SEARCH_SETTINGS.maxResults
  return {
    enabled: input.enabled !== false && mode !== 'off',
    mode,
    localProvider: input.localProvider === 'custom' ? 'custom' : 'duckduckgo',
    maxResults,
    custom: {
      ...DEFAULT_WEB_SEARCH_SETTINGS.custom,
      ...(input.custom ?? {}),
      method: input.custom?.method === 'POST' ? 'POST' : 'GET',
      headers: input.custom?.headers ?? {},
    },
  }
}

function TextSetting(props: {
  label: string
  value: string
  placeholder?: string
  disabled?: boolean
  type?: string
  onBlur: (value: string) => void
}) {
  const [value, setValue] = useState(props.value)

  useEffect(() => {
    setValue(props.value)
  }, [props.value])

  return (
    <label className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <span className="text-sm font-medium text-[var(--color-text-primary)]">{props.label}</span>
      <input
        type={props.type ?? 'text'}
        value={value}
        disabled={props.disabled}
        placeholder={props.placeholder}
        onChange={event => setValue(event.target.value)}
        onBlur={() => props.onBlur(value)}
        className="mt-2 h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
      />
    </label>
  )
}

// ─── Provider Settings ──────────────────────────────────────

function memoryLayerLabel(layer: MemoryLayer): string {
  switch (layer) {
    case 'L1':
      return 'L1 索引'
    case 'L2':
      return 'L2 事实'
    case 'L3':
      return 'L3 SOP 和 Skill'
    case 'L4':
      return 'L4 会话归档'
  }
}

function MemorySettings({ active }: { active: boolean }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof memoryApi.status>> | null>(null)
  const [selected, setSelected] = useState<{ layer: MemoryLayer; id: string } | null>(null)
  const [entry, setEntry] = useState<MemoryV2Entry | null>(null)
  const [content, setContent] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemoryV2SearchResult[]>([])
  const [memoryEvents, setMemoryEvents] = useState<MemoryEvent[]>([])
  const [memoryEventsPath, setMemoryEventsPath] = useState('')
  const [expandedMemoryLayers, setExpandedMemoryLayers] = useState<Partial<Record<MemoryLayer, boolean>>>({
    L1: true,
    L2: true,
    L3: true,
    L4: false,
  })
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = async () => {
    const [next, events] = await Promise.all([
      memoryApi.status(),
      memoryApi.events(50),
    ])
    setStatus(next)
    setMemoryEvents(events.events)
    setMemoryEventsPath(events.path)
    if (!selected) {
      const first = next.layers[0]?.entries[0]
      if (first) setSelected({ layer: first.layer, id: first.id })
    }
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([memoryApi.status(), memoryApi.events(50)])
      .then(next => {
        if (cancelled) return
        setStatus(next[0])
        setMemoryEvents(next[1].events)
        setMemoryEventsPath(next[1].path)
        const first = next[0].layers[0]?.entries[0]
        if (first) setSelected({ layer: first.layer, id: first.id })
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setError(null)
    Promise.all([memoryApi.status(), memoryApi.events(50)])
      .then(next => {
        if (cancelled) return
        setStatus(next[0])
        setMemoryEvents(next[1].events)
        setMemoryEventsPath(next[1].path)
        if (!selected) {
          const first = next[0].layers[0]?.entries[0]
          if (first) setSelected({ layer: first.layer, id: first.id })
        }
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  // Deliberately refresh when the tab becomes active. Do not depend on selected,
  // otherwise selecting an entry triggers a full status reload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setError(null)
    memoryApi.entry(selected.layer, selected.id)
      .then(result => {
        if (cancelled) return
        setEntry(result.entry)
        setContent(result.entry.content || '')
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => { cancelled = true }
  }, [selected])

  const runAction = async (action: () => Promise<string>) => {
    setIsWorking(true)
    setError(null)
    try {
      setMessage(await action())
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsWorking(false)
    }
  }

  const saveEntry = async () => {
    if (!selected || !entry) return
    await runAction(async () => {
      const result = await memoryApi.updateEntry({
        layer: selected.layer,
        id: selected.id,
        title: entry.title,
        source: entry.source,
        content,
      })
      setEntry(result.entry)
      setContent(result.entry.content || '')
      return `已保存 ${result.entry.layer}/${result.entry.id}`
    })
  }

  const doSearch = async () => {
    if (!query.trim()) return
    setIsWorking(true)
    setError(null)
    try {
      const result = await memoryApi.search(query)
      setResults(result.results)
      setMessage(`搜索返回 ${result.results.length} 条结果。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">记忆</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--color-text-tertiary)]">L1 索引、L2 事实、L3 SOP 和 Skill、L4 会话归档；摘要和沉淀会在会话流程中自动完成。</p>
        {status && (
          <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
            当前目录：{status.root} · L1：{status.indexPath}
          </p>
        )}
      </div>

      {error && <div className="mb-4 rounded-xl border border-[var(--color-error)]/25 bg-[var(--color-error)]/6 px-4 py-3 text-sm text-[var(--color-error)]">{error}</div>}
      {message && <div className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">{message}</div>}

      {isLoading || !status ? (
        <div className="py-8 text-sm text-[var(--color-text-tertiary)]">加载中...</div>
      ) : (
        <div className="grid gap-4">
          <section className="grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4 md:grid-cols-3">
            <MemoryMeta label="检索方式" value="关键词检索" />
            <MemoryMeta label="长期记忆" value={`${status.facts.length} 条事实 / ${status.sops.length} 条 SOP 与 Skill`} />
            <MemoryMeta label="会话归档" value={`${status.layers.find(layer => layer.layer === 'L4')?.entries.length ?? 0} 条`} />
          </section>
          <MemoryEventsPanel
            events={memoryEvents}
            path={memoryEventsPath}
            onRefresh={() => void reload()}
            isLoading={isWorking}
          />
          <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-3">
            <div className="mb-3 flex gap-2">
              <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索记忆..." />
              <Button size="sm" onClick={() => void doSearch()} loading={isWorking}>
                <span className="material-symbols-outlined text-[16px]">search</span>
              </Button>
            </div>
            {results.length > 0 && (
              <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
                <div className="mb-1 text-xs font-medium text-[var(--color-text-tertiary)]">关键词搜索</div>
                {results.slice(0, 5).map(result => (
                  <button key={`${result.entry.layer}-${result.entry.id}`} onClick={() => setSelected({ layer: result.entry.layer, id: result.entry.id })} className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
                    {result.entry.layer}/{result.entry.id} · 得分 {result.score.toFixed(2)}
                  </button>
                ))}
              </div>
            )}
            <div className="space-y-3">
              {status.layers.map(layer => {
                const expanded = expandedMemoryLayers[layer.layer] ?? layer.layer !== 'L4'
                const limit = collapsedMemoryLayerLimit(layer.layer)
                const visibleEntries = expanded ? layer.entries : layer.entries.slice(0, limit)
                const hiddenCount = Math.max(0, layer.entries.length - visibleEntries.length)
                return (
                  <div key={layer.layer}>
                    <button
                      type="button"
                      onClick={() => setExpandedMemoryLayers(prev => ({ ...prev, [layer.layer]: !expanded }))}
                      className="mb-1 flex w-full items-center justify-between rounded-md px-1 py-1 text-left text-xs font-semibold text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"
                    >
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">{expanded ? 'expand_more' : 'chevron_right'}</span>
                        <span className="truncate">{memoryLayerLabel(layer.layer)}</span>
                      </span>
                      <span>{layer.entries.length}</span>
                    </button>
                    {expanded || visibleEntries.length > 0 ? (
                      <div className="space-y-1">
                        {visibleEntries.map(item => (
                          <button
                            key={`${item.layer}-${item.id}`}
                            onClick={() => setSelected({ layer: item.layer, id: item.id })}
                            className={`block w-full rounded-lg border px-3 py-2 text-left ${selected?.layer === item.layer && selected.id === item.id ? 'border-[var(--color-brand)] bg-[var(--color-primary-fixed)]' : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'}`}
                          >
                            <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">{item.title}</div>
                            <div className="mt-0.5 truncate text-xs text-[var(--color-text-tertiary)]">{item.id}</div>
                          </button>
                        ))}
                        {hiddenCount > 0 && (
                          <button
                            type="button"
                            onClick={() => setExpandedMemoryLayers(prev => ({ ...prev, [layer.layer]: true }))}
                            className="block w-full rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left text-xs text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"
                          >
                            展开剩余 {hiddenCount} 条
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
            {entry ? (
              <div className="flex h-full min-h-[620px] flex-col">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[var(--color-text-tertiary)]">{entry.layer}/{entry.id}</div>
                    <h3 className="mt-1 truncate text-base font-semibold text-[var(--color-text-primary)]">{entry.title}</h3>
                    <p className="mt-1 truncate text-xs text-[var(--color-text-tertiary)]">{entry.path}</p>
                  </div>
                  <Button size="sm" onClick={() => void saveEntry()} loading={isWorking}>
                    <span className="material-symbols-outlined text-[16px]">save</span>
                    保存
                  </Button>
                </div>
                <div className="mb-3 grid gap-2 md:grid-cols-2">
                  <MemoryMeta label="已验证" value={entry.verified ? '是' : '否'} />
                  <MemoryMeta label="更新时间" value={entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : '未知'} />
                </div>
                {entry.summary && <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">{entry.summary}</div>}
                <textarea
                  value={content}
                  onChange={event => setContent(event.target.value)}
                  className="min-h-[420px] flex-1 resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 font-mono text-sm leading-6 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                />
              </div>
            ) : (
              <div className="py-8 text-sm text-[var(--color-text-tertiary)]">请选择一条记忆。</div>
            )}
          </section>
        </div>
        </div>
      )}
    </div>
  )
}

function MemoryMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <div className="text-xs text-[var(--color-text-tertiary)]">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-[var(--color-text-primary)]">{value}</div>
    </div>
  )
}

function collapsedMemoryLayerLimit(layer: MemoryLayer): number {
  if (layer === 'L4') return 6
  if (layer === 'L1') return 1
  return 8
}

function MemoryEventsPanel({
  events,
  path,
  onRefresh,
  isLoading,
}: {
  events: MemoryEvent[]
  path: string
  onRefresh: () => void
  isLoading: boolean
}) {
  const [showProcessEvents, setShowProcessEvents] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const resultEvents = events.filter(isResultMemoryEvent)
  const visibleSource = showProcessEvents || resultEvents.length === 0 ? events : resultEvents
  const groupedEvents = useMemo(() => groupMemoryEventRecords(visibleSource), [visibleSource])
  const visibleGroups = groupedEvents.slice(0, showProcessEvents ? 50 : 8)
  const hiddenProcessCount = Math.max(0, events.length - resultEvents.length)
  const hiddenVisibleCount = Math.max(0, groupedEvents.length - visibleGroups.length)

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">记忆更新记录</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
            默认按会话合并展示最近一次整理结果；展开卡片可以查看该会话下的模型抽取、跳过原因和整理明细。
          </p>
          {path && <p className="mt-1 truncate text-xs text-[var(--color-text-tertiary)]">{path}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {hiddenProcessCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowProcessEvents(value => !value)}
            >
              {showProcessEvents ? '隐藏过程' : `显示过程 ${hiddenProcessCount}`}
            </Button>
          )}
          <Button size="sm" onClick={onRefresh} loading={isLoading}>刷新记录</Button>
        </div>
      </div>
      {events.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-tertiary)]">
          暂无记忆抽取记录。关闭会话、切换会话、退出应用，或长会话到达 checkpoint 后会写入记录。
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {visibleGroups.map(group => {
            const event = group.latest
            const expanded = expandedGroups[group.key] ?? false
            return (
              <div key={group.key} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                <button
                  type="button"
                  onClick={() => setExpandedGroups(prev => ({ ...prev, [group.key]: !expanded }))}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <div className="min-w-0 truncate text-sm font-medium text-[var(--color-text-primary)]">
                    {group.title}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {group.events.length > 1 && (
                      <span className="rounded-full bg-[var(--color-surface-container-low)] px-2 py-0.5 text-xs text-[var(--color-text-tertiary)]">
                        {group.events.length} 条
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-xs ${event.ok === false || event.severity === 'error' ? 'bg-red-500/10 text-red-700' : event.severity === 'warn' ? 'bg-amber-500/10 text-amber-700' : 'bg-emerald-500/10 text-emerald-700'}`}>
                      {event.ok === false || event.severity === 'error' ? '失败' : event.severity === 'warn' ? '提醒' : '正常'}
                    </span>
                    <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">{expanded ? 'expand_less' : 'expand_more'}</span>
                  </div>
                </button>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-tertiary)]">
                  {event.timestamp && <span>{new Date(event.timestamp).toLocaleString()}</span>}
                  {typeof event.durationMs === 'number' && <span>{event.durationMs} ms</span>}
                  {!expanded && <span className="truncate">{memoryEventBrief(event)}</span>}
                </div>
                {event.error && <div className="mt-1 truncate text-xs text-[var(--color-error)]" title={event.error}>{event.error}</div>}
                {expanded && (
                  <div className="mt-2 max-h-72 overflow-auto rounded-md bg-[var(--color-surface-container-low)] px-2 py-2">
                    {group.events.map((item, itemIndex) => (
                      <div
                        key={memoryEventKey(item, itemIndex)}
                        className={itemIndex > 0 ? 'mt-3 border-t border-[var(--color-border)] pt-3' : ''}
                        title={JSON.stringify(item.data ?? {}, null, 2)}
                      >
                        <div className="mb-1 flex flex-wrap gap-2 text-xs text-[var(--color-text-tertiary)]">
                          {item.timestamp && <span>{new Date(item.timestamp).toLocaleString()}</span>}
                          {typeof item.durationMs === 'number' && <span>{item.durationMs} ms</span>}
                        </div>
                        <pre className="whitespace-pre-wrap break-words font-mono text-xs text-[var(--color-text-tertiary)]">
                          {formatMemoryEventData(item)}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {hiddenVisibleCount > 0 && (
            <button
              type="button"
              onClick={() => setShowProcessEvents(true)}
              className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-left text-sm text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"
            >
              展开剩余 {hiddenVisibleCount} 个会话
            </button>
          )}
        </div>
      )}
    </section>
  )
}

type MemoryEventRecordGroup = {
  key: string
  title: string
  latest: MemoryEvent
  events: MemoryEvent[]
}

function groupMemoryEventRecords(events: MemoryEvent[]): MemoryEventRecordGroup[] {
  const map = new Map<string, MemoryEventRecordGroup>()
  for (const event of events) {
    const key = memoryEventGroupKey(event)
    const existing = map.get(key)
    if (existing) {
      existing.events.push(event)
      continue
    }
    map.set(key, {
      key,
      title: compactMemoryEventTitle(memoryEventSessionTitle(event.data) || memoryEventName(event)),
      latest: event,
      events: [event],
    })
  }
  return Array.from(map.values())
}

function memoryEventGroupKey(event: MemoryEvent): string {
  const data = event.data ?? {}
  if (typeof data.sessionId === 'string' && data.sessionId) return `session:${data.sessionId}`
  if (typeof data.entryId === 'string' && data.entryId.startsWith('session-')) return `session:${data.entryId.slice('session-'.length)}`
  if (typeof data.entryId === 'string' && data.entryId) return `entry:${data.entryId}`
  const title = memoryEventSessionTitle(data)
  if (title) return `title:${title}`
  return `event:${event.scope ?? ''}/${event.event ?? ''}/${event.timestamp ?? ''}`
}
function memoryEventKey(event: MemoryEvent, index: number): string {
  return [
    event.timestamp ?? index,
    event.scope ?? '',
    event.event ?? '',
    typeof event.data?.sessionId === 'string' ? event.data.sessionId : '',
  ].join('|')
}

function isResultMemoryEvent(event: MemoryEvent): boolean {
  if (event.ok === false || event.severity === 'error' || event.severity === 'warn') return true
  const key = `${event.scope ?? ''}/${event.event ?? ''}`
  return [
    '/completed',
    '/failed',
    'memoryV2.session/finalize_completed',
    'memoryV2.session/finalize_skipped',
    'memoryV2.session/finalize_failed',
    'memoryV2.distill/model_extract_completed',
    'memoryV2.distill/model_extract_skipped',
    'memoryV2.distill/model_extract_failed',
  ].includes(key)
}

function memoryEventBrief(event: MemoryEvent): string {
  const data = event.data ?? {}
  const title = memoryEventSessionTitle(data)
  const result = data.result && typeof data.result === 'object'
    ? data.result as Record<string, unknown>
    : null
  const parts: string[] = []
  if (title) parts.push(`会话：${compactMemoryEventTitle(title)}`)
  if (typeof data.reason === 'string') parts.push(`原因：${compactEventValue(data.reason)}`)
  if (typeof data.decision === 'string') parts.push(`判断：${data.decision}`)
  if (typeof data.acceptedCandidates === 'number') parts.push(`接受 ${data.acceptedCandidates}`)
  if (typeof data.rawCandidates === 'number') parts.push(`返回 ${data.rawCandidates}`)
  if (typeof data.messageCount === 'number') parts.push(`消息：${data.messageCount}`)
  if (result) {
    parts.push(`摘要 ${String(result.summaries ?? 0)}`)
    parts.push(`候选 ${String(result.candidates ?? 0)}`)
    parts.push(`写入 ${String(result.applied ?? 0)}`)
  }
  if (typeof event.error === 'string') parts.push(event.error)
  return parts.join(' · ')
}

function formatMemoryEventData(event: MemoryEvent): string {
  const data = event.data ?? {}
  const lines: string[] = []
  const title = memoryEventSessionTitle(data)
  if (title) lines.push(`会话：${title}`)
  lines.push(`事件：${memoryEventName(event)}`)
  if (typeof data.sessionId === 'string') lines.push(`ID：${data.sessionId}`)
  if (typeof data.reason === 'string') lines.push(`原因：${data.reason}`)
  if (typeof data.skipped === 'string') lines.push(`跳过：${data.skipped}`)
  if (typeof data.messageCount === 'number') lines.push(`消息数：${data.messageCount}`)
  if (typeof data.decision === 'string') lines.push(`模型判断：${data.decision}`)
  if (typeof data.model === 'string') lines.push(`模型：${data.model}`)
  if (typeof data.modelSource === 'string') lines.push(`模型来源：${data.modelSource}`)
  if (typeof data.rawCandidates === 'number' || typeof data.acceptedCandidates === 'number') {
    lines.push(`模型候选：返回=${String(data.rawCandidates ?? 0)}，接受=${String(data.acceptedCandidates ?? 0)}，拒绝=${String(data.rejectedCandidates ?? 0)}`)
  }
  appendStringArray(lines, '接受标题', data.acceptedTitles)
  appendCandidateDetails(lines, data.candidateDetails)
  if (typeof data.parsedJson === 'string') {
    lines.push('模型 JSON：')
    lines.push(data.parsedJson)
  } else if (typeof data.modelOutput === 'string') {
    lines.push('模型原始返回：')
    lines.push(data.modelOutput)
  }

  const result = data.result && typeof data.result === 'object'
    ? data.result as Record<string, unknown>
    : null
  if (result) {
    const counts = [
      ['summaries', '摘要'],
      ['candidates', '候选'],
      ['applied', '写入'],
      ['skills', '技能'],
    ] as const
    const summary = counts
      .map(([key, label]) => `${label}=${String(result[key] ?? 0)}`)
      .join('，')
    lines.push(`结果：${summary}`)
    for (const [key, label] of [
      ['summaryTitles', '摘要标题'],
      ['candidateTitles', '候选标题'],
      ['appliedTitles', '写入标题'],
    ] as const) {
      const value = result[key]
      if (Array.isArray(value) && value.length > 0) {
        lines.push(`${label}：${value.map(String).join(' / ')}`)
      }
    }
    if (typeof result.skipped === 'string') lines.push(`跳过：${result.skipped}`)
  }
  if (lines.length > 0) return lines.join('\n')
  const text = JSON.stringify(data)
  return text.length > 420 ? `${text.slice(0, 417)}...` : text
}

function appendStringArray(lines: string[], label: string, value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) return
  lines.push(`${label}：${value.map(String).join(' / ')}`)
}

function appendCandidateDetails(lines: string[], value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) return
  lines.push('候选详情：')
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const title = typeof record.title === 'string' ? record.title : '未命名'
    const layer = typeof record.layer === 'string' ? record.layer : '未知层级'
    const confidence = typeof record.confidence === 'number' ? `，置信度=${record.confidence}` : ''
    const reason = typeof record.reason === 'string' ? `，原因=${record.reason}` : ''
    lines.push(`- ${layer}：${title}${confidence}${reason}`)
  }
}

function compactEventValue(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const chars = Array.from(normalized)
  return chars.length > 28 ? `${chars.slice(0, 28).join('')}...` : normalized
}

function memoryEventSessionTitle(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null
  if (typeof data.sessionTitle === 'string' && data.sessionTitle.trim()) {
    return data.sessionTitle.trim()
  }
  if (typeof data.entryTitle === 'string' && data.entryTitle.trim()) {
    return data.entryTitle.trim()
  }
  if (typeof data.title === 'string' && data.title.trim()) {
    return data.title.trim()
  }
  const result = data.result && typeof data.result === 'object'
    ? data.result as Record<string, unknown>
    : null
  const summaryTitles = result?.summaryTitles
  if (Array.isArray(summaryTitles)) {
    const first = summaryTitles.find((item): item is string => typeof item === 'string' && item.trim().length > 0)
    if (first) return first.trim()
  }
  return null
}

function memoryEventName(event: MemoryEvent): string {
  const key = `${event.scope ?? ''}/${event.event ?? ''}`
  switch (key) {
    case 'memoryV2.session/finalize_started':
      return '开始整理会话记忆'
    case 'memoryV2.session/finalize_completed':
      return '会话记忆整理完成'
    case 'memoryV2.session/finalize_skipped':
      return '会话记忆无需更新'
    case 'memoryV2.session/finalize_failed':
      return '会话记忆整理失败'
    case 'memoryV2.automation/scheduled':
      return '已安排自动记忆整理'
    case 'memoryV2.automation/flush_scheduled':
      return '执行待处理记忆任务'
    case 'memoryV2.automation/completed':
      return '自动记忆整理完成'
    case 'memoryV2.automation/failed':
      return '自动记忆整理失败'
    case 'memoryV2.distill/model_extract_completed':
      return '模型抽取结果'
    case 'memoryV2.distill/model_extract_skipped':
      return '模型抽取跳过'
    case 'memoryV2.distill/model_extract_failed':
      return '模型抽取失败'
    default:
      return [event.scope, event.event].filter(Boolean).join(' / ') || 'memory'
  }
}

function compactMemoryEventTitle(title: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim()
  const chars = Array.from(normalized)
  return chars.length > 12 ? `${chars.slice(0, 12).join('')}...` : normalized
}

function ProviderSettings() {
  const { providers, activeId, isLoading, fetchProviders, deleteProvider, activateProvider, testProvider } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const t = useTranslation()
  const [editingProvider, setEditingProvider] = useState<SavedProvider | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [testResults, setTestResults] = useState<Record<string, { loading: boolean; result?: ProviderTestResult }>>({})
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null)

  useEffect(() => { fetchProviders() }, [fetchProviders])
  useEffect(() => {
    let cancelled = false

    const loadAuthStatus = async () => {
      try {
        const status = await providersApi.authStatus()
        if (!cancelled) setAuthStatus(status)
      } catch {
        if (!cancelled) setAuthStatus(null)
      }
    }

    void loadAuthStatus()
    return () => { cancelled = true }
  }, [providers, activeId])

  const handleDelete = async (provider: SavedProvider) => {
    if (activeId === provider.id) return
    if (!window.confirm(t('settings.providers.confirmDelete', { name: provider.name }))) return
    await deleteProvider(provider.id).catch(console.error)
  }

  const handleTest = async (provider: SavedProvider) => {
    setTestResults((r) => ({ ...r, [provider.id]: { loading: true } }))
    try {
      const result = await testProvider(provider.id)
      setTestResults((r) => ({ ...r, [provider.id]: { loading: false, result } }))
    } catch {
      setTestResults((r) => ({ ...r, [provider.id]: { loading: false, result: { connectivity: { success: false, latencyMs: 0, error: t('settings.providers.requestFailed') } } } }))
    }
  }

  const handleActivate = async (id: string) => {
    await activateProvider(id)
    await fetchSettings()
  }

  const externalProvider = !activeId && authStatus?.hasAuth ? authStatus.effectiveProvider : null
  const externalSourceLabel = authStatus?.effectiveProvider?.source === 'original-settings'
    ? t('settings.providers.sourceOriginalSettings')
    : t('settings.providers.sourceEnv')

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('settings.providers.title')}</h2>
          <p className="text-sm text-[var(--color-text-tertiary)] mt-0.5">{t('settings.providers.description')}</p>
        </div>
        <Button size="sm" onClick={() => setShowCreateModal(true)}>
          <span className="material-symbols-outlined text-[16px]">add</span>
          {t('settings.providers.addProvider')}
        </Button>
      </div>

      {/* Official provider — always visible at top */}
      {externalProvider && (
        <div className="relative flex items-center gap-4 px-4 py-3.5 rounded-xl border border-[var(--color-brand)] bg-[var(--color-primary-fixed)] mb-2">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-[var(--color-success)]" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{externalProvider.name}</span>
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[var(--color-brand)] text-white leading-none">{t('common.active')}</span>
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)] leading-none">
                {externalProvider.apiFormat === 'openai_chat'
                  ? 'OpenAI Chat'
                  : externalProvider.apiFormat === 'openai_responses'
                    ? 'OpenAI Responses'
                    : 'Anthropic'}
              </span>
              {externalProvider.readOnly && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--color-surface-container-high)] text-[var(--color-warning)] leading-none">
                  {t('settings.providers.readOnly')}
                </span>
              )}
            </div>
            <div className="text-xs text-[var(--color-text-tertiary)] truncate mt-0.5">
              {([externalProvider.baseUrl, externalProvider.modelId].filter(Boolean).join(' · ')) || externalSourceLabel}
            </div>
          </div>
        </div>
      )}

      {/* Saved providers */}
      {isLoading && providers.length === 0 ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {providers.map((provider) => {
            const isActive = activeId === provider.id
            const test = testResults[provider.id]
            const preset = PROVIDER_PRESETS.find((p) => p.id === provider.presetId)
            return (
              <div
                key={provider.id}
                className={`relative flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all group ${
                  isActive
                    ? 'border-[var(--color-brand)] bg-[var(--color-primary-fixed)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-border-focus)]'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isActive ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-tertiary)]'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{provider.name}</span>
                    {preset && preset.id !== 'custom' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)] leading-none">{preset.name}</span>
                    )}
                    {provider.apiFormat && provider.apiFormat !== 'anthropic' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--color-surface-container-high)] text-[var(--color-warning)] leading-none">
                        {provider.apiFormat === 'openai_chat' ? 'OpenAI Chat' : 'OpenAI Responses'}
                      </span>
                    )}
                    {isActive && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[var(--color-brand)] text-white leading-none">{t('common.active')}</span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-text-tertiary)] truncate mt-0.5">
                    {provider.baseUrl} &middot; {provider.models.main}
                  </div>
                  {test && !test.loading && test.result && (
                    <div className="text-xs mt-1 flex flex-col gap-0.5">
                      <span className={test.result.connectivity.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>
                        {test.result.connectivity.success
                          ? t('settings.providers.connectivityOk', { latency: String(test.result.connectivity.latencyMs) })
                          : t('settings.providers.connectivityFailed', { error: test.result.connectivity.error || '' })}
                      </span>
                      {test.result.proxy && (
                        <span className={test.result.proxy.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>
                          {test.result.proxy.success
                            ? t('settings.providers.proxyOk', { latency: String(test.result.proxy.latencyMs) })
                            : t('settings.providers.proxyFailed', { error: test.result.proxy.error || '' })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  {!isActive && (
                    <Button variant="ghost" size="sm" onClick={() => handleActivate(provider.id)}>{t('settings.providers.activate')}</Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => handleTest(provider)} loading={test?.loading}>{t('settings.providers.test')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingProvider(provider)}>{t('settings.providers.edit')}</Button>
                  {!isActive && (
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(provider)} className="text-[var(--color-error)] hover:text-[var(--color-error)]">{t('common.delete')}</Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Modal — conditionally rendered so state resets on close */}
      {showCreateModal && (
        <ProviderFormModal open={true} onClose={() => setShowCreateModal(false)} mode="create" />
      )}

      {/* Edit Modal */}
      {editingProvider && (
        <ProviderFormModal key={editingProvider.id} open={true} onClose={() => setEditingProvider(null)} mode="edit" provider={editingProvider} />
      )}
    </div>
  )
}

// ─── Provider Form Modal ──────────────────────────────────────

type ProviderFormProps = {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  provider?: SavedProvider
}

function requirePreset(preset: ProviderPreset | undefined): ProviderPreset {
  if (!preset) {
    throw new Error('Provider presets are not configured')
  }
  return preset
}

function ProviderFormModal({ open, onClose, mode, provider }: ProviderFormProps) {
  const { createProvider, updateProvider, activateProvider, testConfig } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const t = useTranslation()

  const availablePresets = PROVIDER_PRESETS.filter((p) => p.id !== 'official')
  const fallbackPreset = requirePreset(
    availablePresets[availablePresets.length - 1] ?? PROVIDER_PRESETS[0],
  )
  const initialPreset = requirePreset(
    provider
      ? availablePresets.find((p) => p.id === provider.presetId) ?? fallbackPreset
      : availablePresets[0] ?? fallbackPreset,
  )

  const [selectedPreset, setSelectedPreset] = useState<ProviderPreset>(initialPreset)
  const [name, setName] = useState(provider?.name ?? initialPreset.name)
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? initialPreset.baseUrl)
  const [apiFormat, setApiFormat] = useState<ApiFormat>(provider?.apiFormat ?? initialPreset.apiFormat ?? 'anthropic')
  const [apiKey, setApiKey] = useState('')
  const [notes, setNotes] = useState(provider?.notes ?? '')
  const [models, setModels] = useState<ModelMapping>(provider?.models ?? { ...initialPreset.defaultModels })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [settingsJson, setSettingsJson] = useState('')
  const [settingsJsonError, setSettingsJsonError] = useState<string | null>(null)
  const jsonPastedRef = useRef(false)

  // Load current settings.json and merge provider env vars
  useEffect(() => {
    // Skip if JSON was just populated by user paste
    if (jsonPastedRef.current) {
      jsonPastedRef.current = false
      return
    }
    settingsApi.getUser().then((settings) => {
        const isOpenAIChat = apiFormat === 'openai_chat'
        const isOpenAIResponses = apiFormat === 'openai_responses'
        const existingEnv = { ...((settings.env as Record<string, string>) || {}) }
        delete existingEnv.CLAUDE_CODE_COMPAT_PROVIDER
        delete existingEnv.CLAUDE_CODE_OPENAI_COMPAT_MODE
        const merged = {
          ...settings,
          env: {
            ...existingEnv,
            ANTHROPIC_BASE_URL: baseUrl,
            ANTHROPIC_AUTH_TOKEN: apiKey || '(your API key)',
            ANTHROPIC_MODEL: models.main,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: models.haiku,
            ANTHROPIC_DEFAULT_SONNET_MODEL: models.sonnet,
            ANTHROPIC_DEFAULT_OPUS_MODEL: models.opus,
            ...(isOpenAIChat && {
              CLAUDE_CODE_COMPAT_PROVIDER: 'openai',
              CLAUDE_CODE_OPENAI_COMPAT_MODE: 'chat_completions',
            }),
            ...(isOpenAIResponses && {
              CLAUDE_CODE_COMPAT_PROVIDER: 'openai',
              CLAUDE_CODE_OPENAI_COMPAT_MODE: 'responses',
            }),
          },
        }
        setSettingsJson(JSON.stringify(merged, null, 2))
    }).catch(() => {
      setSettingsJson(JSON.stringify({}, null, 2))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPreset.id])

  const handlePresetChange = (preset: ProviderPreset) => {
    setSelectedPreset(preset)
    setName(preset.name)
    setBaseUrl(preset.baseUrl)
    setApiFormat(preset.apiFormat ?? 'anthropic')
    setModels({ ...preset.defaultModels })
    setTestResult(null)
  }

  const canSubmit = name.trim() && baseUrl.trim() && (mode === 'edit' || apiKey.trim()) && models.main.trim() && !settingsJsonError

  const handleSubmit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      if (mode === 'create') {
        const created = await createProvider({
          presetId: selectedPreset.id,
          name: name.trim(),
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim(),
          apiFormat,
          models,
          notes: notes.trim() || undefined,
        })
        await activateProvider(created.id)
      } else if (provider) {
        const input: UpdateProviderInput = {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          apiFormat,
          models,
          notes: notes.trim() || undefined,
        }
        if (apiKey.trim()) input.apiKey = apiKey.trim()
        await updateProvider(provider.id, input)
      }
      await fetchSettings()
      onClose()
    } catch (err) {
      console.error('Failed to save provider:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleTest = async () => {
    if (!baseUrl.trim() || !models.main.trim()) return
    setIsTesting(true)
    setTestResult(null)
    try {
      let result: ProviderTestResult
      if (mode === 'edit' && provider && !apiKey.trim()) {
        result = await useProviderStore.getState().testProvider(provider.id, {
          baseUrl: baseUrl.trim(),
          modelId: models.main.trim(),
          apiFormat,
        })
      } else {
        if (!apiKey.trim()) return
        result = await testConfig({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), modelId: models.main.trim(), apiFormat })
      }
      setTestResult(result)
    } catch {
      setTestResult({ connectivity: { success: false, latencyMs: 0, error: t('settings.providers.requestFailed') } })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'create' ? t('settings.providers.addTitle') : t('settings.providers.editTitle')}
      width={720}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={isSubmitting}>
            {mode === 'create' ? t('common.add') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Preset chips */}
        {mode === 'create' && (
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.preset')}</label>
            <div className="flex flex-wrap gap-2">
              {availablePresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handlePresetChange(preset)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
                    selectedPreset.id === preset.id
                      ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-focus)]'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <Input label={t('settings.providers.name')} required value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.providers.namePlaceholder')} />

        <Input label={t('settings.providers.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('settings.providers.notesPlaceholder')} />

        {/* Base URL */}
        <Input
          label={t('settings.providers.baseUrl')}
          required
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={t('settings.providers.baseUrlPlaceholder')}
        />

        {/* API Format */}
        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)] mb-1 block">{t('settings.providers.apiFormat')}</label>
          <select
            value={apiFormat}
            onChange={(e) => setApiFormat(e.target.value as ApiFormat)}
            className="w-full text-sm px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
          >
            <option value="anthropic">{t('settings.providers.apiFormatAnthropic')}</option>
            <option value="openai_chat">{t('settings.providers.apiFormatOpenaiChat')}</option>
            <option value="openai_responses">{t('settings.providers.apiFormatOpenaiResponses')}</option>
          </select>
          {apiFormat !== 'anthropic' && (
            <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{t('settings.providers.proxyHint')}</p>
          )}
        </div>

        <Input
          label={mode === 'edit' ? t('settings.providers.apiKeyKeep') : t('settings.providers.apiKey')}
          required={mode === 'create'}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={mode === 'edit' ? '****' : 'sk-...'}
        />

        {/* Model Mapping */}
        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.modelMapping')}</label>
          <div className="grid grid-cols-2 gap-2">
            <Input label={t('settings.providers.mainModel')} required value={models.main} onChange={(e) => setModels({ ...models, main: e.target.value })} placeholder="Model ID" />
            <Input label={t('settings.providers.haikuModel')} value={models.haiku} onChange={(e) => setModels({ ...models, haiku: e.target.value })} placeholder={t('settings.providers.sameAsMain')} />
            <Input label={t('settings.providers.sonnetModel')} value={models.sonnet} onChange={(e) => setModels({ ...models, sonnet: e.target.value })} placeholder={t('settings.providers.sameAsMain')} />
            <Input label={t('settings.providers.opusModel')} value={models.opus} onChange={(e) => setModels({ ...models, opus: e.target.value })} placeholder={t('settings.providers.sameAsMain')} />
          </div>
        </div>

        {/* Test connection */}
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={handleTest} loading={isTesting} disabled={!baseUrl.trim() || !models.main.trim()}>
            {t('settings.providers.testConnection')}
          </Button>
          {testResult && (
            <div className="flex flex-col gap-0.5">
              <span className={`text-xs ${testResult.connectivity.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                {testResult.connectivity.success
                  ? t('settings.providers.connectivityOk', { latency: String(testResult.connectivity.latencyMs) })
                  : t('settings.providers.connectivityFailed', { error: testResult.connectivity.error || '' })}
              </span>
              {testResult.proxy && (
                <span className={`text-xs ${testResult.proxy.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                  {testResult.proxy.success
                    ? t('settings.providers.proxyOk', { latency: String(testResult.proxy.latencyMs) })
                    : t('settings.providers.proxyFailed', { error: testResult.proxy.error || '' })}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Settings JSON — editable, shown for all presets including official */}
        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.settingsJson')}</label>
          <textarea
            value={settingsJson}
            onChange={(e) => {
              const raw = e.target.value
              setSettingsJson(raw)
              try {
                const parsed = JSON.parse(raw)
                setSettingsJsonError(null)
                // Auto-fill form fields from parsed JSON env
                const env = parsed.env as Record<string, string> | undefined
                if (env) {
                  if (env.ANTHROPIC_BASE_URL) {
                    setBaseUrl(env.ANTHROPIC_BASE_URL)
                    // Auto-switch to matching preset or Custom
                    if (mode === 'create') {
                      const matchedPreset = availablePresets.find((p) => p.id !== 'custom' && p.baseUrl === env.ANTHROPIC_BASE_URL)
                      const targetPreset = requirePreset(
                        matchedPreset ?? availablePresets.find((p) => p.id === 'custom'),
                      )
                      if (targetPreset.id !== selectedPreset.id) {
                        jsonPastedRef.current = true
                        setSelectedPreset(targetPreset)
                      }
                    }
                  }
                  if (env.ANTHROPIC_AUTH_TOKEN && env.ANTHROPIC_AUTH_TOKEN !== '(your API key)') setApiKey(env.ANTHROPIC_AUTH_TOKEN)
                  const newModels: Partial<ModelMapping> = {}
                  if (env.ANTHROPIC_MODEL) newModels.main = env.ANTHROPIC_MODEL
                  if (env.ANTHROPIC_DEFAULT_HAIKU_MODEL) newModels.haiku = env.ANTHROPIC_DEFAULT_HAIKU_MODEL
                  if (env.ANTHROPIC_DEFAULT_SONNET_MODEL) newModels.sonnet = env.ANTHROPIC_DEFAULT_SONNET_MODEL
                  if (env.ANTHROPIC_DEFAULT_OPUS_MODEL) newModels.opus = env.ANTHROPIC_DEFAULT_OPUS_MODEL
                  if (Object.keys(newModels).length > 0) {
                    setModels((prev) => ({ ...prev, ...newModels }))
                  }
                }
              } catch (err) {
                setSettingsJsonError(err instanceof Error ? err.message : 'Invalid JSON')
              }
            }}
            rows={16}
            spellCheck={false}
            className={`w-full text-xs px-3 py-3 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] border font-mono leading-relaxed resize-y text-[var(--color-text-secondary)] outline-none ${
              settingsJsonError
                ? 'border-[var(--color-error)] focus:border-[var(--color-error)]'
                : 'border-[var(--color-border)] focus:border-[var(--color-border-focus)]'
            }`}
          />
          {settingsJsonError && (
            <p className="text-[11px] text-[var(--color-error)] mt-1">{t('settings.providers.jsonError', { error: settingsJsonError })}</p>
          )}
          <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{t('settings.providers.settingsJsonDesc')}</p>
        </div>
      </div>
    </Modal>
  )
}


// ─── Permission Settings ──────────────────────────────────────

function PermissionSettings() {
  const { permissionMode, setPermissionMode } = useSettingsStore()
  const t = useTranslation()

  const MODES: Array<{ mode: PermissionMode; icon: string; label: string; desc: string }> = [
    { mode: 'default', icon: 'verified_user', label: t('settings.permissions.default'), desc: t('settings.permissions.defaultDesc') },
    { mode: 'acceptEdits', icon: 'edit_note', label: t('settings.permissions.acceptEdits'), desc: t('settings.permissions.acceptEditsDesc') },
    { mode: 'plan', icon: 'architecture', label: t('settings.permissions.plan'), desc: t('settings.permissions.planDesc') },
    { mode: 'bypassPermissions', icon: 'bolt', label: t('settings.permissions.bypass'), desc: t('settings.permissions.bypassDesc') },
  ]

  return (
    <div className="max-w-xl">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.permissions.title')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-4">{t('settings.permissions.description')}</p>

      <div className="flex flex-col gap-2">
        {MODES.map(({ mode, icon, label, desc }) => {
          const isSelected = permissionMode === mode
          return (
            <button
              key={mode}
              onClick={() => setPermissionMode(mode)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                isSelected
                  ? 'border-[var(--color-brand)] bg-[var(--color-primary-fixed)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <span className="material-symbols-outlined text-[20px] text-[var(--color-text-secondary)]">{icon}</span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">{label}</div>
                <div className="text-xs text-[var(--color-text-tertiary)]">{desc}</div>
              </div>
              {isSelected && (
                <span className="material-symbols-outlined text-[18px] text-[var(--color-brand)]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  check_circle
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── General Settings ──────────────────────────────────────

function GeneralSettings() {
  const { effortLevel, setEffort, locale, setLocale } = useSettingsStore()
  const t = useTranslation()

  const EFFORT_LABELS: Record<EffortLevel, string> = {
    low: t('settings.general.effort.low'),
    medium: t('settings.general.effort.medium'),
    high: t('settings.general.effort.high'),
    max: t('settings.general.effort.max'),
  }

  const LANGUAGES: Array<{ value: Locale; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh', label: '中文' },
  ]

  return (
    <div className="max-w-xl">
      {/* Language selector */}
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.languageTitle')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.languageDescription')}</p>
      <div className="flex gap-2 mb-8">
        {LANGUAGES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setLocale(value)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${
              locale === value
                ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Effort Level */}
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.effortTitle')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.effortDescription')}</p>
      <div className="flex gap-2">
        {(['low', 'medium', 'high', 'max'] as EffortLevel[]).map((level) => (
          <button
            key={level}
            onClick={() => setEffort(level)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${
              effortLevel === level
                ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            {EFFORT_LABELS[level]}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Agents Settings ──────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7',
  pink: '#ec4899',
  cyan: '#06b6d4',
}

const AGENT_SOURCE_ORDER: AgentSource[] = [
  'userSettings',
  'projectSettings',
  'localSettings',
  'policySettings',
  'plugin',
  'flagSettings',
  'built-in',
]

function AgentsSettings() {
  const {
    activeAgents,
    allAgents,
    isLoading,
    error,
    selectedAgent,
    fetchAgents,
    selectAgent,
  } = useAgentStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const t = useTranslation()

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined

  useEffect(() => {
    void fetchAgents(currentWorkDir)
  }, [fetchAgents, currentWorkDir])

  const groupedAgents = useMemo(() => {
    const groups: Partial<Record<AgentSource, AgentDefinition[]>> = {}
    for (const agent of allAgents) {
      ;(groups[agent.source] ??= []).push(agent)
    }
    return groups
  }, [allAgents])

  const sourceCount = AGENT_SOURCE_ORDER.filter((source) => (groupedAgents[source] ?? []).length > 0).length

  if (selectedAgent) {
    return (
      <div className="w-full min-w-0">
        <AgentDetailView agent={selectedAgent} onBack={() => selectAgent(null)} />
      </div>
    )
  }

  return (
    <div className="w-full min-w-0">
      {isLoading && allAgents.length === 0 ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="text-center py-12 px-4">
          <span className="material-symbols-outlined text-[40px] text-[var(--color-error)] mb-3 block">error_outline</span>
          <p className="text-sm text-[var(--color-error)] mb-2">{error}</p>
          <button
            onClick={() => void fetchAgents(currentWorkDir)}
            className="text-xs text-[var(--color-text-accent)] hover:underline"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : allAgents.length === 0 ? (
        <div className="text-center py-12 px-4 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
          <span className="material-symbols-outlined text-[40px] text-[var(--color-text-tertiary)] mb-3 block">smart_toy</span>
          <p className="text-sm text-[var(--color-text-secondary)] mb-1">{t('settings.agents.empty')}</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.agents.emptyHint')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 min-w-0">
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] overflow-hidden">
            <div className="grid gap-4 px-5 py-5 min-w-0 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] xl:items-end">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] mb-2">
                  {t('settings.agents.browserEyebrow')}
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="material-symbols-outlined text-[22px] text-[var(--color-brand)]">
                    smart_toy
                  </span>
                  <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                    {t('settings.agents.browserTitle')}
                  </h3>
                </div>
                <p className="text-sm leading-6 text-[var(--color-text-secondary)] max-w-3xl">
                  {t('settings.agents.description')}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 min-w-0 sm:grid-cols-3">
                <SummaryCard
                  label={t('settings.agents.summary.totalAgents')}
                  value={String(allAgents.length)}
                  icon="smart_toy"
                />
                <SummaryCard
                  label={t('settings.agents.summary.activeAgents')}
                  value={String(activeAgents.length)}
                  icon="bolt"
                />
                <SummaryCard
                  label={t('settings.agents.summary.sources')}
                  value={String(sourceCount)}
                  icon="layers"
                  className="col-span-2 sm:col-span-1"
                />
              </div>
            </div>
          </section>

          <div className={`grid gap-4 ${sourceCount >= 2 ? 'xl:grid-cols-2' : ''}`}>
            {AGENT_SOURCE_ORDER.map((source) => {
              const group = groupedAgents[source]
              if (!group?.length) return null

              const sourceLabel = t(`settings.agents.source.${source}`)
              return (
                <section
                  key={source}
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden min-w-0"
                >
                  <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${getAgentSourceAccentClass(source)}`}>
                          <span className="material-symbols-outlined text-[16px]">
                            {getAgentSourceIcon(source)}
                          </span>
                        </span>
                        <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                          {sourceLabel}
                        </h4>
                        <span className="text-xs text-[var(--color-text-tertiary)]">
                          {group.length}
                        </span>
                      </div>
                      <p className="text-xs leading-5 text-[var(--color-text-tertiary)]">
                        {t('settings.agents.groupHint', {
                          source: sourceLabel,
                          count: String(group.length),
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col p-2">
                    {group.map((agent) => (
                      <button
                        key={`${agent.source}-${agent.agentType}`}
                        onClick={() => selectAgent(agent)}
                        className="group rounded-xl border border-transparent px-3 py-3 text-left transition-all hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className="mt-0.5 flex-shrink-0 inline-flex items-center justify-center"
                            style={{ color: getAgentDotColor(agent.color) }}
                          >
                            <span className="material-symbols-outlined text-[18px]">smart_toy</span>
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-[var(--color-text-primary)] break-all">
                                {agent.agentType}
                              </span>
                              {agent.modelDisplay && (
                                <MetaPill>{agent.modelDisplay}</MetaPill>
                              )}
                              <MetaPill>{sourceLabel}</MetaPill>
                              <MetaPill>
                                {agent.isActive
                                  ? t('settings.agents.status.active')
                                  : t('settings.agents.status.available')}
                              </MetaPill>
                              {agent.overriddenBy && (
                                <MetaPill>
                                  {t('settings.agents.overriddenBy', {
                                    source: t(`settings.agents.source.${agent.overriddenBy}`),
                                  })}
                                </MetaPill>
                              )}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)] break-words [&_.prose]:text-xs [&_.prose]:leading-5 [&_.prose]:text-[var(--color-text-secondary)]">
                              <MarkdownRenderer
                                content={agent.description || t('settings.agents.noDescription')}
                              />
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                              <span>
                                {agent.tools?.length
                                  ? t('settings.agents.toolCount', { count: String(agent.tools.length) })
                                  : t('settings.agents.noTools')}
                              </span>
                              {agent.baseDir && (
                                <span className="break-all">{agent.baseDir}</span>
                              )}
                            </div>
                          </div>
                          <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)] opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100">
                            chevron_right
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function AgentDetailView({ agent, onBack }: { agent: AgentDefinition; onBack: () => void }) {
  const t = useTranslation()
  const sourceLabel = t(`settings.agents.source.${agent.source}`)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 min-w-0">
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          {t('settings.agents.backToList')}
        </button>
      </div>

      <section className="cc-glass-card rounded-2xl border border-[var(--color-border)] overflow-hidden">
        <div className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.9fr)] lg:items-start">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] mb-2">
              {t('settings.agents.entryEyebrow')}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span
                className="h-3 w-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: getAgentDotColor(agent.color) }}
              />
              <h3 className="text-[22px] font-semibold leading-tight text-[var(--color-text-primary)] break-all">
                {agent.agentType}
              </h3>
              <MetaPill>{sourceLabel}</MetaPill>
              {agent.modelDisplay && <MetaPill>{agent.modelDisplay}</MetaPill>}
              <MetaPill>
                {agent.isActive
                  ? t('settings.agents.status.active')
                  : t('settings.agents.status.available')}
              </MetaPill>
              {agent.overriddenBy && (
                <MetaPill>
                  {t('settings.agents.overriddenByShort', {
                    source: t(`settings.agents.source.${agent.overriddenBy}`),
                  })}
                </MetaPill>
              )}
            </div>
            <div className="max-w-4xl text-sm leading-6 text-[var(--color-text-secondary)]">
              <MarkdownRenderer
                content={agent.description || t('settings.agents.noDescription')}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[var(--color-text-tertiary)]">
              <span>
                {agent.tools?.length
                  ? t('settings.agents.toolCount', { count: String(agent.tools.length) })
                  : t('settings.agents.noTools')}
              </span>
              {agent.baseDir && <span className="break-all">{agent.baseDir}</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            <DetailStat
              label={t('settings.agents.summary.source')}
              value={sourceLabel}
              icon="layers"
            />
            <DetailStat
              label={t('settings.agents.summary.model')}
              value={agent.modelDisplay || '—'}
              icon="psychology"
            />
            <DetailStat
              label={t('settings.agents.summary.tools')}
              value={String(agent.tools?.length ?? 0)}
              icon="build"
            />
            <DetailStat
              label={t('settings.agents.summary.status')}
              value={agent.isActive ? t('settings.agents.status.active') : t('settings.agents.status.available')}
              icon="bolt"
            />
          </div>
        </div>
      </section>

      {agent.tools && agent.tools.length > 0 && (
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">
              build
            </span>
            <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t('settings.agents.tools')}
            </h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {agent.tools.map((tool) => (
              <MetaPill key={tool}>{tool}</MetaPill>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-1 min-h-0 min-w-0 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-[var(--color-text-secondary)] break-all">
                  {agent.baseDir || sourceLabel}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                {t('settings.agents.promptHint')}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[var(--color-surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] border border-[var(--color-border)]">
                {t('settings.agents.systemPrompt')}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-surface-container-lowest)]">
            {agent.systemPrompt ? (
              <div className="px-6 py-5 lg:px-8">
                <MarkdownRenderer
                  content={agent.systemPrompt}
                  variant="document"
                  className="mx-auto max-w-[72ch]"
                />
              </div>
            ) : (
              <div className="px-6 py-10 text-center">
                <span className="material-symbols-outlined text-[32px] text-[var(--color-text-tertiary)] mb-2 block">
                  article
                </span>
                <p className="text-sm text-[var(--color-text-tertiary)]">
                  {t('settings.agents.noSystemPrompt')}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function getAgentDotColor(color?: string) {
  return color && AGENT_COLORS[color] ? AGENT_COLORS[color] : 'var(--color-text-tertiary)'
}

function getAgentSourceIcon(source: AgentSource) {
  switch (source) {
    case 'userSettings':
      return 'person'
    case 'projectSettings':
      return 'folder'
    case 'localSettings':
      return 'folder_lock'
    case 'policySettings':
      return 'shield'
    case 'plugin':
      return 'extension'
    case 'flagSettings':
      return 'terminal'
    case 'built-in':
      return 'inventory_2'
  }
}

function getAgentSourceAccentClass(source: AgentSource) {
  switch (source) {
    case 'userSettings':
      return 'bg-[var(--color-primary-fixed)] text-[var(--color-brand)]'
    case 'projectSettings':
      return 'bg-[var(--color-success-container)] text-[var(--color-success)]'
    case 'localSettings':
      return 'bg-[var(--color-info-container)] text-[var(--color-info)]'
    case 'policySettings':
      return 'bg-[var(--color-warning-container)] text-[var(--color-warning)]'
    case 'plugin':
      return 'bg-[var(--color-warning-container)] text-[var(--color-warning)]'
    case 'flagSettings':
      return 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
    case 'built-in':
      return 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'
  }
}

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
      {children}
    </span>
  )
}

function SummaryCard({
  label,
  value,
  icon,
  className = '',
}: {
  label: string
  value: string
  icon: string
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 min-w-0 ${className}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] min-w-0">
        <span className="material-symbols-outlined text-[14px] flex-shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 text-lg font-semibold text-[var(--color-text-primary)] truncate">
        {value}
      </div>
    </div>
  )
}

function DetailStat({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: string
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
        <span className="material-symbols-outlined text-[14px]">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-2 text-base font-semibold text-[var(--color-text-primary)] break-all">
        {value}
      </div>
    </div>
  )
}
// ─── Skill Settings ──────────────────────────────────────

function SkillSettings() {
  const selectedSkill = useSkillStore((s) => s.selectedSkill)
  const t = useTranslation()

  if (selectedSkill) {
    return (
      <div className="w-full min-w-0">
        <SkillDetail />
      </div>
    )
  }

  return (
    <div className="w-full min-w-0">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
        {t('settings.skills.title')}
      </h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-4">
        {t('settings.skills.description')}
      </p>
      <SkillList />
    </div>
  )
}

// ─── About Settings ──────────────────────────────────────

function AboutSettings() {
  const t = useTranslation()
  const [version, setVersion] = useState('')
  const updateStatus = useUpdateStore((s) => s.status)
  const availableVersion = useUpdateStore((s) => s.availableVersion)
  const releaseNotes = useUpdateStore((s) => s.releaseNotes)
  const progressPercent = useUpdateStore((s) => s.progressPercent)
  const error = useUpdateStore((s) => s.error)
  const checkedAt = useUpdateStore((s) => s.checkedAt)
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates)
  const installUpdate = useUpdateStore((s) => s.installUpdate)
  const initialize = useUpdateStore((s) => s.initialize)

  useEffect(() => {
    import('@tauri-apps/api/app').then((mod) => mod.getVersion()).then(setVersion).catch(() => setVersion('0.1.0'))
  }, [])

  useEffect(() => {
    void initialize()
  }, [initialize])

  const checkedAtText =
    checkedAt
      ? new Date(checkedAt).toLocaleString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          month: 'short',
          day: 'numeric',
        })
      : null

  const updateDescription =
    updateStatus === 'checking'
      ? t('update.checking')
      : updateStatus === 'downloading'
        ? t('update.progress', { progress: String(progressPercent) })
        : updateStatus === 'restarting'
          ? t('update.restarting')
          : updateStatus === 'available' && availableVersion
            ? t('update.newVersion', { version: availableVersion })
            : updateStatus === 'up-to-date'
              ? t('update.upToDate', { version: version || t('update.currentVersionUnknown') })
              : error
                ? t('update.failed', { error })
                : t('update.idle')

  return (
    <div className="w-full min-w-0 max-w-lg mx-auto flex flex-col items-center py-6">
      {/* Logo + App Name + Version */}
      <img src="/app-icon.svg" alt="Claude YH" className="w-20 h-20 rounded-2xl shadow-md mb-4" />
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Claude YH</h1>
      {version && (
        <span className="text-xs text-[var(--color-text-tertiary)] mt-1">{t('settings.about.version')} {version}</span>
      )}

      <div className="mt-4 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-[var(--color-text-primary)]">{t('settings.about.updates')}</div>
            <div className="text-xs text-[var(--color-text-tertiary)] mt-1">
              {t('settings.about.updatesDesc')}
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void checkForUpdates()}
            loading={updateStatus === 'checking'}
          >
            {t('update.checkNow')}
          </Button>
        </div>

        <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                {t('settings.about.version')}
              </div>
              <div className="text-sm font-medium text-[var(--color-text-primary)] mt-1">
                {version || t('update.currentVersionUnknown')}
              </div>
            </div>

            {availableVersion && (
              <div className="text-right">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                  {t('update.availableLabel')}
                </div>
                <div className="text-sm font-medium text-[var(--color-text-primary)] mt-1">
                  {availableVersion}
                </div>
              </div>
            )}
          </div>

          <p className={`mt-3 text-sm ${error ? 'text-[var(--color-error)]' : 'text-[var(--color-text-secondary)]'}`}>
            {updateDescription}
          </p>

          {checkedAtText && (
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              {t('update.checkedAt', { time: checkedAtText })}
            </p>
          )}

          {(updateStatus === 'downloading' || updateStatus === 'restarting') && (
            <div className="mt-3">
              <div className="h-1.5 bg-[var(--color-surface-container-low)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--color-text-accent)] transition-all duration-300"
                  style={{ width: `${Math.min(progressPercent, 100)}%` }}
                />
              </div>
            </div>
          )}

          {releaseNotes && availableVersion && (
            <div className="mt-3 rounded-lg bg-[var(--color-surface-container-low)] px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                {t('update.releaseNotes')}
              </div>
              <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)] whitespace-pre-wrap">
                {releaseNotes}
              </p>
            </div>
          )}

          {availableVersion && (
            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                onClick={() => void installUpdate()}
                loading={updateStatus === 'downloading' || updateStatus === 'restarting'}
                disabled={updateStatus === 'checking'}
              >
                {updateStatus === 'restarting' ? t('update.restarting') : t('update.now')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

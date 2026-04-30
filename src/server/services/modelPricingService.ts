import { SettingsService } from './settingsService.js'

const SETTINGS_KEY = 'claudeYhModelPricing'

export type ModelPricing = {
  modelId: string
  displayName: string
  inputCostPerMillion: string
  outputCostPerMillion: string
  cacheReadCostPerMillion: string
  cacheCreationCostPerMillion: string
}

export type TokenUsageForCost = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export type CostBreakdown = {
  inputCostUsd: number
  outputCostUsd: number
  cacheReadCostUsd: number
  cacheCreationCostUsd: number
  totalCostUsd: number
  matchedPricing?: ModelPricing
}

const DEFAULT_MODEL_PRICING: ModelPricing[] = [
  // Claude pricing, copied from cc-switch model_pricing defaults.
  price('claude-opus-4-7', 'Claude Opus 4.7', '5', '25', '0.50', '6.25'),
  price('claude-opus-4-6-20260206', 'Claude Opus 4.6', '5', '25', '0.50', '6.25'),
  price('claude-sonnet-4-6-20260217', 'Claude Sonnet 4.6', '3', '15', '0.30', '3.75'),
  price('claude-opus-4-5-20251101', 'Claude Opus 4.5', '5', '25', '0.50', '6.25'),
  price('claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5', '3', '15', '0.30', '3.75'),
  price('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', '1', '5', '0.10', '1.25'),
  price('claude-opus-4-20250514', 'Claude Opus 4', '15', '75', '1.50', '18.75'),
  price('claude-opus-4-1-20250805', 'Claude Opus 4.1', '15', '75', '1.50', '18.75'),
  price('claude-sonnet-4-20250514', 'Claude Sonnet 4', '3', '15', '0.30', '3.75'),
  price('claude-3-5-haiku-20241022', 'Claude 3.5 Haiku', '0.80', '4', '0.08', '1'),
  price('claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet', '3', '15', '0.30', '3.75'),

  // OpenAI / Codex pricing.
  price('gpt-5.4', 'GPT-5.4', '2.50', '15', '0.25', '0'),
  price('gpt-5.4-mini', 'GPT-5.4 Mini', '0.75', '4.50', '0.075', '0'),
  price('gpt-5.4-nano', 'GPT-5.4 Nano', '0.20', '1.25', '0.02', '0'),
  price('gpt-5.3-codex', 'GPT-5.3 Codex', '1.75', '14', '0.175', '0'),
  price('gpt-5.3-codex-low', 'GPT-5.3 Codex', '1.75', '14', '0.175', '0'),
  price('gpt-5.3-codex-medium', 'GPT-5.3 Codex', '1.75', '14', '0.175', '0'),
  price('gpt-5.3-codex-high', 'GPT-5.3 Codex', '1.75', '14', '0.175', '0'),
  price('gpt-5.3-codex-xhigh', 'GPT-5.3 Codex', '1.75', '14', '0.175', '0'),
  price('gpt-5.2', 'GPT-5.2', '1.75', '14', '0.175', '0'),
  price('gpt-5.2-low', 'GPT-5.2', '1.75', '14', '0.175', '0'),
  price('gpt-5.2-medium', 'GPT-5.2', '1.75', '14', '0.175', '0'),
  price('gpt-5.2-high', 'GPT-5.2', '1.75', '14', '0.175', '0'),
  price('gpt-5.2-xhigh', 'GPT-5.2', '1.75', '14', '0.175', '0'),
  price('gpt-5.2-codex', 'GPT-5.2 Codex', '1.75', '14', '0.175', '0'),
  price('gpt-5.2-codex-low', 'GPT-5.2 Codex', '1.75', '14', '0.175', '0'),
  price('gpt-5.2-codex-medium', 'GPT-5.2 Codex', '1.75', '14', '0.175', '0'),
  price('gpt-5.2-codex-high', 'GPT-5.2 Codex', '1.75', '14', '0.175', '0'),
  price('gpt-5.2-codex-xhigh', 'GPT-5.2 Codex', '1.75', '14', '0.175', '0'),
  price('gpt-5.1', 'GPT-5.1', '1.25', '10', '0.125', '0'),
  price('gpt-5.1-low', 'GPT-5.1', '1.25', '10', '0.125', '0'),
  price('gpt-5.1-medium', 'GPT-5.1', '1.25', '10', '0.125', '0'),
  price('gpt-5.1-high', 'GPT-5.1', '1.25', '10', '0.125', '0'),
  price('gpt-5.1-minimal', 'GPT-5.1', '1.25', '10', '0.125', '0'),
  price('gpt-5.1-codex', 'GPT-5.1 Codex', '1.25', '10', '0.125', '0'),
  price('gpt-5.1-codex-mini', 'GPT-5.1 Codex', '1.25', '10', '0.125', '0'),
  price('gpt-5.1-codex-max', 'GPT-5.1 Codex', '1.25', '10', '0.125', '0'),
  price('gpt-5.1-codex-max-high', 'GPT-5.1 Codex', '1.25', '10', '0.125', '0'),
  price('gpt-5.1-codex-max-xhigh', 'GPT-5.1 Codex', '1.25', '10', '0.125', '0'),
  price('gpt-5', 'GPT-5', '1.25', '10', '0.125', '0'),
  price('gpt-5-low', 'GPT-5', '1.25', '10', '0.125', '0'),
  price('gpt-5-medium', 'GPT-5', '1.25', '10', '0.125', '0'),
  price('gpt-5-high', 'GPT-5', '1.25', '10', '0.125', '0'),
  price('gpt-5-minimal', 'GPT-5', '1.25', '10', '0.125', '0'),
  price('gpt-5-codex', 'GPT-5 Codex', '1.25', '10', '0.125', '0'),
  price('gpt-5-codex-low', 'GPT-5 Codex', '1.25', '10', '0.125', '0'),
  price('gpt-5-codex-medium', 'GPT-5 Codex', '1.25', '10', '0.125', '0'),
  price('gpt-5-codex-high', 'GPT-5 Codex', '1.25', '10', '0.125', '0'),
  price('gpt-5-codex-mini', 'GPT-5 Codex', '1.25', '10', '0.125', '0'),
  price('gpt-5-mini', 'GPT-5 Mini', '0.25', '2', '0.025', '0'),
  price('gpt-5-nano', 'GPT-5 Nano', '0.05', '0.40', '0.005', '0'),
  price('o3', 'OpenAI o3', '2', '8', '0.50', '0'),
  price('o3-pro', 'OpenAI o3-pro', '20', '80', '0', '0'),
  price('o3-mini', 'OpenAI o3-mini', '0.55', '2.20', '0.55', '0'),
  price('o4-mini', 'OpenAI o4-mini', '1.10', '4.40', '0.275', '0'),
  price('o1', 'OpenAI o1', '15', '60', '7.50', '0'),
  price('o1-mini', 'OpenAI o1-mini', '0.55', '2.20', '0.55', '0'),
  price('codex-mini', 'Codex Mini', '0.75', '3', '0.025', '0'),
  price('gpt-4.1', 'GPT-4.1', '2', '8', '0.50', '0'),
  price('gpt-4.1-mini', 'GPT-4.1 Mini', '0.40', '1.60', '0.10', '0'),
  price('gpt-4.1-nano', 'GPT-4.1 Nano', '0.10', '0.40', '0.025', '0'),

  // Gemini and common third-party models.
  price('gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview', '2', '12', '0.20', '0'),
  price('gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash Lite Preview', '0.25', '1.50', '0.025', '0'),
  price('gemini-3-pro-preview', 'Gemini 3 Pro Preview', '2', '12', '0.2', '0'),
  price('gemini-3-flash-preview', 'Gemini 3 Flash Preview', '0.5', '3', '0.05', '0'),
  price('gemini-2.5-pro', 'Gemini 2.5 Pro', '1.25', '10', '0.125', '0'),
  price('gemini-2.5-flash', 'Gemini 2.5 Flash', '0.3', '2.5', '0.03', '0'),
  price('gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite', '0.10', '0.40', '0.01', '0'),
  price('gemini-2.0-flash', 'Gemini 2.0 Flash', '0.10', '0.40', '0.025', '0'),
  price('deepseek-v3.2', 'DeepSeek V3.2', '0.28', '0.42', '0.028', '0'),
  price('deepseek-v3.1', 'DeepSeek V3.1', '0.55', '1.67', '0.055', '0'),
  price('deepseek-v3', 'DeepSeek V3', '0.28', '1.11', '0.028', '0'),
  price('deepseek-chat', 'DeepSeek Chat', '0.27', '1.10', '0.07', '0'),
  price('deepseek-reasoner', 'DeepSeek Reasoner', '0.55', '2.19', '0.14', '0'),
  price('kimi-k2-thinking', 'Kimi K2 Thinking', '0.55', '2.20', '0.10', '0'),
  price('kimi-k2-0905', 'Kimi K2', '0.55', '2.20', '0.10', '0'),
  price('kimi-k2-turbo', 'Kimi K2 Turbo', '1.11', '8.06', '0.14', '0'),
  price('kimi-k2.5', 'Kimi K2.5', '0.60', '2.50', '0.10', '0'),
  price('kimi-k2.6', 'Kimi K2.6', '0.95', '4.00', '0.16', '0'),
  price('minimax-m2.1', 'MiniMax M2.1', '0.27', '0.95', '0.03', '0'),
  price('minimax-m2.1-lightning', 'MiniMax M2.1 Lightning', '0.27', '2.33', '0.03', '0'),
  price('minimax-m2', 'MiniMax M2', '0.27', '0.95', '0.03', '0'),
  price('minimax-m2.5', 'MiniMax M2.5', '0.12', '0.95', '0.03', '0'),
  price('minimax-m2.5-lightning', 'MiniMax M2.5 Lightning', '0.30', '2.40', '0.03', '0'),
  price('minimax-m2.7', 'MiniMax M2.7', '0.30', '1.20', '0.06', '0.375'),
  price('minimax-m2.7-highspeed', 'MiniMax M2.7 Highspeed', '0.60', '2.40', '0.06', '0.375'),
  price('glm-4.7', 'GLM-4.7', '0.39', '1.75', '0.04', '0'),
  price('glm-4.6', 'GLM-4.6', '0.28', '1.11', '0.03', '0'),
  price('glm-5', 'GLM-5', '0.72', '2.30', '0', '0'),
  price('glm-5.1', 'GLM-5.1', '0.95', '3.15', '0', '0'),
  price('qwen3.6-plus', 'Qwen3.6 Plus', '0.325', '1.95', '0', '0'),
  price('qwen3.5-plus', 'Qwen3.5 Plus', '0.26', '1.56', '0', '0'),
  price('qwen3-max', 'Qwen3 Max', '0.78', '3.90', '0', '0'),
  price('qwen3-235b-a22b', 'Qwen3 235B-A22B', '0.70', '8.40', '0', '0'),
  price('qwen3-coder-plus', 'Qwen3 Coder Plus', '0.65', '3.25', '0', '0'),
  price('qwen3-coder-flash', 'Qwen3 Coder Flash', '0.195', '0.975', '0', '0'),
  price('qwen3-coder-next', 'Qwen3 Coder Next', '0.12', '0.75', '0', '0'),
]

function price(
  modelId: string,
  displayName: string,
  inputCostPerMillion: string,
  outputCostPerMillion: string,
  cacheReadCostPerMillion: string,
  cacheCreationCostPerMillion: string,
): ModelPricing {
  return {
    modelId,
    displayName,
    inputCostPerMillion,
    outputCostPerMillion,
    cacheReadCostPerMillion,
    cacheCreationCostPerMillion,
  }
}

function isPricing(value: unknown): value is ModelPricing {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ModelPricing>
  return (
    typeof item.modelId === 'string' &&
    typeof item.displayName === 'string' &&
    typeof item.inputCostPerMillion === 'string' &&
    typeof item.outputCostPerMillion === 'string' &&
    typeof item.cacheReadCostPerMillion === 'string' &&
    typeof item.cacheCreationCostPerMillion === 'string'
  )
}

function normalizeModelId(modelId: string): string {
  return modelId
    .trim()
    .toLowerCase()
    .split('/')
    .pop()!
    .split(':')[0]
    .replace(/@/g, '-')
}

function toMoneyNumber(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

export class ModelPricingService {
  constructor(private settingsService = new SettingsService()) {}

  async listPricing(): Promise<ModelPricing[]> {
    const settings = await this.settingsService.getUserSettings()
    const custom = settings[SETTINGS_KEY]
    if (!Array.isArray(custom)) {
      return DEFAULT_MODEL_PRICING
    }

    return mergePricing(DEFAULT_MODEL_PRICING, custom.filter(isPricing))
  }

  async savePricing(pricing: unknown): Promise<ModelPricing[]> {
    if (!Array.isArray(pricing)) {
      throw new Error('Pricing must be an array')
    }
    const normalized = pricing.filter(isPricing).map((item) => ({
      ...item,
      modelId: item.modelId.trim(),
      displayName: item.displayName.trim() || item.modelId.trim(),
    })).filter((item) => item.modelId)

    await this.settingsService.updateUserSettings({ [SETTINGS_KEY]: normalized })
    return this.listPricing()
  }

  async calculateCost(model: string, usage: TokenUsageForCost): Promise<CostBreakdown> {
    const pricing = await this.listPricing()
    const matched = findPricing(model, pricing)
    if (!matched) {
      return {
        inputCostUsd: 0,
        outputCostUsd: 0,
        cacheReadCostUsd: 0,
        cacheCreationCostUsd: 0,
        totalCostUsd: 0,
      }
    }

    const billableInputTokens = Math.max(0, usage.inputTokens - usage.cacheReadTokens)
    const million = 1_000_000
    const inputCostUsd = billableInputTokens * toMoneyNumber(matched.inputCostPerMillion) / million
    const outputCostUsd = usage.outputTokens * toMoneyNumber(matched.outputCostPerMillion) / million
    const cacheReadCostUsd = usage.cacheReadTokens * toMoneyNumber(matched.cacheReadCostPerMillion) / million
    const cacheCreationCostUsd = usage.cacheCreationTokens * toMoneyNumber(matched.cacheCreationCostPerMillion) / million
    const totalCostUsd = inputCostUsd + outputCostUsd + cacheReadCostUsd + cacheCreationCostUsd

    return {
      inputCostUsd,
      outputCostUsd,
      cacheReadCostUsd,
      cacheCreationCostUsd,
      totalCostUsd,
      matchedPricing: matched,
    }
  }
}

function mergePricing(defaults: ModelPricing[], custom: ModelPricing[]): ModelPricing[] {
  const byId = new Map(defaults.map((item) => [normalizeModelId(item.modelId), item]))
  for (const item of custom) {
    byId.set(normalizeModelId(item.modelId), item)
  }
  return [...byId.values()].sort((a, b) => a.modelId.localeCompare(b.modelId))
}

function findPricing(model: string, pricing: ModelPricing[]): ModelPricing | undefined {
  const normalized = normalizeModelId(model)
  return pricing.find((item) => normalizeModelId(item.modelId) === normalized)
    ?? pricing.find((item) => normalized.startsWith(normalizeModelId(item.modelId)))
    ?? pricing.find((item) => normalized.includes(normalizeModelId(item.modelId)))
}

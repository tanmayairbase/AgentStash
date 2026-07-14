import type { SessionTokenUsage, TokenUsageSource } from './types'

export type Provider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'github'
  | 'microsoft'
  | 'moonshot'

export interface ModelRate {
  provider: Provider
  input: number
  cachedInput: number
  cacheWrite: number
  cacheWrite1h?: number
  output: number
}

const RATES: Record<string, ModelRate> = {
  // OpenAI
  'gpt-5-mini': {
    provider: 'openai',
    input: 0.25,
    cachedInput: 0.025,
    cacheWrite: 0,
    output: 2
  },
  'gpt-5.3-codex': {
    provider: 'openai',
    input: 1.75,
    cachedInput: 0.175,
    cacheWrite: 0,
    output: 14
  },
  'gpt-5.4': {
    provider: 'openai',
    input: 2.5,
    cachedInput: 0.25,
    cacheWrite: 0,
    output: 15
  },
  'gpt-5.4-mini': {
    provider: 'openai',
    input: 0.75,
    cachedInput: 0.075,
    cacheWrite: 0,
    output: 4.5
  },
  'gpt-5.4-nano': {
    provider: 'openai',
    input: 0.2,
    cachedInput: 0.02,
    cacheWrite: 0,
    output: 1.25
  },
  'gpt-5.5': {
    provider: 'openai',
    input: 5,
    cachedInput: 0.5,
    cacheWrite: 0,
    output: 30
  },
  'gpt-5.6-luna': {
    provider: 'openai',
    input: 1,
    cachedInput: 0.1,
    cacheWrite: 0,
    output: 6
  },
  'gpt-5.6-sol': {
    provider: 'openai',
    input: 5,
    cachedInput: 0.5,
    cacheWrite: 0,
    output: 30
  },
  'gpt-5.6-terra': {
    provider: 'openai',
    input: 2.5,
    cachedInput: 0.25,
    cacheWrite: 0,
    output: 15
  },
  // Anthropic
  'claude-haiku-4.5': {
    provider: 'anthropic',
    input: 1,
    cachedInput: 0.1,
    cacheWrite: 1.25,
    output: 5
  },
  'claude-sonnet-4': {
    provider: 'anthropic',
    input: 3,
    cachedInput: 0.3,
    cacheWrite: 3.75,
    output: 15
  },
  'claude-sonnet-4.5': {
    provider: 'anthropic',
    input: 3,
    cachedInput: 0.3,
    cacheWrite: 3.75,
    output: 15
  },
  'claude-sonnet-4.6': {
    provider: 'anthropic',
    input: 3,
    cachedInput: 0.3,
    cacheWrite: 3.75,
    output: 15
  },
  'claude-opus-4.5': {
    provider: 'anthropic',
    input: 5,
    cachedInput: 0.5,
    cacheWrite: 6.25,
    output: 25
  },
  'claude-opus-4.6': {
    provider: 'anthropic',
    input: 5,
    cachedInput: 0.5,
    cacheWrite: 6.25,
    output: 25
  },
  'claude-opus-4.7': {
    provider: 'anthropic',
    input: 5,
    cachedInput: 0.5,
    cacheWrite: 6.25,
    output: 25
  },
  'claude-opus-4.8': {
    provider: 'anthropic',
    input: 5,
    cachedInput: 0.5,
    cacheWrite: 6.25,
    output: 25
  },
  // Promotional pricing through 2026-08-31; the page lists no other rate.
  'claude-sonnet-5': {
    provider: 'anthropic',
    input: 2,
    cachedInput: 0.2,
    cacheWrite: 2.5,
    output: 10
  },
  'claude-fable-5': {
    provider: 'anthropic',
    input: 10,
    cachedInput: 1,
    cacheWrite: 12.5,
    output: 50
  },
  // Google
  'gemini-2.5-pro': {
    provider: 'google',
    input: 1.25,
    cachedInput: 0.125,
    cacheWrite: 0,
    output: 10
  },
  'gemini-3-flash': {
    provider: 'google',
    input: 0.5,
    cachedInput: 0.05,
    cacheWrite: 0,
    output: 3
  },
  'gemini-3.1-pro': {
    provider: 'google',
    input: 2,
    cachedInput: 0.2,
    cacheWrite: 0,
    output: 12
  },
  'gemini-3.5-flash': {
    provider: 'google',
    input: 1.5,
    cachedInput: 0.15,
    cacheWrite: 0,
    output: 9
  },
  // GitHub fine-tuned
  'raptor-mini': {
    provider: 'github',
    input: 0.25,
    cachedInput: 0.025,
    cacheWrite: 0,
    output: 2
  },
  // Microsoft
  'mai-code-1-flash': {
    provider: 'microsoft',
    input: 0.75,
    cachedInput: 0.075,
    cacheWrite: 0,
    output: 4.5
  },
  // Moonshot AI
  'kimi-k2.7-code': {
    provider: 'moonshot',
    input: 0.95,
    cachedInput: 0.19,
    cacheWrite: 0,
    output: 4
  }
}

const normalizeModelId = (modelId: string): string => {
  return modelId.toLowerCase().replace(/-preview$/, '')
}

export const providerOf = (modelId: string): Provider | null => {
  const m = modelId.toLowerCase()
  if (m.startsWith('gpt-') || /^o[13](-|$)/.test(m)) return 'openai'
  if (m.startsWith('claude-')) return 'anthropic'
  if (m.startsWith('gemini-')) return 'google'
  if (m === 'raptor-mini') return 'github'
  if (m.startsWith('mai-')) return 'microsoft'
  if (m.startsWith('kimi-')) return 'moonshot'
  return null
}

export const priceFor = (modelId: string): ModelRate | null => {
  return RATES[normalizeModelId(modelId)] ?? null
}

// Claude Code's own billing (subscription, API key, or enterprise contract) is
// unrelated to the Copilot-served Anthropic rates in RATES above, even where a
// number happens to coincide — keep this table and lookup entirely separate.
// Prices are Anthropic's published API list prices, used as a labeled estimate.
const CLAUDE_CODE_RATES: Record<string, ModelRate> = {
  'claude-fable-5': {
    provider: 'anthropic',
    input: 10,
    cachedInput: 1,
    cacheWrite: 12.5,
    cacheWrite1h: 20,
    output: 50
  },
  'claude-mythos-5': {
    provider: 'anthropic',
    input: 10,
    cachedInput: 1,
    cacheWrite: 12.5,
    cacheWrite1h: 20,
    output: 50
  },
  'claude-opus-4-8': {
    provider: 'anthropic',
    input: 5,
    cachedInput: 0.5,
    cacheWrite: 6.25,
    cacheWrite1h: 10,
    output: 25
  },
  'claude-opus-4-7': {
    provider: 'anthropic',
    input: 5,
    cachedInput: 0.5,
    cacheWrite: 6.25,
    cacheWrite1h: 10,
    output: 25
  },
  'claude-opus-4-6': {
    provider: 'anthropic',
    input: 5,
    cachedInput: 0.5,
    cacheWrite: 6.25,
    cacheWrite1h: 10,
    output: 25
  },
  'claude-opus-4-5': {
    provider: 'anthropic',
    input: 5,
    cachedInput: 0.5,
    cacheWrite: 6.25,
    cacheWrite1h: 10,
    output: 25
  },
  // Sonnet 5 introductory pricing is in effect through 2026-08-31; standard
  // rates ($3 / $0.30 / $3.75 / $6 / $15) take over on 2026-09-01.
  'claude-sonnet-5': {
    provider: 'anthropic',
    input: 2,
    cachedInput: 0.2,
    cacheWrite: 2.5,
    cacheWrite1h: 4,
    output: 10
  },
  'claude-sonnet-4-6': {
    provider: 'anthropic',
    input: 3,
    cachedInput: 0.3,
    cacheWrite: 3.75,
    cacheWrite1h: 6,
    output: 15
  },
  'claude-haiku-4-5': {
    provider: 'anthropic',
    input: 1,
    cachedInput: 0.1,
    cacheWrite: 1.25,
    cacheWrite1h: 2,
    output: 5
  }
}

const normalizeClaudeCodeModelId = (modelId: string): string =>
  modelId.toLowerCase().replace(/-\d{8}$/, '')

export const priceForClaudeCodeModel = (modelId: string): ModelRate | null => {
  return CLAUDE_CODE_RATES[normalizeClaudeCodeModelId(modelId)] ?? null
}

export interface ModelTokenCounts {
  modelId: string
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  cacheWrite1hTokens: number
  outputTokens: number
  reasoningTokens: number
  requestCount?: number
}

const billableInputTokens = ({
  inputTokens,
  cachedInputTokens
}: Pick<ModelTokenCounts, 'inputTokens' | 'cachedInputTokens'>): number => {
  if (cachedInputTokens > 0 && cachedInputTokens <= inputTokens) {
    return inputTokens - cachedInputTokens
  }
  return inputTokens
}

export const computeCost = (counts: ModelTokenCounts): number | null => {
  const rate = priceFor(counts.modelId)
  if (!rate) return null
  const billableInput = billableInputTokens(counts)
  const billableOutput =
    rate.provider === 'anthropic'
      ? counts.outputTokens + counts.reasoningTokens
      : counts.outputTokens
  return (
    (billableInput * rate.input +
      counts.cachedInputTokens * rate.cachedInput +
      counts.cacheWriteTokens * rate.cacheWrite +
      billableOutput * rate.output) /
    1_000_000
  )
}

// Claude's own usage.input_tokens already EXCLUDES cached tokens (unlike the
// inclusive accounting billableInputTokens assumes), so it's billed as-is with
// no subtraction. Thinking tokens are already folded into outputTokens at the
// source, so reasoningTokens is intentionally not added here.
export const computeClaudeCodeCost = (counts: ModelTokenCounts): number | null => {
  const rate = priceForClaudeCodeModel(counts.modelId)
  if (!rate) return null
  return (
    (counts.inputTokens * rate.input +
      counts.cachedInputTokens * rate.cachedInput +
      counts.cacheWriteTokens * rate.cacheWrite +
      counts.cacheWrite1hTokens * (rate.cacheWrite1h ?? 0) +
      counts.outputTokens * rate.output) /
    1_000_000
  )
}

// Claude Code sessions (source 'claude-messages') are priced from Anthropic's
// published list rates; every other source is served through Copilot and uses
// the Copilot rate table. Keep this the single place that maps source → rates
// so the tooltip, session stats, and session estimate can't drift apart.
export const costFnForSource = (
  source: TokenUsageSource
): ((counts: ModelTokenCounts) => number | null) =>
  source === 'claude-messages' ? computeClaudeCodeCost : computeCost

export type CostTier = '$' | '$$' | '$$$'
export type SessionCostCategory = CostTier | 'unavailable'

export const costTier = (costUsd: number | null): CostTier | null => {
  if (costUsd === null || costUsd === undefined || Number.isNaN(costUsd)) {
    return null
  }
  if (costUsd < 2) return '$'
  if (costUsd < 5) return '$$'
  return '$$$'
}

export const sessionEstimatedCost = (
  usage: SessionTokenUsage | undefined
): number | null => {
  if (!usage || usage.source === 'unavailable') {
    return null
  }

  const computeModelCost = costFnForSource(usage.source)

  let total = 0
  let priced = false
  for (const model of usage.byModel) {
    const cost = computeModelCost(model)
    if (cost !== null) {
      total += cost
      priced = true
    }
  }

  return priced ? total : null
}

export const sessionCostCategory = (
  usage: SessionTokenUsage | undefined
): SessionCostCategory => {
  return costTier(sessionEstimatedCost(usage)) ?? 'unavailable'
}

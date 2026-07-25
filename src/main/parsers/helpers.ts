import { createHash } from 'node:crypto'
import type {
  ModelTokenUsage,
  SessionExecutionMode,
  SessionMessage,
  SessionSource,
  SessionSummary,
  SessionTokenUsage,
  SessionTokenUsageTotals,
  TokenUsageSource
} from '../../shared/types'

export interface ParseContext {
  filePath: string
  repoRoot: string
  source: SessionSource
  cliSummaryBySessionId?: ReadonlyMap<string, string>
}

export interface ParsedSession {
  session: SessionSummary
  messages: SessionMessage[]
}

export const stableId = (...parts: string[]): string =>
  createHash('sha1').update(parts.join('::')).digest('hex')

const asString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return null
}

export const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    const candidate = asString(value)
    if (candidate) {
      return candidate
    }
  }
  return null
}

const BUILT_IN_TASK_AGENTS = new Set([
  'explore',
  'task',
  'general-purpose',
  'code-review',
  'configure-copilot'
])

export const normalizeAgent = (value: unknown): string | null => {
  const normalized = firstString(value)?.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return null
  }
  const lowered = normalized.toLowerCase()
  if (lowered === 'copilot-agent' || BUILT_IN_TASK_AGENTS.has(lowered)) {
    return null
  }
  return normalized
}

export const inferSource = (
  filePath: string,
  fallback: SessionSource = 'cli'
): SessionSource => {
  const normalized = filePath.toLowerCase()
  if (normalized.includes('opencode')) {
    return 'opencode'
  }
  if (
    normalized.includes('/.vscode/') ||
    normalized.includes('\\.vscode\\') ||
    normalized.includes('vscode')
  ) {
    return 'vscode'
  }
  if (normalized.includes('copilot-cli') || normalized.includes('copilotcli')) {
    return 'cli'
  }
  return fallback
}

export const sourceFromHint = (value: unknown): SessionSource | null => {
  const hint = firstString(value)?.toLowerCase()
  if (!hint) {
    return null
  }
  if (
    hint.includes('vscode') ||
    hint.includes('visual studio code') ||
    hint.includes('cursor')
  ) {
    return 'vscode'
  }
  if (hint.includes('opencode') || hint.includes('open code')) {
    return 'opencode'
  }
  if (hint.includes('cli') || hint.includes('terminal')) {
    return 'cli'
  }
  return null
}

export const inferFormat = (value: string): SessionMessage['format'] => {
  if (value.includes('\u001b[')) {
    return 'ansi'
  }
  if (/```|^#\s|\n\s*[-*]\s|\n\s*\n/m.test(value)) {
    return 'markdown'
  }
  return 'text'
}

export const toIso = (
  value: unknown,
  fallback = new Date().toISOString()
): string => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000
    return new Date(millis).toISOString()
  }

  const numericValue = Number(value)
  if (Number.isFinite(numericValue) && numericValue > 0) {
    const millis =
      numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000
    return new Date(millis).toISOString()
  }

  const asText = firstString(value)
  if (asText) {
    const date = new Date(asText)
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString()
    }
  }

  return fallback
}

export const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

export const parseJsonLines = (raw: string): unknown[] => {
  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  const output: unknown[] = []
  for (const line of lines) {
    try {
      output.push(JSON.parse(line))
    } catch {
      continue
    }
  }
  return output
}

export const asNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

export const ZERO_TOTALS: SessionTokenUsageTotals = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite1hTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0
}

export const sumModelTotals = (
  byModel: ModelTokenUsage[]
): SessionTokenUsageTotals =>
  byModel.reduce<SessionTokenUsageTotals>(
    (acc, entry) => ({
      inputTokens: acc.inputTokens + entry.inputTokens,
      cachedInputTokens: acc.cachedInputTokens + entry.cachedInputTokens,
      cacheWriteTokens: acc.cacheWriteTokens + entry.cacheWriteTokens,
      cacheWrite1hTokens: acc.cacheWrite1hTokens + entry.cacheWrite1hTokens,
      outputTokens: acc.outputTokens + entry.outputTokens,
      reasoningTokens: acc.reasoningTokens + entry.reasoningTokens
    }),
    { ...ZERO_TOTALS }
  )

export const aggregateTokenUsageByModel = (
  entries: readonly ModelTokenUsage[],
  source: Exclude<TokenUsageSource, 'unavailable'>
): SessionTokenUsage => {
  const byModelMap = new Map<string, ModelTokenUsage>()
  for (const entry of entries) {
    const current = byModelMap.get(entry.modelId) ?? {
      modelId: entry.modelId,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0
    }
    current.inputTokens += entry.inputTokens
    current.cachedInputTokens += entry.cachedInputTokens
    current.cacheWriteTokens += entry.cacheWriteTokens
    current.cacheWrite1hTokens += entry.cacheWrite1hTokens
    current.outputTokens += entry.outputTokens
    current.reasoningTokens += entry.reasoningTokens
    byModelMap.set(entry.modelId, current)
  }

  const byModel = [...byModelMap.values()]
  return byModel.length > 0
    ? { source, byModel, totals: sumModelTotals(byModel) }
    : { source: 'unavailable', byModel: [], totals: { ...ZERO_TOTALS } }
}

export const appendExecutionMode = (
  modes: SessionExecutionMode[],
  mode: SessionExecutionMode | null
): void => {
  if (!mode || modes[modes.length - 1] === mode) {
    return
  }
  modes.push(mode)
}

import type { ReactElement } from 'react'
import {
  costFnForSource,
  providerOf,
  type Provider
} from '../../../shared/pricing'
import type { ModelTokenUsage, SessionTokenUsage } from '../../../shared/types'

export interface TokenUsageTooltipContentProps {
  usage: SessionTokenUsage
}

const fmt = (n: number): string => n.toLocaleString()

const fmtUsd = (n: number): string => {
  if (n < 0.01 && n > 0) return '<$0.01'
  return `$${n.toFixed(2)}`
}

interface ModelLine {
  testid: string
  cssVar: string
  label: string
  value: string
}

const buildLines = (
  m: ModelTokenUsage,
  provider: Provider | null
): ModelLine[] => {
  const lines: ModelLine[] = []
  if (m.inputTokens > 0) {
    lines.push({
      testid: `tooltip-line-input-${m.modelId}`,
      cssVar: 'var(--token-bar-input)',
      label: 'Input',
      value: fmt(m.inputTokens)
    })
  }
  if (m.cachedInputTokens > 0) {
    lines.push({
      testid: `tooltip-line-cached-${m.modelId}`,
      cssVar: 'var(--token-bar-cached)',
      label: 'Cached read',
      value: fmt(m.cachedInputTokens)
    })
  }
  if (m.cacheWriteTokens > 0) {
    lines.push({
      testid: `tooltip-line-cache-write-${m.modelId}`,
      cssVar: 'var(--token-bar-cache-write)',
      label: 'Cache write',
      value: fmt(m.cacheWriteTokens)
    })
  }
  if (m.outputTokens > 0) {
    const reasoningInline =
      provider !== 'anthropic' && m.reasoningTokens > 0
        ? ` (incl. ${fmt(m.reasoningTokens)} reasoning)`
        : ''
    lines.push({
      testid: `tooltip-line-output-${m.modelId}`,
      cssVar: 'var(--token-bar-output)',
      label: 'Output',
      value: `${fmt(m.outputTokens)}${reasoningInline}`
    })
  }
  if (provider === 'anthropic' && m.reasoningTokens > 0) {
    lines.push({
      testid: `tooltip-line-reasoning-${m.modelId}`,
      cssVar: 'var(--token-bar-output)',
      label: 'Reasoning',
      value: fmt(m.reasoningTokens)
    })
  }
  return lines
}

export function TokenUsageTooltipContent({
  usage
}: TokenUsageTooltipContentProps): ReactElement {
  if (usage.source === 'unavailable') {
    return (
      <div className="token-tooltip">
        <p className="token-tooltip__unavailable">
          Token usage not reported for this session.
        </p>
      </div>
    )
  }

  const isClaudeCode = usage.source === 'claude-messages'
  const computeModelCost = costFnForSource(usage.source)

  const modelBlocks = usage.byModel.map(m => {
    const provider = providerOf(m.modelId)
    const cost = computeModelCost(m)
    return { model: m, provider, cost, lines: buildLines(m, provider) }
  })
  const pricedCosts = modelBlocks
    .map(b => b.cost)
    .filter((c): c is number => c !== null)
  const anyCost = pricedCosts.length > 0
  const totalCostUsd = pricedCosts.reduce((sum, c) => sum + c, 0)

  return (
    <div className="token-tooltip" role="tooltip">
      {modelBlocks.map(({ model, lines }) => (
        <section key={model.modelId} className="token-tooltip__model">
          <header className="token-tooltip__model-name">{model.modelId}</header>
          <ul className="token-tooltip__lines">
            {lines.map(line => (
              <li
                key={line.testid}
                data-testid={line.testid}
                className="token-tooltip__line"
              >
                <span
                  className="token-tooltip__dot"
                  style={{ background: line.cssVar }}
                  aria-hidden="true"
                />
                <span className="token-tooltip__label">{line.label}</span>
                <span className="token-tooltip__value">{line.value}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {anyCost ? (
        <footer className="token-tooltip__cost-row">
          <span className="token-tooltip__cost-label">Est. cost</span>
          <span
            className="token-tooltip__cost-value"
            data-testid="tooltip-est-cost"
          >
            {fmtUsd(totalCostUsd)}
          </span>
          <small className="token-tooltip__footnote">
            {isClaudeCode
              ? 'Based on Anthropic list pricing; final billing may differ.'
              : 'Based on public Copilot model pricing; final billing may differ.'}
          </small>
        </footer>
      ) : null}
    </div>
  )
}

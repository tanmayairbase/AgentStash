import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TokenUsageTooltipContent } from '../src/renderer/src/components/TokenUsageTooltipContent'
import type { ModelTokenUsage, SessionTokenUsage } from '../src/shared/types'

const model = (overrides: Partial<ModelTokenUsage> & { modelId: string }): ModelTokenUsage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite1hTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  ...overrides
})

const usage = (byModel: ModelTokenUsage[]): SessionTokenUsage => {
  const totals = byModel.reduce(
    (acc, m) => ({
      inputTokens: acc.inputTokens + m.inputTokens,
      cachedInputTokens: acc.cachedInputTokens + m.cachedInputTokens,
      cacheWriteTokens: acc.cacheWriteTokens + m.cacheWriteTokens,
      cacheWrite1hTokens: acc.cacheWrite1hTokens + m.cacheWrite1hTokens,
      outputTokens: acc.outputTokens + m.outputTokens,
      reasoningTokens: acc.reasoningTokens + m.reasoningTokens
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0
    }
  )
  return { source: 'cli-shutdown', byModel, totals }
}

describe('TokenUsageTooltipContent', () => {
  it('shows OpenAI reasoning inline with output', () => {
    render(
      <TokenUsageTooltipContent
        usage={usage([
          model({
            modelId: 'gpt-5.4',
            inputTokens: 1000,
            outputTokens: 500,
            reasoningTokens: 200
          })
        ])}
      />
    )
    const output = screen.getByTestId('tooltip-line-output-gpt-5.4')
    expect(output.textContent).toMatch(/500/)
    expect(output.textContent).toMatch(/incl\..*200.*reasoning/i)
    expect(screen.queryByTestId('tooltip-line-reasoning-gpt-5.4')).toBeNull()
  })

  it('shows Anthropic reasoning on its own line', () => {
    render(
      <TokenUsageTooltipContent
        usage={usage([
          model({
            modelId: 'claude-opus-4.7',
            inputTokens: 1000,
            outputTokens: 500,
            reasoningTokens: 200
          })
        ])}
      />
    )
    const output = screen.getByTestId('tooltip-line-output-claude-opus-4.7')
    expect(output.textContent).not.toMatch(/incl\./i)
    const reasoning = screen.getByTestId('tooltip-line-reasoning-claude-opus-4.7')
    expect(reasoning.textContent).toMatch(/200/)
  })

  it('omits zero-valued lines', () => {
    render(
      <TokenUsageTooltipContent
        usage={usage([
          model({ modelId: 'gpt-5.4', inputTokens: 1000, outputTokens: 0 })
        ])}
      />
    )
    expect(screen.queryByTestId('tooltip-line-input-gpt-5.4')).not.toBeNull()
    expect(screen.queryByTestId('tooltip-line-output-gpt-5.4')).toBeNull()
    expect(screen.queryByTestId('tooltip-line-cached-gpt-5.4')).toBeNull()
    expect(screen.queryByTestId('tooltip-line-cache-write-gpt-5.4')).toBeNull()
  })

  it('renders the estimated cost in USD', () => {
    render(
      <TokenUsageTooltipContent
        usage={usage([
          model({
            modelId: 'gpt-5.4',
            inputTokens: 1_000_000,
            outputTokens: 1_000_000
          })
        ])}
      />
    )
    // gpt-5.4: input $2.50 + output $15 = $17.50
    expect(screen.getByTestId('tooltip-est-cost').textContent).toMatch(/\$17\.50/)
  })

  it('shows a not-reported message when source is unavailable', () => {
    render(
      <TokenUsageTooltipContent
        usage={{
          source: 'unavailable',
          byModel: [],
          totals: {
            inputTokens: 0,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            cacheWrite1hTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0
          }
        }}
      />
    )
    expect(screen.getByText(/not reported/i)).not.toBeNull()
    expect(screen.queryByTestId('tooltip-est-cost')).toBeNull()
  })

  it('prices Claude Code sessions with Anthropic list rates, not Copilot rates', () => {
    render(
      <TokenUsageTooltipContent
        usage={{
          source: 'claude-messages',
          byModel: [
            model({
              modelId: 'claude-opus-4-8',
              inputTokens: 1_000_000,
              outputTokens: 1_000_000
            })
          ],
          totals: {
            inputTokens: 1_000_000,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            cacheWrite1hTokens: 0,
            outputTokens: 1_000_000,
            reasoningTokens: 0
          }
        }}
      />
    )
    // claude-opus-4-8 Anthropic list: input $5 + output $25 = $30.00
    // (the Copilot rate table keys on dots, so it would have priced this at $0.)
    expect(screen.getByTestId('tooltip-est-cost').textContent).toMatch(/\$30\.00/)
    expect(screen.getByText(/Anthropic list pricing/i)).not.toBeNull()
    expect(screen.queryByText(/Copilot/i)).toBeNull()
  })

  it('keeps the Copilot footnote for non-Claude-Code sessions', () => {
    render(
      <TokenUsageTooltipContent
        usage={usage([model({ modelId: 'gpt-5.4', inputTokens: 1000 })])}
      />
    )
    expect(screen.getByText(/Copilot model pricing/i)).not.toBeNull()
  })
})

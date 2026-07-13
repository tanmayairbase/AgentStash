import { describe, expect, it } from 'vitest'
import type { ModelTokenUsage, SessionTokenUsage } from '../src/shared/types'
import {
  computeClaudeCodeCost,
  computeCost,
  costTier,
  priceFor,
  priceForClaudeCodeModel,
  providerOf,
  sessionCostCategory,
  sessionEstimatedCost
} from '../src/shared/pricing'

const modelUsage = (
  overrides: Partial<ModelTokenUsage> & { modelId: string }
): ModelTokenUsage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite1hTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  ...overrides
})

const usage = (
  byModel: ModelTokenUsage[],
  source: SessionTokenUsage['source'] = 'cli-shutdown'
): SessionTokenUsage => ({
  source,
  byModel,
  totals: byModel.reduce(
    (totals, model) => ({
      inputTokens: totals.inputTokens + model.inputTokens,
      cachedInputTokens: totals.cachedInputTokens + model.cachedInputTokens,
      cacheWriteTokens: totals.cacheWriteTokens + model.cacheWriteTokens,
      cacheWrite1hTokens: totals.cacheWrite1hTokens + model.cacheWrite1hTokens,
      outputTokens: totals.outputTokens + model.outputTokens,
      reasoningTokens: totals.reasoningTokens + model.reasoningTokens
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
})

describe('priceFor', () => {
  it('returns the OpenAI rate for gpt-5.4', () => {
    const rate = priceFor('gpt-5.4')
    expect(rate).toEqual({
      provider: 'openai',
      input: 2.5,
      cachedInput: 0.25,
      cacheWrite: 0,
      output: 15
    })
  })

  it.each([
    // OpenAI — no cache write
    ['gpt-5-mini', 'openai', 0.25, 0.025, 0, 2],
    ['gpt-5.3-codex', 'openai', 1.75, 0.175, 0, 14],
    ['gpt-5.4', 'openai', 2.5, 0.25, 0, 15],
    ['gpt-5.4-mini', 'openai', 0.75, 0.075, 0, 4.5],
    ['gpt-5.4-nano', 'openai', 0.2, 0.02, 0, 1.25],
    ['gpt-5.5', 'openai', 5, 0.5, 0, 30],
    ['gpt-5.6-luna', 'openai', 1, 0.1, 0, 6],
    ['gpt-5.6-sol', 'openai', 5, 0.5, 0, 30],
    ['gpt-5.6-terra', 'openai', 2.5, 0.25, 0, 15],
    // Anthropic — has cache write
    ['claude-haiku-4.5', 'anthropic', 1, 0.1, 1.25, 5],
    ['claude-sonnet-4', 'anthropic', 3, 0.3, 3.75, 15],
    ['claude-sonnet-4.5', 'anthropic', 3, 0.3, 3.75, 15],
    ['claude-sonnet-4.6', 'anthropic', 3, 0.3, 3.75, 15],
    ['claude-sonnet-5', 'anthropic', 2, 0.2, 2.5, 10],
    ['claude-opus-4.5', 'anthropic', 5, 0.5, 6.25, 25],
    ['claude-opus-4.6', 'anthropic', 5, 0.5, 6.25, 25],
    ['claude-opus-4.7', 'anthropic', 5, 0.5, 6.25, 25],
    ['claude-opus-4.8', 'anthropic', 5, 0.5, 6.25, 25],
    ['claude-fable-5', 'anthropic', 10, 1, 12.5, 50],
    // Google — no cache write
    ['gemini-2.5-pro', 'google', 1.25, 0.125, 0, 10],
    ['gemini-3-flash', 'google', 0.5, 0.05, 0, 3],
    ['gemini-3.1-pro', 'google', 2, 0.2, 0, 12],
    ['gemini-3.5-flash', 'google', 1.5, 0.15, 0, 9],
    // GitHub fine-tuned
    ['raptor-mini', 'github', 0.25, 0.025, 0, 2],
    // Microsoft
    ['mai-code-1-flash', 'microsoft', 0.75, 0.075, 0, 4.5],
    // Moonshot AI
    ['kimi-k2.7-code', 'moonshot', 0.95, 0.19, 0, 4]
  ])(
    '%s → %s rate (in=%s, cached=%s, cacheWrite=%s, out=%s)',
    (modelId, provider, input, cachedInput, cacheWrite, output) => {
      expect(priceFor(modelId as string)).toEqual({
        provider,
        input,
        cachedInput,
        cacheWrite,
        output
      })
    }
  )

  it('strips -preview suffix when matching gemini ids', () => {
    expect(priceFor('gemini-3.1-pro-preview')).toEqual(
      priceFor('gemini-3.1-pro')
    )
  })

  it('is case-insensitive', () => {
    expect(priceFor('GPT-5.4')).toEqual(priceFor('gpt-5.4'))
  })

  it('returns null for unknown models', () => {
    expect(priceFor('made-up-model-x')).toBeNull()
  })
})

describe('priceForClaudeCodeModel', () => {
  it('returns the Claude Code list-price rate for claude-opus-4-8, distinct from the Copilot rate table', () => {
    expect(priceForClaudeCodeModel('claude-opus-4-8')).toEqual({
      provider: 'anthropic',
      input: 5,
      cachedInput: 0.5,
      cacheWrite: 6.25,
      cacheWrite1h: 10,
      output: 25
    })
  })

  it('resolves a dated snapshot id to the same rate as the bare alias', () => {
    expect(priceForClaudeCodeModel('claude-haiku-4-5-20251001')).toEqual(
      priceForClaudeCodeModel('claude-haiku-4-5')
    )
  })

  it('returns null for an unknown Claude model id', () => {
    expect(priceForClaudeCodeModel('claude-made-up-model')).toBeNull()
  })
})

describe('providerOf', () => {
  it.each([
    ['gpt-5.4', 'openai'],
    ['gpt-5.6-luna', 'openai'],
    ['o1-preview', 'openai'],
    ['o3-mini', 'openai'],
    ['claude-opus-4.8', 'anthropic'],
    ['claude-sonnet-5', 'anthropic'],
    ['claude-fable-5', 'anthropic'],
    ['gemini-3.1-pro-preview', 'google'],
    ['gemini-2.5-pro', 'google'],
    ['gemini-3.5-flash', 'google'],
    ['raptor-mini', 'github'],
    ['mai-code-1-flash', 'microsoft'],
    ['kimi-k2.7-code', 'moonshot']
  ])('classifies %s as %s', (modelId, provider) => {
    expect(providerOf(modelId)).toBe(provider)
  })

  it('returns null for unknown model ids', () => {
    expect(providerOf('mystery-llm-9000')).toBeNull()
  })
})

describe('computeCost', () => {
  it('does not double-count reasoning for OpenAI (already inside outputTokens)', () => {
    // gpt-5.4: input=$2.50, cached=$0.25, output=$15.00 per 1M
    // Sample: 249,568 input · 211,328 cached · 4,904 output (incl. 3,167 reasoning)
    const cost = computeCost({
      modelId: 'gpt-5.4',
      inputTokens: 249_568,
      cachedInputTokens: 211_328,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 4_904,
      reasoningTokens: 3_167
    })
    // expected = ((249568-211328)*2.5 + 211328*0.25 + 4904*15) / 1_000_000
    //         = (95_600 + 52_832 + 73_560) / 1_000_000
    //         = 0.221992
    expect(cost).toBeCloseTo(0.221992, 6)
  })

  it('adds reasoning to output for Anthropic and bills cache writes', () => {
    // claude-opus-4.7: input=$5, cached=$0.5, cacheWrite=$6.25, output=$25
    const cost = computeCost({
      modelId: 'claude-opus-4.7',
      inputTokens: 100_000,
      cachedInputTokens: 50_000,
      cacheWriteTokens: 20_000,
      cacheWrite1hTokens: 0,
      outputTokens: 4_000,
      reasoningTokens: 1_000
    })
    // expected = ((100000-50000)*5 + 50000*0.5 + 20000*6.25 + (4000+1000)*25) / 1e6
    //         = (250_000 + 25_000 + 125_000 + 125_000) / 1e6
    //         = 0.525
    expect(cost).toBeCloseTo(0.525, 6)
  })

  it('keeps input fully billable when cached reads exceed input', () => {
    const cost = computeCost({
      modelId: 'gpt-5.4',
      inputTokens: 1_000,
      cachedInputTokens: 1_200,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 100,
      reasoningTokens: 0
    })
    expect(cost).toBeCloseTo(0.0043, 6)
  })

  it('returns null for an unknown model (no rate)', () => {
    expect(
      computeCost({
        modelId: 'mystery-llm-9000',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        cacheWrite1hTokens: 0,
        outputTokens: 1_000_000,
        reasoningTokens: 0
      })
    ).toBeNull()
  })

  it('returns 0 for a known model with all-zero counts', () => {
    expect(
      computeCost({
        modelId: 'gpt-5.4',
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        cacheWrite1hTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0
      })
    ).toBe(0)
  })
})

describe('computeClaudeCodeCost', () => {
  it('bills inputTokens in full without subtracting cachedInputTokens (cache-exclusive accounting)', () => {
    // claude-sonnet-4-6: input=$3, cached=$0.3 per 1M.
    // Claude's input_tokens already EXCLUDES cached tokens, unlike computeCost's
    // assumption — so even though cachedInputTokens (200) <= inputTokens (1000)
    // here, none of it should be subtracted from the input bill.
    const cost = computeClaudeCodeCost({
      modelId: 'claude-sonnet-4-6',
      inputTokens: 1_000,
      cachedInputTokens: 200,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0
    })
    // expected = (1000*3 + 200*0.3) / 1e6 = (3000 + 60) / 1e6 = 0.00306
    expect(cost).toBeCloseTo(0.00306, 8)
  })

  it('bills the 5m and 1h cache-write buckets at their distinct rates', () => {
    // claude-opus-4-8: cacheWrite (5m) = $6.25, cacheWrite1h = $10 per 1M.
    const cost = computeClaudeCodeCost({
      modelId: 'claude-opus-4-8',
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 1_000,
      cacheWrite1hTokens: 1_000,
      outputTokens: 0,
      reasoningTokens: 0
    })
    // expected = (1000*6.25 + 1000*10) / 1e6 = (6250 + 10000) / 1e6 = 0.01625
    expect(cost).toBeCloseTo(0.01625, 8)
  })

  it('does not double-count reasoningTokens (already folded into outputTokens at the source)', () => {
    const withoutReasoning = computeClaudeCodeCost({
      modelId: 'claude-sonnet-4-6',
      inputTokens: 1_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 500,
      reasoningTokens: 0
    })
    const withReasoning = computeClaudeCodeCost({
      modelId: 'claude-sonnet-4-6',
      inputTokens: 1_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 500,
      reasoningTokens: 9_999
    })
    expect(withReasoning).toBe(withoutReasoning)
  })

  it('returns null for an unknown Claude model', () => {
    expect(
      computeClaudeCodeCost({
        modelId: 'claude-made-up-model',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        cacheWrite1hTokens: 0,
        outputTokens: 1_000_000,
        reasoningTokens: 0
      })
    ).toBeNull()
  })
})

describe('costTier', () => {
  it.each([
    [0, '$'],
    [0.75, '$'],
    [1.99, '$'],
    [2, '$$'],
    [3.5, '$$'],
    [4.99, '$$'],
    [5, '$$$'],
    [42, '$$$']
  ])('%s USD → %s', (cost, tier) => {
    expect(costTier(cost)).toBe(tier)
  })

  it('returns null when cost is null (unavailable)', () => {
    expect(costTier(null)).toBeNull()
  })
})

describe('sessionEstimatedCost', () => {
  it('totals only the priced models in a session', () => {
    expect(
      sessionEstimatedCost(
        usage([
          modelUsage({
            modelId: 'gpt-5.4',
            inputTokens: 200_000,
            outputTokens: 200_000
          }),
          modelUsage({
            modelId: 'completely-unknown-model',
            inputTokens: 999_999,
            outputTokens: 999_999
          })
        ])
      )
    ).toBeCloseTo(3.5, 6)
  })

  it('returns null when no total cost can be computed', () => {
    expect(
      sessionEstimatedCost(
        usage([
          modelUsage({
            modelId: 'completely-unknown-model',
            inputTokens: 1000,
            outputTokens: 1000
          })
        ])
      )
    ).toBeNull()
    expect(sessionEstimatedCost(usage([], 'unavailable'))).toBeNull()
    expect(sessionEstimatedCost(undefined)).toBeNull()
  })

  it('dispatches claude-messages usage to the Claude Code cost path, including the 1h cache-write bucket', () => {
    // claude-opus-4-8 only exists in the Claude Code rate table (dash-form id),
    // not the generic Copilot rate table (dot-form ids) — so if dispatch fell
    // through to the generic computeCost path, priceFor would return null for
    // this id and the whole session cost would be null instead of a real number.
    const cost = sessionEstimatedCost(
      usage(
        [
          modelUsage({
            modelId: 'claude-opus-4-8',
            inputTokens: 1_000,
            cacheWriteTokens: 1_000,
            cacheWrite1hTokens: 1_000,
            outputTokens: 0
          })
        ],
        'claude-messages'
      )
    )
    // expected = (1000*5 + 1000*6.25 + 1000*10) / 1e6 = 21250 / 1e6 = 0.02125
    expect(cost).toBeCloseTo(0.02125, 8)
  })
})

describe('sessionCostCategory', () => {
  it('maps a computed session total into the shared cost tiers', () => {
    expect(
      sessionCostCategory(
        usage([
          modelUsage({
            modelId: 'gpt-5.4-mini',
            inputTokens: 100_000,
            outputTokens: 100_000
          })
        ])
      )
    ).toBe('$')
    expect(
      sessionCostCategory(
        usage([
          modelUsage({
            modelId: 'gpt-5.4',
            inputTokens: 200_000,
            outputTokens: 200_000
          })
        ])
      )
    ).toBe('$$')
    expect(
      sessionCostCategory(
        usage([
          modelUsage({
            modelId: 'gpt-5.4',
            inputTokens: 500_000,
            outputTokens: 500_000
          })
        ])
      )
    ).toBe('$$$')
  })

  it('returns unavailable only when no session total exists', () => {
    expect(
      sessionCostCategory(
        usage([
          modelUsage({
            modelId: 'completely-unknown-model',
            inputTokens: 1000,
            outputTokens: 1000
          })
        ])
      )
    ).toBe('unavailable')
  })

  it('maps a claude-messages session total into the shared cost tiers', () => {
    expect(
      sessionCostCategory(
        usage(
          [
            modelUsage({
              modelId: 'claude-opus-4-8',
              inputTokens: 1_000_000,
              outputTokens: 0
            })
          ],
          'claude-messages'
        )
      )
    ).toBe('$$$') // 1_000_000 * $5/1M = $5 -> $$$
  })
})

import { describe, expect, it } from 'vitest'
import { aggregateSessionCostStats } from '../src/shared/session-stats'
import type { SessionSummary } from '../src/shared/types'

const session = (
  id: string,
  byModel: NonNullable<SessionSummary['tokenUsage']>['byModel']
): SessionSummary => ({
  id,
  source: 'cli',
  repoPath: '/repos/a',
  title: id,
  model: byModel[0]?.modelId ?? null,
  createdAt: '2026-03-10T10:00:00.000Z',
  updatedAt: '2026-03-10T10:30:00.000Z',
  messageCount: 1,
  filePath: `/repos/a/${id}.json`,
  openVscodeTarget: `/repos/a/${id}.json`,
  openCliCwd: '/repos/a',
  tokenUsage: {
    source: 'cli-shutdown',
    byModel,
    totals: byModel.reduce(
      (totals, model) => ({
        inputTokens: totals.inputTokens + model.inputTokens,
        cachedInputTokens: totals.cachedInputTokens + model.cachedInputTokens,
        cacheWriteTokens: totals.cacheWriteTokens + model.cacheWriteTokens,
        outputTokens: totals.outputTokens + model.outputTokens,
        reasoningTokens: totals.reasoningTokens + model.reasoningTokens
      }),
      {
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0
      }
    )
  }
})

describe('aggregateSessionCostStats', () => {
  it('aggregates total cost, priced sessions, unpriced sessions, and model totals', () => {
    const stats = aggregateSessionCostStats([
      session('budget', [
        {
          modelId: 'gpt-5.4-mini',
          inputTokens: 100_000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 100_000,
          reasoningTokens: 0
        }
      ]),
      session('medium', [
        {
          modelId: 'gpt-5.4',
          inputTokens: 200_000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 200_000,
          reasoningTokens: 0
        }
      ]),
      session('unknown', [
        {
          modelId: 'mystery-llm-9000',
          inputTokens: 10_000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 10_000,
          reasoningTokens: 0
        }
      ])
    ])

    expect(stats.sessionCount).toBe(3)
    expect(stats.pricedSessionCount).toBe(2)
    expect(stats.unpricedSessionCount).toBe(1)
    expect(stats.totalCostUsd).toBeCloseTo(4.025, 6)
    expect(stats.averageCostUsd).toBeCloseTo(2.0125, 6)
    expect(stats.models).toEqual([
      {
        modelId: 'gpt-5.4',
        totalCostUsd: 3.5,
        sessionCount: 1
      },
      {
        modelId: 'gpt-5.4-mini',
        totalCostUsd: 0.525,
        sessionCount: 1
      }
    ])
  })

  it('counts repeated priced models across sessions once per session in breakdown counts', () => {
    const stats = aggregateSessionCostStats([
      session('one', [
        {
          modelId: 'gpt-5.4-mini',
          inputTokens: 100_000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 100_000,
          reasoningTokens: 0
        }
      ]),
      session('two', [
        {
          modelId: 'gpt-5.4-mini',
          inputTokens: 200_000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 50_000,
          reasoningTokens: 0
        }
      ])
    ])

    expect(stats.models).toEqual([
      {
        modelId: 'gpt-5.4-mini',
        totalCostUsd: 0.375 + 0.525,
        sessionCount: 2
      }
    ])
  })
})

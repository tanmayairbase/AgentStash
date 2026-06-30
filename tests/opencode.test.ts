import { describe, expect, it } from 'vitest'
import {
  aggregateOpenCodeTokenUsage,
  isOpenCodeInternalMetadataSession,
  normalizeOpenCodeSessionTitle
} from '../src/main/opencode'

describe('OpenCode session helpers', () => {
  it('extracts plain title text from JSON-wrapped session titles', () => {
    expect(
      normalizeOpenCodeSessionTitle('{"title":"Mileage Without Maps spec"}')
    ).toBe('Mileage Without Maps spec')
    expect(normalizeOpenCodeSessionTitle('Regular title')).toBe('Regular title')
  })

  it('detects internal metadata generator sessions', () => {
    expect(
      isOpenCodeInternalMetadataSession(
        [
          {
            id: 'message-1',
            session_id: 'session-1',
            time_created: 1,
            time_updated: 1,
            data: JSON.stringify({
              role: 'user',
              agent: 'build'
            })
          }
        ],
        new Map([
          [
            'message-1',
            [
              {
                id: 'part-1',
                message_id: 'message-1',
                time_created: 1,
                data: JSON.stringify({
                  type: 'text',
                  text:
                    'Generate metadata for a coding agent based on the user prompt.\nReturn JSON only.'
                })
              }
            ]
          ]
        ])
      )
    ).toBe(true)
  })

  it('does not misclassify normal build-agent sessions as internal metadata sessions', () => {
    expect(
      isOpenCodeInternalMetadataSession(
        [
          {
            id: 'message-1',
            session_id: 'session-1',
            time_created: 1,
            time_updated: 1,
            data: JSON.stringify({
              role: 'user',
              agent: 'build'
            })
          }
        ],
        new Map([
          [
            'message-1',
            [
              {
                id: 'part-1',
                message_id: 'message-1',
                time_created: 1,
                data: JSON.stringify({
                  type: 'text',
                  text:
                    'Can we check if UUID package is completely unused in the codebase and if so create a draft PR?'
                })
              }
            ]
          ]
        ])
      )
    ).toBe(false)
  })
})

describe('aggregateOpenCodeTokenUsage', () => {
  const userRow = (id: string) => ({
    id,
    session_id: 'session-x',
    time_created: 1,
    time_updated: 1,
    data: JSON.stringify({ role: 'user' })
  })
  const assistantRow = (
    id: string,
    modelID: string,
    tokens: {
      input: number
      output: number
      reasoning: number
      cache: { read: number; write: number }
    }
  ) => ({
    id,
    session_id: 'session-x',
    time_created: 1,
    time_updated: 1,
    data: JSON.stringify({
      role: 'assistant',
      providerID: 'github-copilot',
      modelID,
      tokens
    })
  })

  it('returns unavailable when there are no assistant messages with tokens', () => {
    expect(aggregateOpenCodeTokenUsage([userRow('m1')])).toEqual({
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
    })
  })

  it('sums per-message tokens grouped by modelID and ignores user rows', () => {
    const rows = [
      userRow('m1'),
      assistantRow('m2', 'claude-sonnet-4.6', {
        input: 1000,
        output: 200,
        reasoning: 50,
        cache: { read: 500, write: 100 }
      }),
      userRow('m3'),
      assistantRow('m4', 'claude-sonnet-4.6', {
        input: 2000,
        output: 300,
        reasoning: 0,
        cache: { read: 700, write: 0 }
      }),
      assistantRow('m5', 'gpt-5.4', {
        input: 800,
        output: 100,
        reasoning: 30,
        cache: { read: 0, write: 0 }
      })
    ]

    const usage = aggregateOpenCodeTokenUsage(rows)

    expect(usage.source).toBe('opencode-messages')
    const byId = Object.fromEntries(usage.byModel.map(m => [m.modelId, m]))
    expect(byId['claude-sonnet-4.6']).toEqual({
      modelId: 'claude-sonnet-4.6',
      inputTokens: 3000,
      cachedInputTokens: 1200,
      cacheWriteTokens: 100,
      cacheWrite1hTokens: 0,
      outputTokens: 500,
      reasoningTokens: 50
    })
    expect(byId['gpt-5.4']).toEqual({
      modelId: 'gpt-5.4',
      inputTokens: 800,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 100,
      reasoningTokens: 30
    })
    expect(usage.totals).toEqual({
      inputTokens: 3800,
      cachedInputTokens: 1200,
      cacheWriteTokens: 100,
      cacheWrite1hTokens: 0,
      outputTokens: 600,
      reasoningTokens: 80
    })
  })

  it('treats assistant messages with all-zero tokens (e.g. errored requests) as unavailable signal but still counts them as 0', () => {
    const rows = [
      assistantRow('m1', 'gpt-5.4', {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 }
      })
    ]
    const usage = aggregateOpenCodeTokenUsage(rows)
    // Source still 'opencode-messages' because tokens object exists; just zeros.
    expect(usage.source).toBe('opencode-messages')
    expect(usage.totals.inputTokens).toBe(0)
  })
})

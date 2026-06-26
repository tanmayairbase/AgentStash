import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AppConfig,
  RendererApi,
  SessionDetail,
  SessionSummary,
  SyncResult
} from '../src/shared/types'
import { App } from '../src/renderer/src/App'

const baseSession: SessionSummary = {
  id: 'session-1',
  source: 'cli',
  repoPath: '/repos/a',
  title: 'Session title',
  model: 'gpt-5.3-codex',
  createdAt: '2026-03-10T10:00:00.000Z',
  updatedAt: '2026-03-10T10:30:00.000Z',
  messageCount: 1,
  filePath: '/repos/a/.copilot/events.jsonl',
  openVscodeTarget: '/repos/a/.copilot/events.jsonl',
  openCliCwd: '/repos/a'
}

const config: AppConfig = {
  repoRoots: ['/repos/a'],
  discoveryMode: 'both',
  explicitPatterns: [],
  appearance: 'light',
  syncMode: 'manual',
  backgroundSyncIntervalMinutes: 10
}

const backgroundConfig: AppConfig = {
  ...config,
  syncMode: 'manual-plus-background',
  backgroundSyncIntervalMinutes: 1
}

const syncResult: SyncResult = {
  filesScanned: 1,
  sessionsImported: 1,
  skippedFiles: 0,
  durationSeconds: 1,
  errors: []
}

const buildDetail = (messageCount: number): SessionDetail => ({
  ...baseSession,
  messageCount,
  messages: Array.from({ length: messageCount }).map((_, index) => ({
    id: `m-${index + 1}`,
    sessionId: baseSession.id,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index + 1}`,
    format: 'text',
    timestamp: `2026-03-10T10:${String(index).padStart(2, '0')}:00.000Z`
  }))
})

const buildUsage = (
  byModel: NonNullable<SessionSummary['tokenUsage']>['byModel']
): NonNullable<SessionSummary['tokenUsage']> => ({
  source: 'cli-shutdown',
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

describe('App sync detail refresh', () => {
  afterEach(() => {
    cleanup()
  })

  it('refreshes selected session detail after sync when the session remains selected', async () => {
    let currentMessageCount = 1

    const api: RendererApi = {
      getConfig: vi.fn(async () => config),
      saveConfig: vi.fn(async () => config),
      openConfigFile: vi.fn(async () => undefined),
      getAutoDiscoveredPatterns: vi.fn(async () => []),
      syncSessions: vi.fn(async () => {
        currentMessageCount = 2
        return syncResult
      }),
      listSessions: vi.fn(async () => [
        {
          ...baseSession,
          messageCount: currentMessageCount
        }
      ]),
      getSessionDetail: vi.fn(async () => buildDetail(currentMessageCount)),
      openSessionInTool: vi.fn(async () => ({ ok: true, message: 'ok' })),
      setSessionArchived: vi.fn(async () => null),
      setMessageStarred: vi.fn(async () => null),
      listStarredMessages: vi.fn(async () => [])
    }

    ;(window as Window & { copilotSessions?: RendererApi }).copilotSessions =
      api

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Messages: 1')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByText('Messages: 2')).toBeTruthy()
    })

    expect(
      screen.getByText(
        'Last sync: imported 1 sessions, scanned 1 files, skipped 0, in 1s'
      )
    ).toBeTruthy()

    expect(api.syncSessions).toHaveBeenCalledTimes(1)
    expect(api.getSessionDetail).toHaveBeenCalledTimes(2)
  })

  it('schedules periodic background sync and prevents overlap storms', async () => {
    let currentMessageCount = 1
    let resolveFirstSync: (result: SyncResult) => void = () => undefined
    const firstSyncPromise = new Promise<SyncResult>(resolve => {
      resolveFirstSync = resolve
    })
    let intervalCallback: () => void = () => undefined
    const setIntervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockImplementation((callback: TimerHandler) => {
        intervalCallback = callback as () => void
        return 1
      })
    const clearIntervalSpy = vi
      .spyOn(window, 'clearInterval')
      .mockImplementation(() => undefined)

    const api: RendererApi = {
      getConfig: vi.fn(async () => backgroundConfig),
      saveConfig: vi.fn(async () => backgroundConfig),
      openConfigFile: vi.fn(async () => undefined),
      getAutoDiscoveredPatterns: vi.fn(async () => []),
      syncSessions: vi.fn(async () => {
        currentMessageCount += 1
        if (currentMessageCount === 2) {
          return firstSyncPromise
        }
        return syncResult
      }),
      listSessions: vi.fn(async () => [
        {
          ...baseSession,
          messageCount: currentMessageCount
        }
      ]),
      getSessionDetail: vi.fn(async () => buildDetail(currentMessageCount)),
      openSessionInTool: vi.fn(async () => ({ ok: true, message: 'ok' })),
      setSessionArchived: vi.fn(async () => null),
      setMessageStarred: vi.fn(async () => null),
      listStarredMessages: vi.fn(async () => [])
    }

    ;(window as Window & { copilotSessions?: RendererApi }).copilotSessions =
      api
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Messages: 1')).toBeTruthy()
      expect(screen.getByText('Background sync enabled')).toBeTruthy()
    })

    intervalCallback()
    await waitFor(() => {
      expect(api.syncSessions).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Background sync running...')).toBeTruthy()
    })

    intervalCallback()
    expect(api.syncSessions).toHaveBeenCalledTimes(1)

    resolveFirstSync(syncResult)
    await waitFor(() => {
      expect(api.syncSessions).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.getByText('Messages: 2')).toBeTruthy()
    })
    expect(screen.queryByText(/Sync complete:/)).toBeNull()

    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  it('applies light theme and skips sync when only appearance changes', async () => {
    const darkConfig: AppConfig = {
      ...config,
      appearance: 'dark'
    }

    const api: RendererApi = {
      getConfig: vi.fn(async () => config),
      saveConfig: vi.fn(async () => darkConfig),
      openConfigFile: vi.fn(async () => undefined),
      getAutoDiscoveredPatterns: vi.fn(async () => []),
      syncSessions: vi.fn(async () => syncResult),
      listSessions: vi.fn(async () => [baseSession]),
      getSessionDetail: vi.fn(async () => buildDetail(1)),
      openSessionInTool: vi.fn(async () => ({ ok: true, message: 'ok' })),
      setSessionArchived: vi.fn(async () => null),
      setMessageStarred: vi.fn(async () => null),
      listStarredMessages: vi.fn(async () => [])
    }

    ;(window as Window & { copilotSessions?: RendererApi }).copilotSessions =
      api

    render(<App />)

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Appearance' }), {
      target: { value: 'dark' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(api.saveConfig).toHaveBeenCalledWith(darkConfig)
      expect(screen.getByText('Settings saved.')).toBeTruthy()
      expect(document.documentElement.dataset.theme).toBe('dark')
    })

    expect(api.syncSessions).not.toHaveBeenCalled()
  })

  it('hides sub-agent sessions by default and can show them from filters', async () => {
    const visibleSession: SessionSummary = {
      ...baseSession,
      id: 'session-visible',
      title: 'Visible session'
    }
    const hiddenSubagentSession: SessionSummary = {
      ...baseSession,
      id: 'session-subagent',
      title: 'Hidden sub-agent session',
      isSubagentSession: true
    }

    const api: RendererApi = {
      getConfig: vi.fn(async () => config),
      saveConfig: vi.fn(async () => config),
      openConfigFile: vi.fn(async () => undefined),
      getAutoDiscoveredPatterns: vi.fn(async () => []),
      syncSessions: vi.fn(async () => syncResult),
      listSessions: vi.fn(async () => [visibleSession, hiddenSubagentSession]),
      getSessionDetail: vi.fn(async sessionId => {
        const detail = buildDetail(1)
        return {
          ...detail,
          ...(sessionId === hiddenSubagentSession.id
            ? hiddenSubagentSession
            : visibleSession),
          messages: detail.messages
        }
      }),
      openSessionInTool: vi.fn(async () => ({ ok: true, message: 'ok' })),
      setSessionArchived: vi.fn(async () => null),
      setMessageStarred: vi.fn(async () => null),
      listStarredMessages: vi.fn(async () => [])
    }

    ;(window as Window & { copilotSessions?: RendererApi }).copilotSessions =
      api

    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText('Visible session').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('Hidden sub-agent session')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.change(screen.getByLabelText('Sub-agents filter'), {
      target: { value: 'show' }
    })

    await waitFor(() => {
      expect(
        screen.getAllByText('Hidden sub-agent session').length
      ).toBeGreaterThan(0)
    })
  })

  it('filters sessions by estimated cost tiers and unavailable bucket', async () => {
    const budgetSession: SessionSummary = {
      ...baseSession,
      id: 'session-budget',
      title: 'Budget session',
      tokenUsage: buildUsage([
        {
          modelId: 'gpt-5.4-mini',
          inputTokens: 100_000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          cacheWrite1hTokens: 0,
          outputTokens: 100_000,
          reasoningTokens: 0
        }
      ])
    }
    const mediumSession: SessionSummary = {
      ...baseSession,
      id: 'session-medium',
      title: 'Medium session',
      tokenUsage: buildUsage([
        {
          modelId: 'gpt-5.4',
          inputTokens: 200_000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          cacheWrite1hTokens: 0,
          outputTokens: 200_000,
          reasoningTokens: 0
        }
      ])
    }
    const unavailableSession: SessionSummary = {
      ...baseSession,
      id: 'session-unavailable',
      title: 'Unavailable session',
      tokenUsage: buildUsage([
        {
          modelId: 'mystery-llm-9000',
          inputTokens: 10_000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          cacheWrite1hTokens: 0,
          outputTokens: 10_000,
          reasoningTokens: 0
        }
      ])
    }

    const sessions = [budgetSession, mediumSession, unavailableSession]
    const api: RendererApi = {
      getConfig: vi.fn(async () => config),
      saveConfig: vi.fn(async () => config),
      openConfigFile: vi.fn(async () => undefined),
      getAutoDiscoveredPatterns: vi.fn(async () => []),
      syncSessions: vi.fn(async () => syncResult),
      listSessions: vi.fn(async () => sessions),
      getSessionDetail: vi.fn(async sessionId => {
        const detail = buildDetail(1)
        return {
          ...detail,
          ...(sessions.find(session => session.id === sessionId) ??
            budgetSession),
          messages: detail.messages
        }
      }),
      openSessionInTool: vi.fn(async () => ({ ok: true, message: 'ok' })),
      setSessionArchived: vi.fn(async () => null),
      setMessageStarred: vi.fn(async () => null),
      listStarredMessages: vi.fn(async () => [])
    }

    ;(window as Window & { copilotSessions?: RendererApi }).copilotSessions =
      api

    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText('Budget session').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Medium session').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Unavailable session').length).toBeGreaterThan(
        0
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(screen.getByLabelText('Estimated cost filter'))
    fireEvent.click(screen.getByLabelText('Estimated cost: $$ ($2-$5)'))
    fireEvent.click(screen.getByLabelText('Estimated cost: Unavailable'))

    await waitFor(() => {
      expect(screen.queryByText('Budget session')).toBeNull()
      expect(screen.getAllByText('Medium session').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Unavailable session').length).toBeGreaterThan(
        0
      )
    })
  })

  it('shows stats modal for current filtered sessions', async () => {
    const budgetSession: SessionSummary = {
      ...baseSession,
      id: 'session-budget',
      title: 'Budget session',
      tokenUsage: buildUsage([
        {
          modelId: 'gpt-5.4-mini',
          inputTokens: 100_000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          cacheWrite1hTokens: 0,
          outputTokens: 100_000,
          reasoningTokens: 0
        }
      ])
    }
    const mediumSession: SessionSummary = {
      ...baseSession,
      id: 'session-medium',
      title: 'Medium session',
      tokenUsage: buildUsage([
        {
          modelId: 'gpt-5.4',
          inputTokens: 200_000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          cacheWrite1hTokens: 0,
          outputTokens: 200_000,
          reasoningTokens: 0
        }
      ])
    }
    const unavailableSession: SessionSummary = {
      ...baseSession,
      id: 'session-unavailable',
      title: 'Unavailable session',
      tokenUsage: buildUsage([
        {
          modelId: 'mystery-llm-9000',
          inputTokens: 10_000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          cacheWrite1hTokens: 0,
          outputTokens: 10_000,
          reasoningTokens: 0
        }
      ])
    }

    const sessions = [budgetSession, mediumSession, unavailableSession]
    const api: RendererApi = {
      getConfig: vi.fn(async () => config),
      saveConfig: vi.fn(async () => config),
      openConfigFile: vi.fn(async () => undefined),
      getAutoDiscoveredPatterns: vi.fn(async () => []),
      syncSessions: vi.fn(async () => syncResult),
      listSessions: vi.fn(async () => sessions),
      getSessionDetail: vi.fn(async sessionId => {
        const detail = buildDetail(1)
        return {
          ...detail,
          ...(sessions.find(session => session.id === sessionId) ?? budgetSession),
          messages: detail.messages
        }
      }),
      openSessionInTool: vi.fn(async () => ({ ok: true, message: 'ok' })),
      setSessionArchived: vi.fn(async () => null),
      setMessageStarred: vi.fn(async () => null),
      listStarredMessages: vi.fn(async () => [])
    }

    ;(window as Window & { copilotSessions?: RendererApi }).copilotSessions = api

    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText('Budget session').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(screen.getByLabelText('Estimated cost filter'))
    fireEvent.click(screen.getByLabelText('Estimated cost: $$ ($2-$5)'))

    await waitFor(() => {
      expect(screen.getAllByText('Medium session').length).toBeGreaterThan(0)
      expect(screen.queryByText('Budget session')).toBeNull()
      expect(screen.queryByText('Unavailable session')).toBeNull()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open session stats' }))

    const dialog = await screen.findByRole('dialog', { name: 'Session stats' })
    expect(within(dialog).getByTestId('stats-total-cost').textContent).toBe(
      '$3.50'
    )
    expect(within(dialog).getByTestId('stats-session-count').textContent).toBe(
      '1'
    )
    expect(
      within(dialog).getByTestId('stats-unpriced-session-count').textContent
    ).toBe('0')
    expect(within(dialog).getByTestId('stats-average-cost').textContent).toBe(
      '$3.50'
    )
    expect(within(dialog).getByTestId('stats-model-gpt-5.4')).toBeTruthy()
    expect(within(dialog).queryByTestId('stats-model-gpt-5.4-mini')).toBeNull()
  })

  it('collapses model breakdown to first five rows and expands on demand', async () => {
    const modelIds = [
      'gpt-5.5',
      'gpt-5.4',
      'claude-opus-4.7',
      'claude-sonnet-4.6',
      'gemini-3.1-pro',
      'gpt-5.4-mini'
    ]
    const sessions = modelIds.map((modelId, index) => ({
      ...baseSession,
      id: `session-${index + 1}`,
      title: `Session ${index + 1}`,
      model: modelId,
      tokenUsage: buildUsage([
        {
          modelId,
          inputTokens: 100_000 + index * 10_000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          cacheWrite1hTokens: 0,
          outputTokens: 100_000 + index * 10_000,
          reasoningTokens: 0
        }
      ])
    }))
    const api: RendererApi = {
      getConfig: vi.fn(async () => config),
      saveConfig: vi.fn(async () => config),
      openConfigFile: vi.fn(async () => undefined),
      getAutoDiscoveredPatterns: vi.fn(async () => []),
      syncSessions: vi.fn(async () => syncResult),
      listSessions: vi.fn(async () => sessions),
      getSessionDetail: vi.fn(async sessionId => {
        const detail = buildDetail(1)
        return {
          ...detail,
          ...(sessions.find(session => session.id === sessionId) ?? sessions[0]!),
          messages: detail.messages
        }
      }),
      openSessionInTool: vi.fn(async () => ({ ok: true, message: 'ok' })),
      setSessionArchived: vi.fn(async () => null),
      setMessageStarred: vi.fn(async () => null),
      listStarredMessages: vi.fn(async () => [])
    }

    ;(window as Window & { copilotSessions?: RendererApi }).copilotSessions = api

    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText('Session 1').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open session stats' }))

    const dialog = await screen.findByRole('dialog', { name: 'Session stats' })
    expect(
      within(dialog).getByRole('button', { name: 'Show more (1 more)' })
    ).toBeTruthy()
    expect(within(dialog).queryByTestId('stats-model-gpt-5.4-mini')).toBeNull()

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Show more (1 more)' })
    )

    expect(within(dialog).getByTestId('stats-model-gpt-5.4-mini')).toBeTruthy()
    expect(
      within(dialog).getByRole('button', { name: 'Show less' })
    ).toBeTruthy()
  })
})

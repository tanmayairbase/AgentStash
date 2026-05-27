import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionSummary, StarredMessageSummary } from '../src/shared/types'
import { SessionListSidebar } from '../src/renderer/src/components/SessionListSidebar'

const sessions: SessionSummary[] = [
  {
    id: '1',
    source: 'cli',
    repoPath: '/repos/a',
    title: 'Implement auth parser',
    modes: ['plan', 'autopilot'],
    latestMode: 'autopilot',
    model: 'gpt-5.3-codex',
    createdAt: '2026-03-10T10:00:00.000Z',
    updatedAt: '2026-03-10T10:30:00.000Z',
    messageCount: 4,
    filePath: '/repos/a/.copilot/session1.json',
    openVscodeTarget: '/repos/a/.copilot/session1.json',
    openCliCwd: '/repos/a'
  }
]

const archivedSession: SessionSummary = {
  ...sessions[0],
  id: '2',
  title: 'Archived parser notes',
  userArchived: true
}

const starredMessages: StarredMessageSummary[] = [
  {
    sessionId: '1',
    messageId: 'm1',
    sessionTitle: 'Implement auth parser',
    sessionSource: 'cli',
    repoPath: '/repos/a',
    role: 'assistant',
    content: 'Use session-store summary for title',
    timestamp: '2026-03-10T10:25:00.000Z',
    stale: false,
    starredAt: '2026-03-10T10:26:00.000Z'
  }
]

const createSession = (id: string, title: string): SessionSummary => ({
  ...sessions[0],
  id,
  title,
  filePath: `/repos/a/.copilot/session${id}.json`,
  openVscodeTarget: `/repos/a/.copilot/session${id}.json`
})

const renderSidebar = (
  overrides: Partial<ComponentProps<typeof SessionListSidebar>> = {}
) => {
  const onSelect = vi.fn()
  const onSetArchived = vi.fn()
  const onSelectStarredMessage = vi.fn()
  const onQueryChange = vi.fn()
  const onClearFilters = vi.fn()
  const onOpenStats = vi.fn()
  const onToggleRepo = vi.fn()
  const onToggleModel = vi.fn()
  const onToggleEstimatedCost = vi.fn()
  const onToggleOrigin = vi.fn()
  const onDateFilterChange = vi.fn()
  const onArchivedFilterChange = vi.fn()
  const onStarredFilterChange = vi.fn()
  const onSubagentFilterChange = vi.fn()

  render(
    <SessionListSidebar
      sessions={sessions}
      starredMessages={[]}
      archivedSearchMatches={[]}
      selectedId={null}
      onSelect={onSelect}
      onSelectStarredMessage={onSelectStarredMessage}
      onSetArchived={onSetArchived}
      query=""
      onQueryChange={onQueryChange}
      onClearFilters={onClearFilters}
      onOpenStats={onOpenStats}
      repoOptions={['/repos/a', '/repos/b']}
      selectedRepos={[]}
      onToggleRepo={onToggleRepo}
      modelOptions={['gpt-5.3-codex', 'claude-sonnet-4.5']}
      selectedModels={[]}
      onToggleModel={onToggleModel}
      estimatedCostOptions={['$', '$$', '$$$', 'unavailable']}
      selectedEstimatedCosts={[]}
      onToggleEstimatedCost={onToggleEstimatedCost}
      originOptions={['vscode', 'cli', 'opencode']}
      selectedOrigins={[]}
      onToggleOrigin={onToggleOrigin}
      dateFilter=""
      onDateFilterChange={onDateFilterChange}
      archivedFilter="hide"
      onArchivedFilterChange={onArchivedFilterChange}
      starredFilter="all"
      onStarredFilterChange={onStarredFilterChange}
      subagentFilter="hide"
      onSubagentFilterChange={onSubagentFilterChange}
      hasActiveFilters={false}
      {...overrides}
    />
  )

  return {
    onSelect,
    onSetArchived,
    onSelectStarredMessage,
    onQueryChange,
    onClearFilters,
    onOpenStats,
    onToggleRepo,
    onToggleModel,
    onToggleEstimatedCost,
    onToggleOrigin,
    onDateFilterChange,
    onArchivedFilterChange,
    onStarredFilterChange,
    onSubagentFilterChange
  }
}

describe('SessionListSidebar', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders sessions and supports search, selection, and filters', () => {
    const {
      onSelect,
      onQueryChange,
      onToggleRepo,
      onToggleModel,
      onToggleEstimatedCost,
      onToggleOrigin,
      onDateFilterChange,
      onOpenStats
    } = renderSidebar()

    fireEvent.click(screen.getByText('Implement auth parser'))
    expect(onSelect).toHaveBeenCalledWith('1')

    fireEvent.change(screen.getByLabelText('Search sessions'), {
      target: { value: 'auth' }
    })
    expect(onQueryChange).toHaveBeenCalledWith('auth')

    expect(screen.queryByLabelText('Repository filter')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))

    fireEvent.click(screen.getByLabelText('Repository filter'))
    fireEvent.click(screen.getByLabelText('Repository: /repos/a'))
    expect(onToggleRepo).toHaveBeenCalledWith('/repos/a')

    fireEvent.click(screen.getByLabelText('Model filter'))
    fireEvent.click(screen.getByLabelText('Model: gpt-5.3-codex'))
    expect(onToggleModel).toHaveBeenCalledWith('gpt-5.3-codex')

    fireEvent.click(screen.getByLabelText('Estimated cost filter'))
    fireEvent.click(screen.getByLabelText('Estimated cost: $$ ($2-$5)'))
    expect(onToggleEstimatedCost).toHaveBeenCalledWith('$$')

    fireEvent.click(screen.getByLabelText('Origin filter'))
    fireEvent.click(screen.getByLabelText('Origin: vscode'))
    expect(onToggleOrigin).toHaveBeenCalledWith('vscode')

    fireEvent.change(screen.getByLabelText('Date filter'), {
      target: { value: 'last7' }
    })
    expect(onDateFilterChange).toHaveBeenCalledWith('last7')

    fireEvent.click(screen.getByRole('button', { name: 'Open session stats' }))
    expect(onOpenStats).toHaveBeenCalledTimes(1)
  })

  it('shows clear-search button only when query exists and clears search', () => {
    const { onQueryChange } = renderSidebar({ query: 'auth' })
    fireEvent.click(screen.getByLabelText('Clear search'))
    expect(onQueryChange).toHaveBeenCalledWith('')
  })

  it('closes an open dropdown when clicking outside filters', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(screen.getByLabelText('Repository filter'))
    expect(screen.getByLabelText('Repository: /repos/a')).toBeTruthy()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByLabelText('Repository: /repos/a')).toBeNull()
  })

  it('shows active filter indicator when filters are applied', () => {
    const { onClearFilters } = renderSidebar({
      selectedRepos: ['/repos/a'],
      hasActiveFilters: true
    })
    expect(document.querySelector('.filters-active-dot')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onClearFilters).toHaveBeenCalledTimes(1)
  })

  it('shows archived badge for sessions missing from latest sync', () => {
    renderSidebar({ sessions: [{ ...sessions[0], missingFromLastSync: true }] })
    expect(screen.getByText('Archived')).toBeTruthy()
  })

  it('does not show mode badges in session rows', () => {
    renderSidebar()
    expect(screen.queryByText('Plan')).toBeNull()
    expect(screen.queryByText('Autopilot')).toBeNull()
  })

  it('shows collapsed archived search section and expands on click', () => {
    renderSidebar({
      archivedSearchMatches: [archivedSession],
      query: 'parser'
    })

    expect(screen.getByText('Archived matches (1)')).toBeTruthy()
    expect(screen.queryByText('Archived parser notes')).toBeNull()
    fireEvent.click(screen.getByText('Archived matches (1)'))
    expect(screen.getByText('Archived parser notes')).toBeTruthy()
  })

  it('opens context menu and archives session', () => {
    const { onSetArchived } = renderSidebar()
    fireEvent.contextMenu(screen.getByText('Implement auth parser'))
    fireEvent.click(screen.getByText('Archive session'))
    expect(onSetArchived).toHaveBeenCalledWith('1', true)
  })

  it('shows unarchive action for archived sessions', () => {
    const { onSetArchived } = renderSidebar({
      sessions: [archivedSession],
      archivedFilter: 'show',
      hasActiveFilters: true
    })
    fireEvent.contextMenu(screen.getByText('Archived parser notes'))
    fireEvent.click(screen.getByText('Unarchive session'))
    expect(onSetArchived).toHaveBeenCalledWith('2', false)
  })

  it('shows starred section and opens parent session/message', () => {
    const { onSelectStarredMessage } = renderSidebar({ starredMessages })
    expect(screen.getByText('Starred (1)')).toBeTruthy()
    fireEvent.click(screen.getByText('Starred (1)'))
    fireEvent.click(screen.getByText('Use session-store summary for title'))
    expect(onSelectStarredMessage).toHaveBeenCalledWith('1', 'm1')
  })

  it('supports starred filter control', () => {
    const { onStarredFilterChange } = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.change(screen.getByLabelText('Starred filter'), {
      target: { value: 'only' }
    })
    expect(onStarredFilterChange).toHaveBeenCalledWith('only')
  })

  it('supports sub-agent filter control', () => {
    const { onSubagentFilterChange } = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.change(screen.getByLabelText('Sub-agents filter'), {
      target: { value: 'show' }
    })
    expect(onSubagentFilterChange).toHaveBeenCalledWith('show')
  })

  it('virtualizes large main session lists while keeping interactions', () => {
    const largeSessions = Array.from({ length: 180 }, (_, index) =>
      createSession(String(index + 1), `Session ${index + 1}`)
    )
    const { onSelect, onSetArchived } = renderSidebar({
      sessions: largeSessions
    })

    expect(screen.getByText('Session 1')).toBeTruthy()
    expect(screen.queryByText('Session 180')).toBeNull()

    fireEvent.click(screen.getByText('Session 1'))
    expect(onSelect).toHaveBeenCalledWith('1')

    fireEvent.contextMenu(screen.getByText('Session 1'))
    fireEvent.click(screen.getByText('Archive session'))
    expect(onSetArchived).toHaveBeenCalledWith('1', true)
  })
})

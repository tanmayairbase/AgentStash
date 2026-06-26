import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  SessionSource,
  SessionSummary,
  StarredMessageSummary
} from '@shared/types'
import type { DateFilterPreset } from '@shared/format'
import {
  formatAgentName,
  formatSessionOrigin,
  formatTimestampIST,
  toSearchPreview,
  toTildePath
} from '@shared/format'
import type { SessionCostCategory } from '../../../shared/pricing'
import { SessionCostChip } from './SessionCostChip'

type DateFilterValue = DateFilterPreset | ''
type OriginFilterValue = SessionSource
type FilterMenu = 'repository' | 'model' | 'estimatedCost' | 'origin' | null
export type ArchivedFilterValue = 'hide' | 'show' | 'only'
export type StarredFilterValue = 'all' | 'only'
export type SubagentFilterValue = 'hide' | 'show'

interface Props {
  sessions: SessionSummary[]
  starredMessages: StarredMessageSummary[]
  archivedSearchMatches: SessionSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  onSelectStarredMessage: (sessionId: string, messageId: string) => void
  onSetArchived: (sessionId: string, archived: boolean) => void
  query: string
  onQueryChange: (query: string) => void
  onClearFilters: () => void
  onOpenStats: () => void
  repoOptions: string[]
  selectedRepos: string[]
  onToggleRepo: (repoPath: string) => void
  modelOptions: string[]
  selectedModels: string[]
  onToggleModel: (model: string) => void
  estimatedCostOptions: SessionCostCategory[]
  selectedEstimatedCosts: SessionCostCategory[]
  onToggleEstimatedCost: (value: SessionCostCategory) => void
  originOptions: OriginFilterValue[]
  selectedOrigins: OriginFilterValue[]
  onToggleOrigin: (origin: OriginFilterValue) => void
  dateFilter: DateFilterValue
  onDateFilterChange: (value: DateFilterValue) => void
  archivedFilter: ArchivedFilterValue
  onArchivedFilterChange: (value: ArchivedFilterValue) => void
  starredFilter: StarredFilterValue
  onStarredFilterChange: (value: StarredFilterValue) => void
  subagentFilter: SubagentFilterValue
  onSubagentFilterChange: (value: SubagentFilterValue) => void
  hasActiveFilters: boolean
}

interface MultiSelectProps {
  menuId: Exclude<FilterMenu, null>
  label: string
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
  formatOption?: (value: string) => string
  formatAriaOption?: (value: string) => string
  emptyLabel: string
  isOpen: boolean
  onOpen: (menu: Exclude<FilterMenu, null>) => void
}

const SESSION_ROW_GAP = 8
const SESSION_ROW_HEIGHT_ESTIMATE = 88
const SESSION_OVERSCAN_PX = 320
const SESSION_VIRTUALIZE_THRESHOLD = 80

interface VirtualizedSessionRowsProps {
  sessions: SessionSummary[]
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  renderSessionRow: (session: SessionSummary) => React.ReactNode
  noStarredSection: boolean
}

const getEstimatedRowSize = (index: number, total: number): number =>
  SESSION_ROW_HEIGHT_ESTIMATE + (index === total - 1 ? 0 : SESSION_ROW_GAP)

const formatEstimatedCostOption = (value: SessionCostCategory): string => {
  switch (value) {
    case '$':
      return '$ (<$2)'
    case '$$':
      return '$$ ($2-$5)'
    case '$$$':
      return '$$$ (>= $5)'
    case 'unavailable':
      return 'Unavailable'
  }
}

const getOffsetTopWithin = (
  element: HTMLElement,
  ancestor: HTMLElement
): number => {
  let offset = 0
  let node: HTMLElement | null = element
  while (node && node !== ancestor) {
    offset += node.offsetTop
    node = node.parentElement
  }
  return offset
}

const findStartIndex = (
  starts: number[],
  sizes: number[],
  offset: number
): number => {
  let low = 0
  let high = starts.length - 1
  let answer = starts.length - 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (starts[mid] + sizes[mid] > offset) {
      answer = mid
      high = mid - 1
    } else {
      low = mid + 1
    }
  }
  return answer
}

const findEndIndex = (starts: number[], offset: number): number => {
  let low = 0
  let high = starts.length - 1
  let answer = 0
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (starts[mid] < offset) {
      answer = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return answer
}

const VirtualizedSessionRows = ({
  sessions,
  scrollContainerRef,
  renderSessionRow,
  noStarredSection
}: VirtualizedSessionRowsProps) => {
  const rowsRef = useRef<HTMLDivElement>(null)
  const [rowSizes, setRowSizes] = useState<number[]>(() =>
    sessions.map((_, index) => getEstimatedRowSize(index, sessions.length))
  )
  const [viewport, setViewport] = useState({
    scrollTop: 0,
    height: 0,
    rowsOffsetTop: 0
  })

  useEffect(() => {
    setRowSizes(previous => {
      const next = sessions.map(
        (_, index) =>
          previous[index] ?? getEstimatedRowSize(index, sessions.length)
      )
      if (
        next.length === previous.length &&
        next.every((value, index) => value === previous[index])
      ) {
        return previous
      }
      return next
    })
  }, [sessions])

  const updateViewport = useCallback((): void => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) {
      return
    }
    const rowsElement = rowsRef.current
    const next = {
      scrollTop: scrollContainer.scrollTop,
      height: scrollContainer.clientHeight,
      rowsOffsetTop: rowsElement
        ? getOffsetTopWithin(rowsElement, scrollContainer)
        : 0
    }
    setViewport(previous =>
      previous.scrollTop === next.scrollTop &&
      previous.height === next.height &&
      previous.rowsOffsetTop === next.rowsOffsetTop
        ? previous
        : next
    )
  }, [scrollContainerRef])

  useEffect(() => {
    updateViewport()
  }, [sessions, rowSizes, updateViewport])

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) {
      return
    }
    const onScroll = (): void => {
      updateViewport()
    }
    scrollContainer.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', updateViewport)

    return () => {
      scrollContainer.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', updateViewport)
    }
  }, [scrollContainerRef, updateViewport])

  const measurements = useMemo(() => {
    const starts: number[] = new Array(sessions.length)
    const sizes: number[] = new Array(sessions.length)
    let total = 0
    for (let index = 0; index < sessions.length; index += 1) {
      starts[index] = total
      const size =
        rowSizes[index] ?? getEstimatedRowSize(index, sessions.length)
      sizes[index] = size
      total += size
    }
    return { starts, sizes, total }
  }, [sessions, rowSizes])

  if (sessions.length === 0) {
    return null
  }

  const shouldVirtualize = sessions.length >= SESSION_VIRTUALIZE_THRESHOLD

  if (!shouldVirtualize) {
    return (
      <div
        ref={rowsRef}
        className={`session-list-main session-list-main-static ${noStarredSection ? 'session-list-main-no-starred' : ''}`}
      >
        {sessions.map(session => renderSessionRow(session))}
      </div>
    )
  }

  const visibleStartOffset = Math.max(
    0,
    viewport.scrollTop - viewport.rowsOffsetTop - SESSION_OVERSCAN_PX
  )
  const viewportHeight = viewport.height > 0 ? viewport.height : 600
  const visibleEndOffset =
    viewport.scrollTop -
    viewport.rowsOffsetTop +
    viewportHeight +
    SESSION_OVERSCAN_PX

  const startIndex = findStartIndex(
    measurements.starts,
    measurements.sizes,
    visibleStartOffset
  )
  const endIndex = Math.max(
    startIndex,
    findEndIndex(measurements.starts, visibleEndOffset)
  )

  return (
    <div
      ref={rowsRef}
      className={`session-list-main ${noStarredSection ? 'session-list-main-no-starred' : ''}`}
      style={{ height: `${measurements.total}px` }}
    >
      {sessions.slice(startIndex, endIndex + 1).map((session, offset) => {
        const index = startIndex + offset
        return (
          <div
            key={session.id}
            className="virtual-session-row"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              transform: `translateY(${measurements.starts[index]}px)`,
              paddingBottom: `${index === sessions.length - 1 ? 0 : SESSION_ROW_GAP}px`
            }}
            ref={node => {
              if (!node) {
                return
              }
              const measured = node.offsetHeight
              if (measured <= 0) {
                return
              }
              setRowSizes(previous => {
                if (previous[index] === measured) {
                  return previous
                }
                const next = [...previous]
                next[index] = measured
                return next
              })
            }}
          >
            {renderSessionRow(session)}
          </div>
        )
      })}
    </div>
  )
}

const MultiSelectFilter = ({
  menuId,
  label,
  options,
  selected,
  onToggle,
  formatOption,
  formatAriaOption,
  emptyLabel,
  isOpen,
  onOpen
}: MultiSelectProps) => {
  return (
    <div className="filter-group">
      <span className="filter-label">{label}</span>
      <button
        type="button"
        className="filter-trigger"
        onClick={() => onOpen(menuId)}
        aria-expanded={isOpen}
        aria-label={`${label} filter`}
      >
        {selected.length > 0 ? `${selected.length} selected` : 'All'}
      </button>
      {isOpen && (
        <div
          className="filter-dropdown-menu"
          role="listbox"
          aria-multiselectable="true"
        >
          {options.length === 0 && <p className="filter-empty">{emptyLabel}</p>}
          {options.map(option => {
            const optionLabel = formatOption ? formatOption(option) : option
            const optionAriaLabel = formatAriaOption
              ? formatAriaOption(option)
              : option
            return (
              <label key={option} className="filter-option">
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => onToggle(option)}
                  aria-label={`${label}: ${optionAriaLabel}`}
                />
                <span>{optionLabel}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

export const SessionListSidebar = ({
  sessions,
  starredMessages,
  archivedSearchMatches,
  selectedId,
  onSelect,
  onSelectStarredMessage,
  onSetArchived,
  query,
  onQueryChange,
  onClearFilters,
  onOpenStats,
  repoOptions,
  selectedRepos,
  onToggleRepo,
  modelOptions,
  selectedModels,
  onToggleModel,
  estimatedCostOptions,
  selectedEstimatedCosts,
  onToggleEstimatedCost,
  originOptions,
  selectedOrigins,
  onToggleOrigin,
  dateFilter,
  onDateFilterChange,
  archivedFilter,
  onArchivedFilterChange,
  starredFilter,
  onStarredFilterChange,
  subagentFilter,
  onSubagentFilterChange,
  hasActiveFilters
}: Props) => {
  const filterRootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const sessionListRef = useRef<HTMLDivElement>(null)
  const [openMenu, setOpenMenu] = useState<FilterMenu>(null)
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [starredExpanded, setStarredExpanded] = useState(false)
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    sessionId: string
    x: number
    y: number
    archived: boolean
  } | null>(null)

  useEffect(() => {
    const onMouseDown = (event: MouseEvent): void => {
      if (filterRootRef.current?.contains(event.target as Node)) {
        return
      }
      setOpenMenu(null)
      if (menuRef.current?.contains(event.target as Node)) {
        return
      }
      setContextMenu(null)
    }
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenMenu(null)
        setContextMenu(null)
      }
    }

    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onEscape)
    }
  }, [])

  useEffect(() => {
    setStarredExpanded(false)
    setArchivedExpanded(false)
  }, [query])

  const toggleMenu = (menu: Exclude<FilterMenu, null>): void => {
    setOpenMenu(current => (current === menu ? null : menu))
  }
  const toggleFilters = (): void => {
    setFiltersExpanded(current => {
      if (current) {
        setOpenMenu(null)
      }
      return !current
    })
  }
  const clearFilters = (): void => {
    onClearFilters()
    setOpenMenu(null)
  }
  const showArchivedSection =
    query.trim().length > 0 &&
    archivedFilter === 'hide' &&
    archivedSearchMatches.length > 0

  const renderSessionRow = (
    session: SessionSummary,
    options?: { forceArchivedStyle?: boolean }
  ) => {
    const isActive = session.id === selectedId
    const isArchived = Boolean(
      session.userArchived || options?.forceArchivedStyle
    )

    return (
      <button
        key={session.id}
        className={`session-item ${isActive ? 'active' : ''} ${isArchived ? 'archived' : ''}`}
        onClick={() => onSelect(session.id)}
        onContextMenu={event => {
          event.preventDefault()
          setContextMenu({
            sessionId: session.id,
            x: event.clientX,
            y: event.clientY,
            archived: Boolean(session.userArchived)
          })
        }}
        type="button"
      >
        <div className="session-title">
          {toSearchPreview(session.title, 72)}
        </div>
        <div className="session-meta">
          {(session.userArchived || session.missingFromLastSync) && (
            <span className="session-archived-badge">Archived</span>
          )}
          <span>{formatSessionOrigin(session.source)}</span>
          <span>{formatTimestampIST(session.updatedAt)}</span>
        </div>
        <div className="session-path">
          <span className="session-path-text">
            {toTildePath(session.repoPath)}
          </span>
          <SessionCostChip usage={session.tokenUsage} />
        </div>
      </button>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-search-wrap">
        <div className="sidebar-search-input-wrap">
          <input
            aria-label="Search sessions"
            className="sidebar-search"
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            placeholder="Search messages, title, repo, model, agent"
          />
          {query.trim().length > 0 && (
            <button
              type="button"
              className="sidebar-search-clear"
              onClick={() => onQueryChange('')}
              aria-label="Clear search"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M18.3 5.71L12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.29 19.7l-1.42-1.41L9.17 12 2.87 5.71 4.29 4.3l6.3 6.3 6.29-6.3z" />
              </svg>
            </button>
          )}
        </div>

        <div className="filters-toolbar">
          <button
            type="button"
            className="filters-toggle"
            aria-expanded={filtersExpanded}
            onClick={toggleFilters}
          >
            <span className="filters-toggle-icon-wrap">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M4 6h16l-6 7v5l-4 2v-7z" />
              </svg>
              {hasActiveFilters && (
                <span className="filters-active-dot" aria-hidden="true" />
              )}
            </span>
            <span>Filters</span>
          </button>
          <button
            type="button"
            className="filters-clear"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
            aria-label="Clear filters"
          >
            Clear
          </button>
          <button
            type="button"
            className="filters-stats"
            onClick={onOpenStats}
            aria-label="Open session stats"
          >
            Stats
          </button>
        </div>

        {filtersExpanded && (
          <div className="filters-row" ref={filterRootRef}>
            <MultiSelectFilter
              menuId="repository"
              label="Repository"
              options={repoOptions}
              selected={selectedRepos}
              onToggle={onToggleRepo}
              formatOption={toTildePath}
              emptyLabel="No repositories configured"
              isOpen={openMenu === 'repository'}
              onOpen={toggleMenu}
            />
            <MultiSelectFilter
              menuId="model"
              label="Model"
              options={modelOptions}
              selected={selectedModels}
              onToggle={onToggleModel}
              emptyLabel="No model values yet"
              isOpen={openMenu === 'model'}
              onOpen={toggleMenu}
            />
            <MultiSelectFilter
              menuId="estimatedCost"
              label="Estimated cost"
              options={estimatedCostOptions}
              selected={selectedEstimatedCosts}
              onToggle={value =>
                onToggleEstimatedCost(value as SessionCostCategory)
              }
              formatOption={value =>
                formatEstimatedCostOption(value as SessionCostCategory)
              }
              formatAriaOption={value =>
                formatEstimatedCostOption(value as SessionCostCategory)
              }
              emptyLabel="No cost buckets available"
              isOpen={openMenu === 'estimatedCost'}
              onOpen={toggleMenu}
            />
            <MultiSelectFilter
              menuId="origin"
              label="Origin"
              options={originOptions}
              selected={selectedOrigins}
              onToggle={value => onToggleOrigin(value as OriginFilterValue)}
              formatOption={origin =>
                formatSessionOrigin(origin as OriginFilterValue)
              }
              emptyLabel="No origins available"
              isOpen={openMenu === 'origin'}
              onOpen={toggleMenu}
            />
            <label className="filter-group">
              <span className="filter-label">Date</span>
              <select
                className="filter-select"
                value={dateFilter}
                onChange={event =>
                  onDateFilterChange(event.target.value as DateFilterValue)
                }
                aria-label="Date filter"
              >
                <option value="">All</option>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="last7">Last 7 days</option>
                <option value="last14">Last 14 days</option>
                <option value="last30">Last 30 days</option>
              </select>
            </label>
            <label className="filter-group">
              <span className="filter-label">Archived</span>
              <select
                className="filter-select"
                value={archivedFilter}
                onChange={event =>
                  onArchivedFilterChange(
                    event.target.value as ArchivedFilterValue
                  )
                }
                aria-label="Archived filter"
              >
                <option value="hide">Hide archived</option>
                <option value="show">Show archived</option>
                <option value="only">Only archived</option>
              </select>
            </label>
            <label className="filter-group">
              <span className="filter-label">Starred</span>
              <select
                className="filter-select"
                value={starredFilter}
                onChange={event =>
                  onStarredFilterChange(
                    event.target.value as StarredFilterValue
                  )
                }
                aria-label="Starred filter"
              >
                <option value="all">All sessions</option>
                <option value="only">Only starred</option>
              </select>
            </label>
            <label className="filter-group">
              <span className="filter-label">Sub-agent sessions</span>
              <select
                className="filter-select"
                value={subagentFilter}
                onChange={event =>
                  onSubagentFilterChange(
                    event.target.value as SubagentFilterValue
                  )
                }
                aria-label="Sub-agents filter"
              >
                <option value="hide">Hide</option>
                <option value="show">Show</option>
              </select>
            </label>
          </div>
        )}
      </div>

      <div
        ref={sessionListRef}
        className={`session-list ${starredMessages.length === 0 ? 'session-list-no-starred' : ''}`}
        role="listbox"
        aria-label="Session list"
      >
        {starredMessages.length > 0 && (
          <section
            className={`starred-section ${starredExpanded ? 'expanded' : ''}`}
            aria-label="Starred messages"
          >
            <button
              type="button"
              className="starred-toggle"
              aria-expanded={starredExpanded}
              onClick={() => setStarredExpanded(value => !value)}
            >
              <span>Starred ({starredMessages.length})</span>
              <span>{starredExpanded ? '▾' : '▸'}</span>
            </button>
            {starredExpanded && (
              <div className="starred-list">
                {starredMessages.map(star => (
                  <button
                    key={`${star.sessionId}:${star.messageId}`}
                    type="button"
                    className={`starred-item ${star.stale ? 'stale' : ''}`}
                    onClick={() =>
                      onSelectStarredMessage(star.sessionId, star.messageId)
                    }
                  >
                    <div className="starred-item-top">
                      <span className="starred-item-role">
                        {star.role === 'user'
                          ? 'You'
                          : formatAgentName(star.sessionSource)}
                      </span>
                      {star.stale && (
                        <span className="starred-item-stale">Stale</span>
                      )}
                    </div>
                    <div className="starred-item-content">
                      {toSearchPreview(star.content, 92)}
                    </div>
                    <div className="starred-item-meta">
                      <span>{toSearchPreview(star.sessionTitle, 48)}</span>
                      <span>{formatTimestampIST(star.timestamp)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        <VirtualizedSessionRows
          sessions={sessions}
          scrollContainerRef={sessionListRef}
          renderSessionRow={renderSessionRow}
          noStarredSection={starredMessages.length === 0}
        />
        {showArchivedSection && (
          <section
            className="archived-search-section"
            aria-label="Archived search matches"
          >
            <button
              type="button"
              className="archived-search-toggle"
              aria-expanded={archivedExpanded}
              onClick={() => setArchivedExpanded(value => !value)}
            >
              <span>Archived matches ({archivedSearchMatches.length})</span>
              <span>{archivedExpanded ? '▾' : '▸'}</span>
            </button>
            {archivedExpanded && (
              <div className="archived-search-list">
                {archivedSearchMatches.map(session =>
                  renderSessionRow(session, { forceArchivedStyle: true })
                )}
              </div>
            )}
          </section>
        )}
        {sessions.length === 0 && !showArchivedSection && (
          <p className="empty-list">
            No sessions found. Try syncing or changing search.
          </p>
        )}
      </div>
      {contextMenu && (
        <div
          ref={menuRef}
          className="session-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label="Session actions"
        >
          <button
            type="button"
            role="menuitem"
            className="session-context-item"
            onClick={() => {
              onSetArchived(contextMenu.sessionId, !contextMenu.archived)
              setContextMenu(null)
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M4 4h16v4H4z" />
              <path d="M5 9h14v11H5z" />
            </svg>
            <span>
              {contextMenu.archived ? 'Unarchive session' : 'Archive session'}
            </span>
          </button>
        </div>
      )}
    </aside>
  )
}

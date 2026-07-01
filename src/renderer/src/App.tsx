import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from 'react'
import type {
  AppConfig,
  AppUpdateStatus,
  AppearancePreference,
  AutoDiscoveredPatternInfo,
  RendererApi,
  SessionDetail,
  SessionSource,
  SessionSummary,
  StarredMessageSummary,
  SyncResult,
  UpdateDownloadProgress
} from '@shared/types'
import type { DateFilterPreset } from '@shared/format'
import {
  formatTimestampIST,
  matchesIstDatePreset,
  matchesRepositoryFilter,
  normalizeModelLabel
} from '@shared/format'
import { sessionCostCategory, type SessionCostCategory } from '@shared/pricing'
import { aggregateSessionCostStats } from '@shared/session-stats'
import { SessionDetailView } from './components/SessionDetailView'
import { SessionStatsModal } from './components/SessionStatsModal'
import {
  SessionListSidebar,
  type ArchivedFilterValue,
  type StarredFilterValue,
  type SubagentFilterValue
} from './components/SessionListSidebar'
import { SettingsModal } from './components/SettingsModal'

const SIDEBAR_WIDTH_KEY = 'copilot-sessions-sidebar-width'
type DateFilterValue = DateFilterPreset | ''
const SIDEBAR_MIN_WIDTH = 260
const SIDEBAR_COLLAPSE_MIN_WIDTH = 180
const SIDEBAR_MAX_WIDTH = 620
const DETAIL_MIN_WIDTH = 320
const RESIZER_WIDTH = 6
const SEARCH_DEBOUNCE_MS = 140
const UPDATE_CHECK_INTERVAL_MS = 48 * 60 * 60 * 1000
const DEFAULT_BACKGROUND_SYNC_INTERVAL_MINUTES = 10
const MIN_BACKGROUND_SYNC_INTERVAL_MINUTES = 1
const MAX_BACKGROUND_SYNC_INTERVAL_MINUTES = 1440
const SYSTEM_DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

type ResolvedTheme = 'light' | 'dark'

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))
const getSidebarBounds = (
  viewportWidth: number
): { min: number; max: number } => {
  const max = Math.max(
    SIDEBAR_COLLAPSE_MIN_WIDTH,
    Math.min(
      SIDEBAR_MAX_WIDTH,
      viewportWidth - DETAIL_MIN_WIDTH - RESIZER_WIDTH
    )
  )
  const min = Math.min(SIDEBAR_MIN_WIDTH, max)
  return { min, max }
}
const uiLog = (message: string, meta?: unknown): void => {
  console.info(`[ui] ${message}`, meta ?? {})
}

type SyncSource = 'manual' | 'settings-save' | 'background'

interface SyncWaiter {
  resolve: () => void
  reject: (error: Error) => void
}

interface PendingSyncRequest {
  source: SyncSource
  waiters: SyncWaiter[]
}

interface PendingUpdateCheck {
  force: boolean
  showErrors: boolean
}

interface BackgroundSyncStatus {
  state: 'idle' | 'running' | 'queued' | 'success' | 'error'
  lastSyncedAt: string | null
  lastError: string | null
}

const syncPriority = (source: SyncSource): number => {
  switch (source) {
    case 'settings-save':
      return 3
    case 'manual':
      return 2
    case 'background':
      return 1
  }
}

const normalizeBackgroundIntervalMinutes = (
  value: number | undefined
): number =>
  Math.max(
    MIN_BACKGROUND_SYNC_INTERVAL_MINUTES,
    Math.min(
      MAX_BACKGROUND_SYNC_INTERVAL_MINUTES,
      Number.isFinite(value ?? NaN)
        ? Math.trunc(value as number)
        : DEFAULT_BACKGROUND_SYNC_INTERVAL_MINUTES
    )
  )

const resolveTheme = (
  appearance: AppearancePreference,
  prefersDark: boolean
): ResolvedTheme =>
  appearance === 'system' ? (prefersDark ? 'dark' : 'light') : appearance

const areArraysEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

const shouldTriggerSyncForConfigChange = (
  current: AppConfig | null,
  next: AppConfig
): boolean => {
  if (!current) {
    return true
  }

  return (
    current.discoveryMode !== next.discoveryMode ||
    current.syncMode !== next.syncMode ||
    normalizeBackgroundIntervalMinutes(
      current.backgroundSyncIntervalMinutes
    ) !==
      normalizeBackgroundIntervalMinutes(next.backgroundSyncIntervalMinutes) ||
    !areArraysEqual(current.repoRoots, next.repoRoots) ||
    !areArraysEqual(current.explicitPatterns, next.explicitPatterns)
  )
}

export const App = () => {
  const apiRef = useMemo(
    () =>
      (window as Window & { copilotSessions?: RendererApi }).copilotSessions ??
      null,
    []
  )
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [starredMessages, setStarredMessages] = useState<
    StarredMessageSummary[]
  >([])
  const [allStarredMessages, setAllStarredMessages] = useState<
    StarredMessageSummary[]
  >([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<SessionDetail | null>(
    null
  )
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  )
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [autoDiscoveredPatterns, setAutoDiscoveredPatterns] = useState<
    AutoDiscoveredPatternInfo[]
  >([])
  const [showSettings, setShowSettings] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false)
  const [updateDownloadProgress, setUpdateDownloadProgress] =
    useState<UpdateDownloadProgress | null>(null)
  const [selectedRepos, setSelectedRepos] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [selectedEstimatedCosts, setSelectedEstimatedCosts] = useState<
    SessionCostCategory[]
  >([])
  const [selectedOrigins, setSelectedOrigins] = useState<SessionSource[]>([])
  const [dateFilter, setDateFilter] = useState<DateFilterValue>('')
  const [archivedFilter, setArchivedFilter] =
    useState<ArchivedFilterValue>('hide')
  const [starredFilter, setStarredFilter] = useState<StarredFilterValue>('all')
  const [subagentFilter, setSubagentFilter] =
    useState<SubagentFilterValue>('hide')
  const [backgroundSyncStatus, setBackgroundSyncStatus] =
    useState<BackgroundSyncStatus>({
      state: 'idle',
      lastSyncedAt: null,
      lastError: null
    })
  const listRequestIdRef = useRef(0)
  const hasInitializedSearchEffectRef = useRef(false)
  const hasLoadedAllStarsRef = useRef(false)
  const selectedIdRef = useRef<string | null>(null)
  const searchQueryRef = useRef('')
  const syncInFlightRef = useRef(false)
  const queuedSyncRef = useRef<PendingSyncRequest | null>(null)
  const updateCheckInFlightRef = useRef(false)
  const queuedUpdateCheckRef = useRef<PendingUpdateCheck | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const value = Number(
      window.localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? '360'
    )
    const bounds = getSidebarBounds(window.innerWidth)
    return clamp(value, bounds.min, bounds.max)
  })

  const ensureApi = useCallback((): RendererApi => {
    if (!apiRef) {
      throw new Error(
        'Renderer bridge unavailable. Restart the app after rebuilding.'
      )
    }
    return apiRef
  }, [apiRef])

  const requestUpdateCheck = useCallback(
    async (force: boolean, showErrors: boolean): Promise<void> => {
      if (updateCheckInFlightRef.current) {
        if (force || showErrors) {
          const queued = queuedUpdateCheckRef.current
          queuedUpdateCheckRef.current = {
            force: force || queued?.force === true,
            showErrors: showErrors || queued?.showErrors === true
          }
          if (force) {
            setIsCheckingUpdates(true)
          }
          if (showErrors) {
            setUpdateError(null)
          }
        }
        return
      }
      updateCheckInFlightRef.current = true
      if (force) {
        setIsCheckingUpdates(true)
      }
      if (showErrors) {
        setUpdateError(null)
      }
      try {
        const status = await ensureApi().checkForUpdates({ force })
        setUpdateStatus(status)
      } catch (error) {
        if (showErrors) {
          setUpdateError((error as Error).message)
        }
        uiLog('Update check failed', { message: (error as Error).message })
      } finally {
        const queued = queuedUpdateCheckRef.current
        queuedUpdateCheckRef.current = null
        updateCheckInFlightRef.current = false
        if (queued) {
          void requestUpdateCheck(queued.force, queued.showErrors)
        } else if (force) {
          setIsCheckingUpdates(false)
        }
      }
    },
    [ensureApi]
  )

  const onDownloadUpdate = useCallback(async (): Promise<void> => {
    setIsDownloadingUpdate(true)
    setUpdateError(null)
    setUpdateDownloadProgress(null)
    try {
      const status = await ensureApi().downloadLatestUpdate()
      setUpdateStatus(status)
      setToast('Update DMG opened. Drag AgentStash to Applications to install.')
    } catch (error) {
      setUpdateError((error as Error).message)
      try {
        setUpdateStatus(await ensureApi().getUpdateStatus())
      } catch (statusError) {
        uiLog('Failed refreshing update status after download error', {
          message: (statusError as Error).message
        })
      }
    } finally {
      setIsDownloadingUpdate(false)
    }
  }, [ensureApi])

  const onDismissUpdate = useCallback(async (): Promise<void> => {
    try {
      setUpdateStatus(await ensureApi().dismissLatestUpdate())
    } catch (error) {
      setUpdateError((error as Error).message)
    }
  }, [ensureApi])

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    const unsubscribe = ensureApi().onUpdateDownloadProgress(progress => {
      setUpdateDownloadProgress(progress)
    })
    return unsubscribe
  }, [ensureApi])

  useEffect(() => {
    searchQueryRef.current = searchQuery
  }, [searchQuery])

  useEffect(() => {
    if (!config) {
      return
    }

    const mediaQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia(SYSTEM_DARK_MEDIA_QUERY)
        : null
    const applyResolvedTheme = (): void => {
      const nextTheme = resolveTheme(
        config.appearance,
        mediaQuery?.matches ?? false
      )
      const root = document.documentElement
      root.dataset.theme = nextTheme
      root.style.colorScheme = nextTheme
      setResolvedTheme(current => (current === nextTheme ? current : nextTheme))
      uiLog('Applied renderer theme', {
        appearance: config.appearance,
        resolvedTheme: nextTheme
      })
    }

    applyResolvedTheme()
    if (config.appearance !== 'system' || !mediaQuery) {
      return
    }

    const onChange = (): void => {
      applyResolvedTheme()
    }
    mediaQuery.addEventListener('change', onChange)
    return () => {
      mediaQuery.removeEventListener('change', onChange)
    }
  }, [config])

  const refreshList = useCallback(
    async (
      query: string,
      options?: { refreshAllStars?: boolean }
    ): Promise<SessionSummary[]> => {
      const startedAt = performance.now()
      const requestId = ++listRequestIdRef.current
      const shouldRefreshAllStars =
        Boolean(options?.refreshAllStars) || !hasLoadedAllStarsRef.current
      uiLog('Refreshing session list', {
        query,
        shouldRefreshAllStars,
        requestId
      })
      const api = ensureApi()
      const [rows, stars, allStars] = await Promise.all([
        api.listSessions(query),
        typeof api.listStarredMessages === 'function'
          ? api.listStarredMessages(query)
          : Promise.resolve([] as StarredMessageSummary[]),
        typeof api.listStarredMessages === 'function' && shouldRefreshAllStars
          ? api.listStarredMessages('')
          : Promise.resolve<StarredMessageSummary[] | null>(null)
      ])
      if (requestId !== listRequestIdRef.current) {
        uiLog('Discarding stale session list response', {
          query,
          requestId,
          latestRequestId: listRequestIdRef.current
        })
        return rows
      }
      setSessions(rows)
      setStarredMessages(stars)
      if (allStars) {
        setAllStarredMessages(allStars)
        hasLoadedAllStarsRef.current = true
      }
      setSelectedId(previous =>
        rows.some(row => row.id === previous) ? previous : (rows[0]?.id ?? null)
      )
      uiLog('Session list refreshed', {
        query,
        count: rows.length,
        stars: stars.length,
        allStars: allStars?.length ?? 'cached',
        durationMs: Math.round(performance.now() - startedAt)
      })
      return rows
    },
    [ensureApi]
  )

  const refreshSelectedDetailIfPresent = useCallback(
    async (
      sessionId: string | null,
      selectableRows?: SessionSummary[]
    ): Promise<void> => {
      if (!sessionId) {
        return
      }
      if (selectableRows && !selectableRows.some(row => row.id === sessionId)) {
        return
      }
      try {
        const detail = await ensureApi().getSessionDetail(sessionId)
        setSelectedDetail(detail)
      } catch (error) {
        uiLog('Failed refreshing selected session detail', {
          sessionId,
          message: (error as Error).message
        })
      }
    },
    [ensureApi]
  )

  useEffect(() => {
    const init = async (): Promise<void> => {
      try {
        uiLog('Initializing app state')
        const [loadedConfig, loadedAutoDiscoveredPatterns] = await Promise.all([
          ensureApi().getConfig(),
          ensureApi().getAutoDiscoveredPatterns()
        ])
        const loadedUpdateStatus = await ensureApi().getUpdateStatus()
        setConfig(loadedConfig)
        setAutoDiscoveredPatterns(loadedAutoDiscoveredPatterns)
        setUpdateStatus(loadedUpdateStatus)
        uiLog('Config loaded in renderer', {
          repoRoots: loadedConfig.repoRoots.length,
          discoveryMode: loadedConfig.discoveryMode,
          appearance: loadedConfig.appearance
        })
        void requestUpdateCheck(false, false)
        await refreshList('', { refreshAllStars: true })
      } catch (error) {
        const message = `Init failed: ${(error as Error).message}`
        setToast(message)
        uiLog('Initialization failed', { message })
      }
    }

    void init()
  }, [ensureApi, refreshList, requestUpdateCheck])

  useEffect(() => {
    const requestThrottledCheck = (): void => {
      void requestUpdateCheck(false, false)
    }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        requestThrottledCheck()
      }
    }

    window.addEventListener('focus', requestThrottledCheck)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const timer = window.setInterval(
      requestThrottledCheck,
      UPDATE_CHECK_INTERVAL_MS
    )
    return () => {
      window.removeEventListener('focus', requestThrottledCheck)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(timer)
    }
  }, [requestUpdateCheck])

  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null)
      return
    }

    void ensureApi()
      .getSessionDetail(selectedId)
      .then(detail => {
        setSelectedDetail(detail)
      })
      .catch(error => {
        setToast(`Failed loading session: ${(error as Error).message}`)
      })
  }, [ensureApi, selectedId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [searchQuery])

  useEffect(() => {
    if (!hasInitializedSearchEffectRef.current) {
      hasInitializedSearchEffectRef.current = true
      return
    }

    const startedAt = performance.now()
    void refreshList(debouncedSearchQuery)
      .then(() => {
        uiLog('Search refresh completed', {
          query: debouncedSearchQuery,
          durationMs: Math.round(performance.now() - startedAt)
        })
      })
      .catch(error => {
        setToast(`Search failed: ${(error as Error).message}`)
      })
  }, [debouncedSearchQuery, refreshList])

  const repositoryOptions = useMemo(
    () => (config?.repoRoots ?? []).slice().sort((a, b) => a.localeCompare(b)),
    [config]
  )
  const modelOptions = useMemo(
    () =>
      [
        ...new Set(
          sessions
            .map(session => normalizeModelLabel(session.model))
            .filter(Boolean)
        )
      ].sort((a, b) => a.localeCompare(b)),
    [sessions]
  )
  const originOptions = useMemo(
    () => ['vscode', 'cli', 'opencode', 'claude'] as SessionSource[],
    []
  )
  const estimatedCostOptions = useMemo(
    () => ['$', '$$', '$$$', 'unavailable'] as SessionCostCategory[],
    []
  )

  useEffect(() => {
    setSelectedRepos(current =>
      current.filter(repoPath => repositoryOptions.includes(repoPath))
    )
  }, [repositoryOptions])

  useEffect(() => {
    setSelectedModels(current =>
      current.filter(model => modelOptions.includes(model))
    )
  }, [modelOptions])

  useEffect(() => {
    setSelectedOrigins(current =>
      current.filter(source => originOptions.includes(source))
    )
  }, [originOptions])

  useEffect(() => {
    const onResize = (): void => {
      const bounds = getSidebarBounds(window.innerWidth)
      setSidebarWidth(current => {
        const next = clamp(current, bounds.min, bounds.max)
        if (next !== current) {
          window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next))
        }
        return next
      })
    }

    window.addEventListener('resize', onResize)
    window.addEventListener('focus', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    onResize()
    const resizeSyncTimer = window.setTimeout(onResize, 50)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('focus', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
      window.clearTimeout(resizeSyncTimer)
    }
  }, [])

  const baseFilteredSessions = useMemo(() => {
    return sessions.filter(session => {
      if (!matchesRepositoryFilter(session.repoPath, selectedRepos)) {
        return false
      }
      const modelLabel = normalizeModelLabel(session.model)
      if (
        selectedModels.length > 0 &&
        (!modelLabel || !selectedModels.includes(modelLabel))
      ) {
        return false
      }
      if (
        selectedEstimatedCosts.length > 0 &&
        !selectedEstimatedCosts.includes(
          sessionCostCategory(session.tokenUsage)
        )
      ) {
        return false
      }
      if (
        selectedOrigins.length > 0 &&
        !selectedOrigins.includes(session.source)
      ) {
        return false
      }
      if (dateFilter && !matchesIstDatePreset(session.updatedAt, dateFilter)) {
        return false
      }
      if (subagentFilter === 'hide' && session.isSubagentSession) {
        return false
      }
      return true
    })
  }, [
    dateFilter,
    selectedEstimatedCosts,
    selectedModels,
    selectedOrigins,
    selectedRepos,
    sessions,
    subagentFilter
  ])

  const archivedSearchMatches = useMemo(
    () => baseFilteredSessions.filter(session => Boolean(session.userArchived)),
    [baseFilteredSessions]
  )

  const filteredSessions = useMemo(() => {
    const byArchive =
      archivedFilter === 'show'
        ? baseFilteredSessions
        : archivedFilter === 'only'
          ? archivedSearchMatches
          : baseFilteredSessions.filter(session => !session.userArchived)

    if (starredFilter === 'all') {
      return byArchive
    }
    const starredSessionIds = new Set(
      allStarredMessages.map(star => star.sessionId)
    )
    return byArchive.filter(session => starredSessionIds.has(session.id))
  }, [
    allStarredMessages,
    archivedFilter,
    archivedSearchMatches,
    baseFilteredSessions,
    starredFilter
  ])
  const sessionStats = useMemo(
    () => aggregateSessionCostStats(filteredSessions),
    [filteredSessions]
  )

  useEffect(() => {
    const additionalSelectableIds =
      searchQuery.trim().length > 0 && archivedFilter === 'hide'
        ? new Set(archivedSearchMatches.map(session => session.id))
        : new Set<string>()
    for (const starred of starredMessages) {
      additionalSelectableIds.add(starred.sessionId)
    }
    setSelectedId(previous =>
      filteredSessions.some(session => session.id === previous) ||
      (previous ? additionalSelectableIds.has(previous) : false)
        ? previous
        : (filteredSessions[0]?.id ?? null)
    )
  }, [
    archivedFilter,
    archivedSearchMatches,
    filteredSessions,
    searchQuery,
    starredMessages
  ])

  const onToggleRepo = useCallback((repoPath: string): void => {
    setSelectedRepos(current =>
      current.includes(repoPath)
        ? current.filter(item => item !== repoPath)
        : [...current, repoPath]
    )
  }, [])

  const onToggleModel = useCallback((model: string): void => {
    setSelectedModels(current =>
      current.includes(model)
        ? current.filter(item => item !== model)
        : [...current, model]
    )
  }, [])

  const onToggleEstimatedCost = useCallback(
    (value: SessionCostCategory): void => {
      setSelectedEstimatedCosts(current =>
        current.includes(value)
          ? current.filter(item => item !== value)
          : [...current, value]
      )
    },
    []
  )

  const onToggleOrigin = useCallback((source: SessionSource): void => {
    setSelectedOrigins(current =>
      current.includes(source)
        ? current.filter(item => item !== source)
        : [...current, source]
    )
  }, [])
  const onClearFilters = useCallback((): void => {
    setSelectedRepos([])
    setSelectedModels([])
    setSelectedEstimatedCosts([])
    setSelectedOrigins([])
    setDateFilter('')
    setArchivedFilter('hide')
    setStarredFilter('all')
    setSubagentFilter('hide')
  }, [])

  const onSetArchived = useCallback(
    async (sessionId: string, archived: boolean): Promise<void> => {
      try {
        const api = ensureApi()
        if (typeof api.setSessionArchived !== 'function') {
          throw new Error(
            'Archive action unavailable. Restart pnpm dev so preload APIs refresh.'
          )
        }
        await api.setSessionArchived(sessionId, archived)
        await refreshList(searchQuery)
        setToast(archived ? 'Session archived.' : 'Session unarchived.')
      } catch (error) {
        setToast(`Failed to update archive state: ${(error as Error).message}`)
      }
    },
    [ensureApi, refreshList, searchQuery]
  )

  const onToggleMessageStar = useCallback(
    async (
      sessionId: string,
      messageId: string,
      starred: boolean
    ): Promise<void> => {
      try {
        const api = ensureApi()
        if (typeof api.setMessageStarred !== 'function') {
          throw new Error(
            'Star action unavailable. Restart pnpm dev so preload APIs refresh.'
          )
        }
        await api.setMessageStarred(sessionId, messageId, starred)
        const [detail] = await Promise.all([
          api.getSessionDetail(sessionId),
          refreshList(searchQuery, { refreshAllStars: true })
        ])
        setSelectedDetail(detail)
        setToast(starred ? 'Message starred.' : 'Message unstarred.')
      } catch (error) {
        setToast(`Failed to update star state: ${(error as Error).message}`)
      }
    },
    [ensureApi, refreshList, searchQuery]
  )

  const onSelectStarredMessage = useCallback(
    (sessionId: string, messageId: string): void => {
      setSelectedId(sessionId)
      setFocusMessageId(messageId)
    },
    []
  )

  const runSync = useCallback(
    async (source: SyncSource): Promise<void> => {
      const isBackground = source === 'background'
      if (isBackground) {
        setBackgroundSyncStatus(current => ({
          ...current,
          state: 'running'
        }))
      } else {
        setIsSyncing(true)
      }

      uiLog('Starting sync from UI', { source })

      try {
        const result = await ensureApi().syncSessions()
        setSyncResult(result)
        const rows = await refreshList(searchQueryRef.current, {
          refreshAllStars: true
        })
        await refreshSelectedDetailIfPresent(selectedIdRef.current, rows)

        if (source === 'manual') {
          setToast(
            `Sync complete: ${result.sessionsImported} sessions imported from ${result.filesScanned} files.`
          )
        } else if (source === 'settings-save') {
          setToast(
            `Settings saved and synced: ${result.sessionsImported} sessions imported from ${result.filesScanned} files.`
          )
        } else {
          setBackgroundSyncStatus({
            state: 'success',
            lastSyncedAt: new Date().toISOString(),
            lastError: null
          })
        }

        uiLog('Sync completed in UI', { source, result })
      } catch (error) {
        const reason = (error as Error).message
        if (isBackground) {
          setBackgroundSyncStatus(current => ({
            ...current,
            state: 'error',
            lastError: reason
          }))
          setToast(`Background sync failed: ${reason}`)
        } else {
          if (source === 'manual') {
            const message = `Sync failed: ${reason}`
            setToast(message)
            uiLog('Sync failed in UI', { source, message })
          } else {
            uiLog('Sync failed in UI', { source, message: reason })
          }
        }
        throw error
      } finally {
        if (!isBackground) {
          setIsSyncing(false)
        }
      }
    },
    [ensureApi, refreshList, refreshSelectedDetailIfPresent]
  )

  const requestSync = useCallback(
    (source: SyncSource): Promise<void> => {
      return new Promise((resolve, reject) => {
        const waiter: SyncWaiter = {
          resolve,
          reject
        }

        if (syncInFlightRef.current) {
          if (source === 'background') {
            setBackgroundSyncStatus(current => ({
              ...current,
              state: 'running'
            }))
            resolve()
            return
          }

          const queued = queuedSyncRef.current
          if (!queued) {
            queuedSyncRef.current = { source, waiters: [waiter] }
          } else if (syncPriority(source) > syncPriority(queued.source)) {
            queuedSyncRef.current = {
              source,
              waiters: [...queued.waiters, waiter]
            }
          } else {
            queued.waiters.push(waiter)
          }

          if (queuedSyncRef.current?.source !== 'background') {
            setBackgroundSyncStatus(current => {
              if (current.state !== 'queued') {
                return current
              }
              return {
                ...current,
                state: 'running'
              }
            })
          }
          setIsSyncing(true)
          return
        }

        const runQueued = async (
          initialRequest: PendingSyncRequest
        ): Promise<void> => {
          let currentRequest: PendingSyncRequest | null = initialRequest
          while (currentRequest) {
            syncInFlightRef.current = true
            try {
              await runSync(currentRequest.source)
              for (const currentWaiter of currentRequest.waiters) {
                currentWaiter.resolve()
              }
            } catch (error) {
              const normalizedError =
                error instanceof Error ? error : new Error(String(error))
              for (const currentWaiter of currentRequest.waiters) {
                currentWaiter.reject(normalizedError)
              }
            } finally {
              syncInFlightRef.current = false
            }
            currentRequest = queuedSyncRef.current
            queuedSyncRef.current = null
          }
        }

        void runQueued({
          source,
          waiters: [waiter]
        })
      })
    },
    [runSync]
  )

  const onSync = useCallback(async (): Promise<void> => {
    try {
      await requestSync('manual')
    } catch (error) {
      uiLog('Manual sync request failed', {
        message: (error as Error).message
      })
    }
  }, [requestSync])

  useEffect(() => {
    if (!config || config.syncMode !== 'manual-plus-background') {
      setBackgroundSyncStatus(current => ({
        ...current,
        state: 'idle'
      }))
      return
    }

    const intervalMinutes = normalizeBackgroundIntervalMinutes(
      config.backgroundSyncIntervalMinutes
    )
    const intervalMs = intervalMinutes * 60_000
    uiLog('Background sync scheduler enabled', {
      intervalMinutes
    })

    const timer = window.setInterval(() => {
      void requestSync('background').catch(error => {
        uiLog('Background sync request failed', {
          message: (error as Error).message
        })
      })
    }, intervalMs)

    return () => {
      window.clearInterval(timer)
      uiLog('Background sync scheduler disabled')
    }
  }, [config, requestSync])

  const onSaveConfig = async (next: AppConfig): Promise<void> => {
    try {
      uiLog('Saving config from settings modal', {
        repoRoots: next.repoRoots.length,
        discoveryMode: next.discoveryMode,
        explicitPatterns: next.explicitPatterns.length,
        appearance: next.appearance,
        syncMode: next.syncMode,
        backgroundSyncIntervalMinutes: next.backgroundSyncIntervalMinutes
      })
      const saved = await ensureApi().saveConfig(next)
      const shouldSync = shouldTriggerSyncForConfigChange(config, saved)
      setConfig(saved)
      if (shouldSync) {
        setToast('Settings saved. Syncing...')
        uiLog('Settings saved, triggering sync', {
          repoRoots: saved.repoRoots.length
        })
        await requestSync('settings-save')
      } else {
        setToast('Settings saved.')
        uiLog('Settings saved without sync', {
          appearance: saved.appearance
        })
      }
    } catch (error) {
      const message = `Config save failed: ${(error as Error).message}`
      setToast(message)
      uiLog('Config save failed', { message })
      throw error
    }
  }

  const onOpenConfigFile = async (): Promise<void> => {
    try {
      await ensureApi().openConfigFile()
      setToast('Opened config file.')
    } catch (error) {
      setToast(`Open config failed: ${(error as Error).message}`)
    }
  }

  const onCopySessionId = useCallback(
    async (sessionId: string): Promise<void> => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(sessionId)
        } else {
          const input = document.createElement('textarea')
          input.value = sessionId
          input.setAttribute('readonly', 'true')
          input.style.position = 'fixed'
          input.style.left = '-10000px'
          document.body.appendChild(input)
          input.select()
          const copied = document.execCommand('copy')
          document.body.removeChild(input)
          if (!copied) {
            throw new Error('Clipboard API unavailable')
          }
        }
        setToast('Session ID copied.')
      } catch (error) {
        setToast(`Copy failed: ${(error as Error).message}`)
      }
    },
    []
  )

  const startResize = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth

    const onMove = (moveEvent: globalThis.MouseEvent): void => {
      const bounds = getSidebarBounds(window.innerWidth)
      const next = clamp(
        startWidth + (moveEvent.clientX - startX),
        bounds.min,
        bounds.max
      )
      setSidebarWidth(next)
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next))
    }

    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const syncErrors = useMemo(() => {
    if (!syncResult || syncResult.errors.length === 0) {
      return null
    }
    return `${syncResult.errors.length} file errors captured during sync.`
  }, [syncResult])
  const backgroundStatusText = useMemo(() => {
    if (!config || config.syncMode !== 'manual-plus-background') {
      return null
    }
    if (backgroundSyncStatus.state === 'running') {
      return 'Background sync running...'
    }
    if (backgroundSyncStatus.state === 'queued') {
      return 'Background sync queued...'
    }
    if (
      backgroundSyncStatus.state === 'error' &&
      backgroundSyncStatus.lastError
    ) {
      return `Background sync failed: ${backgroundSyncStatus.lastError}`
    }
    if (backgroundSyncStatus.lastSyncedAt) {
      return `Background sync: ${formatTimestampIST(backgroundSyncStatus.lastSyncedAt)}`
    }
    return 'Background sync enabled'
  }, [backgroundSyncStatus, config])
  const hasActiveFilters =
    selectedRepos.length > 0 ||
    selectedModels.length > 0 ||
    selectedEstimatedCosts.length > 0 ||
    selectedOrigins.length > 0 ||
    Boolean(dateFilter) ||
    archivedFilter !== 'hide' ||
    starredFilter !== 'all' ||
    subagentFilter !== 'hide'

  return (
    <div className="app-root">
      <header className="topbar">
        <h1>AgentStash</h1>

        <div className="topbar-actions">
          <button
            type="button"
            onClick={() => void onSync()}
            disabled={isSyncing}
          >
            {isSyncing ? 'Syncing...' : 'Sync'}
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            disabled={!config}
            aria-label={
              updateStatus?.notificationVisible && !isDownloadingUpdate
                ? 'Settings, update available'
                : 'Settings'
            }
            className={
              updateStatus?.notificationVisible && !isDownloadingUpdate
                ? 'topbar-button-with-dot'
                : undefined
            }
          >
            Settings
          </button>
          <button type="button" onClick={() => void onOpenConfigFile()}>
            Open Config JSON
          </button>
        </div>
      </header>

      <main className="layout">
        <div className="sidebar-shell" style={{ width: `${sidebarWidth}px` }}>
          <SessionListSidebar
            sessions={filteredSessions}
            starredMessages={starredMessages}
            archivedSearchMatches={archivedSearchMatches}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onSelectStarredMessage={onSelectStarredMessage}
            onSetArchived={(sessionId, archived) =>
              void onSetArchived(sessionId, archived)
            }
            query={searchQuery}
            onQueryChange={setSearchQuery}
            onClearFilters={onClearFilters}
            onOpenStats={() => setShowStats(true)}
            repoOptions={repositoryOptions}
            selectedRepos={selectedRepos}
            onToggleRepo={onToggleRepo}
            modelOptions={modelOptions}
            selectedModels={selectedModels}
            onToggleModel={onToggleModel}
            estimatedCostOptions={estimatedCostOptions}
            selectedEstimatedCosts={selectedEstimatedCosts}
            onToggleEstimatedCost={onToggleEstimatedCost}
            originOptions={originOptions}
            selectedOrigins={selectedOrigins}
            onToggleOrigin={onToggleOrigin}
            dateFilter={dateFilter}
            onDateFilterChange={setDateFilter}
            archivedFilter={archivedFilter}
            onArchivedFilterChange={setArchivedFilter}
            starredFilter={starredFilter}
            onStarredFilterChange={setStarredFilter}
            subagentFilter={subagentFilter}
            onSubagentFilterChange={setSubagentFilter}
            hasActiveFilters={hasActiveFilters}
          />
        </div>

        <div
          className="resizer"
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
        />

        <SessionDetailView
          detail={selectedDetail}
          theme={resolvedTheme}
          onCopySessionId={onCopySessionId}
          onToggleMessageStar={(sessionId, messageId, starred) =>
            void onToggleMessageStar(sessionId, messageId, starred)
          }
          focusMessageId={focusMessageId}
          onFocusedMessageConsumed={() => setFocusMessageId(null)}
        />
      </main>

      {(syncResult || toast || backgroundStatusText) && (
        <footer className="statusbar">
          {toast && <span>{toast}</span>}
          {syncResult && (
            <span>
              Last sync: imported {syncResult.sessionsImported} sessions,
              scanned {syncResult.filesScanned} files, skipped{' '}
              {syncResult.skippedFiles}, in {syncResult.durationSeconds}s
            </span>
          )}
          {syncErrors && <span>{syncErrors}</span>}
          {backgroundStatusText && <span>{backgroundStatusText}</span>}
        </footer>
      )}

      <SettingsModal
        isOpen={showSettings}
        config={config}
        autoDiscoveredPatterns={autoDiscoveredPatterns}
        updateStatus={updateStatus}
        isCheckingUpdates={isCheckingUpdates}
        isDownloadingUpdate={isDownloadingUpdate}
        updateDownloadProgress={updateDownloadProgress}
        updateError={updateError}
        onClose={() => setShowSettings(false)}
        onSave={onSaveConfig}
        onCheckUpdates={() => requestUpdateCheck(true, true)}
        onDownloadUpdate={onDownloadUpdate}
        onDismissUpdate={onDismissUpdate}
      />
      <SessionStatsModal
        isOpen={showStats}
        stats={sessionStats}
        dateFilter={dateFilter}
        onClose={() => setShowStats(false)}
      />
    </div>
  )
}

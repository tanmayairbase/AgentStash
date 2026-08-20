import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  ClaudeUsageEvent,
  MessageStarRecord,
  SessionDetail,
  SessionExecutionMode,
  SessionMessage,
  SessionSource,
  SessionSummary,
  StarredMessageSummary
} from '../shared/types'
import { logError, logInfo, logWarn } from './logger'
import { buildSessionFamilyIndex } from './session-families'

export interface SessionInsert {
  session: SessionSummary
  messages: SessionMessage[]
}

export interface ArtifactSyncCacheEntry {
  filePath: string
  mtimeMs: number
  size: number
  repoRoot: string
  source: SessionSource
  cliSummaryToken: string
  parserVersion: number
  inserts: SessionInsert[]
}

export interface MergeSyncResult {
  newSessions: number
  updatedSessions: number
  archivedSessions: number
  totalSessions: number
}

interface PersistedStore {
  sessions: SessionSummary[]
  messages: SessionMessage[]
  stars: MessageStarRecord[]
  artifacts: ArtifactSyncCacheEntry[]
}

interface ResolvedSessionFamily {
  familyId: string
  summary: SessionSummary
  members: SessionSummary[]
  branch: SessionSummary
  branches: NonNullable<SessionDetail['branches']>
}

const emptyStore = (): PersistedStore => ({
  sessions: [],
  messages: [],
  stars: [],
  artifacts: []
})
const ARCHIVE_PRUNE_MONTHS = 4

const normalize = (value: string): string => value.toLowerCase()
const normalizeOptionalText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed || undefined
}
const normalizeExecutionMode = (
  value: unknown
): SessionExecutionMode | null => {
  return value === 'plan' || value === 'autopilot' ? value : null
}

const normalizeExecutionModes = (
  values: SessionSummary['modes']
): SessionExecutionMode[] | undefined => {
  if (!Array.isArray(values)) {
    return undefined
  }
  const normalized = values
    .map(value => normalizeExecutionMode(value))
    .filter((value): value is SessionExecutionMode => Boolean(value))
  return normalized.length > 0 ? [...new Set(normalized)] : undefined
}

const ensureIso = (value: string | undefined, fallback: string): string => {
  if (!value) {
    return fallback
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return fallback
  }
  return parsed.toISOString()
}
const normalizeSessionSummary = (session: SessionSummary): SessionSummary => {
  const createdAt = ensureIso(session.createdAt, new Date().toISOString())
  const updatedAt = ensureIso(session.updatedAt, createdAt)
  const firstSeenAt = ensureIso(session.firstSeenAt, createdAt)
  const lastSeenAt = ensureIso(session.lastSeenAt, updatedAt)
  const modes = normalizeExecutionModes(session.modes)
  const latestMode =
    normalizeExecutionMode(session.latestMode) ??
    modes?.[modes.length - 1] ??
    null
  const userArchived = Boolean(session.userArchived)
  const userArchivedAt = userArchived
    ? ensureIso(session.userArchivedAt, updatedAt)
    : undefined
  const parentSessionId = normalizeOptionalText(session.parentSessionId)
  const normalizeStringArray = (values: unknown): string[] | undefined => {
    if (!Array.isArray(values)) {
      return undefined
    }
    const normalized = values
      .map(value => normalizeOptionalText(value))
      .filter((value): value is string => Boolean(value))
    return normalized.length > 0 ? [...new Set(normalized)] : undefined
  }
  const claudeUsageEvents = Array.isArray(session.claudeUsageEvents)
    ? session.claudeUsageEvents
        .filter(
          (event): event is ClaudeUsageEvent =>
            Boolean(event) &&
            typeof event.id === 'string' &&
            typeof event.modelId === 'string'
        )
        .map(event => ({
          ...event,
          inputTokens: Number.isFinite(event.inputTokens)
            ? event.inputTokens
            : 0,
          cachedInputTokens: Number.isFinite(event.cachedInputTokens)
            ? event.cachedInputTokens
            : 0,
          cacheWriteTokens: Number.isFinite(event.cacheWriteTokens)
            ? event.cacheWriteTokens
            : 0,
          cacheWrite1hTokens: Number.isFinite(event.cacheWrite1hTokens)
            ? event.cacheWrite1hTokens
            : 0,
          outputTokens: Number.isFinite(event.outputTokens)
            ? event.outputTokens
            : 0,
          reasoningTokens: Number.isFinite(event.reasoningTokens)
            ? event.reasoningTokens
            : 0
        }))
    : undefined

  return {
    ...session,
    createdAt,
    updatedAt,
    isSubagentSession: Boolean(session.isSubagentSession),
    parentSessionId,
    lineageMessageIds: normalizeStringArray(session.lineageMessageIds),
    lineageParentMessageIds: normalizeStringArray(
      session.lineageParentMessageIds
    ),
    claudeUsageEvents,
    modes,
    latestMode,
    firstSeenAt,
    lastSeenAt,
    missingFromLastSync: Boolean(session.missingFromLastSync),
    userArchived,
    userArchivedAt
  }
}

const normalizeSessionMessage = (message: SessionMessage): SessionMessage => ({
  ...message,
  mode: normalizeExecutionMode(message.mode) ?? undefined,
  timestamp: ensureIso(message.timestamp, new Date().toISOString())
})

const normalizeStarRecord = (star: MessageStarRecord): MessageStarRecord => {
  const createdAt = ensureIso(star.createdAt, new Date().toISOString())
  const updatedAt = ensureIso(star.updatedAt, createdAt)
  return {
    sessionId: star.sessionId,
    messageId: star.messageId,
    createdAt,
    updatedAt,
    stale: Boolean(star.stale),
    lastKnownRole: star.lastKnownRole === 'assistant' ? 'assistant' : 'user',
    lastKnownContent:
      typeof star.lastKnownContent === 'string' ? star.lastKnownContent : '',
    lastKnownTimestamp: ensureIso(star.lastKnownTimestamp, updatedAt)
  }
}

const normalizeArtifactSyncCacheEntry = (
  entry: ArtifactSyncCacheEntry
): ArtifactSyncCacheEntry => ({
  filePath: typeof entry.filePath === 'string' ? entry.filePath : '',
  mtimeMs: Number.isFinite(entry.mtimeMs) ? entry.mtimeMs : 0,
  size: Number.isFinite(entry.size) ? entry.size : 0,
  repoRoot: typeof entry.repoRoot === 'string' ? entry.repoRoot : '',
  source:
    entry.source === 'vscode' || entry.source === 'opencode'
      ? entry.source
      : 'cli',
  cliSummaryToken:
    typeof entry.cliSummaryToken === 'string' ? entry.cliSummaryToken : '',
  parserVersion:
    Number.isFinite(entry.parserVersion) && entry.parserVersion > 0
      ? Math.trunc(entry.parserVersion)
      : 0,
  inserts: Array.isArray(entry.inserts)
    ? entry.inserts.map(row => ({
        session: normalizeSessionSummary(row.session),
        messages: Array.isArray(row.messages)
          ? row.messages.map(message => normalizeSessionMessage(message))
          : []
      }))
    : []
})

const subtractMonthsUtc = (value: string, months: number): Date => {
  const date = new Date(value)
  date.setUTCMonth(date.getUTCMonth() - months)
  return date
}

export class SessionStorage {
  private store: PersistedStore
  private sessionById = new Map<string, SessionSummary>()
  private messagesBySession = new Map<string, SessionMessage[]>()
  private messageLookupBySession = new Map<
    string,
    Map<string, SessionMessage>
  >()
  private starsBySession = new Map<string, MessageStarRecord[]>()
  private searchIndexBySession = new Map<string, string>()
  private searchIndexByBranch = new Map<string, string>()
  private familySummaryById = new Map<string, SessionSummary>()
  private familyMembersById = new Map<string, SessionSummary[]>()
  private familyIdBySessionId = new Map<string, string>()
  private branchesByFamilyId = new Map<
    string,
    NonNullable<SessionDetail['branches']>
  >()
  private detailCache = new Map<string, SessionDetail>()
  private readonly detailCacheLimit = 24

  constructor(private readonly storagePath: string) {
    logInfo('Initializing session storage', { storagePath })
    this.store = this.load()
    this.rebuildDerivedState()
  }

  private load(): PersistedStore {
    try {
      if (!existsSync(this.storagePath)) {
        logWarn('Storage file missing, using empty store', {
          storagePath: this.storagePath
        })
        return emptyStore()
      }
      const raw = readFileSync(this.storagePath, 'utf8')
      const parsed = JSON.parse(raw) as PersistedStore
      if (!Array.isArray(parsed.sessions) || !Array.isArray(parsed.messages)) {
        logWarn('Storage file invalid structure, using empty store', {
          storagePath: this.storagePath
        })
        return emptyStore()
      }
      const parsedStars = Array.isArray((parsed as { stars?: unknown }).stars)
        ? ((parsed as { stars?: MessageStarRecord[] }).stars ?? []).map(star =>
            normalizeStarRecord(star)
          )
        : []
      const normalized: PersistedStore = {
        sessions: parsed.sessions.map(session =>
          normalizeSessionSummary(session)
        ),
        messages: parsed.messages.map(message =>
          normalizeSessionMessage(message)
        ),
        stars: parsedStars,
        artifacts: Array.isArray((parsed as { artifacts?: unknown }).artifacts)
          ? (
              (parsed as { artifacts?: ArtifactSyncCacheEntry[] }).artifacts ??
              []
            ).map(entry => normalizeArtifactSyncCacheEntry(entry))
          : []
      }
      logInfo('Storage loaded', {
        sessions: normalized.sessions.length,
        messages: normalized.messages.length,
        stars: normalized.stars.length,
        artifacts: normalized.artifacts.length
      })
      return normalized
    } catch (error) {
      logError('Failed to load storage file, using empty store', {
        storagePath: this.storagePath,
        reason: (error as Error).message
      })
      return emptyStore()
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.storagePath), { recursive: true })
    writeFileSync(
      this.storagePath,
      `${JSON.stringify(this.store, null, 2)}\n`,
      'utf8'
    )
    logInfo('Storage persisted', {
      storagePath: this.storagePath,
      sessions: this.store.sessions.length,
      messages: this.store.messages.length,
      stars: this.store.stars.length,
      artifacts: this.store.artifacts.length
    })
  }

  private buildBranchSearchHaystack(session: SessionSummary): string {
    return [
      session.id,
      session.title,
      session.repoPath,
      session.agent ?? '',
      session.model ?? '',
      ...(this.messagesBySession.get(session.id) ?? []).map(
        message => message.content
      )
    ]
      .join('\n')
      .toLowerCase()
  }

  private buildFamilySearchHaystack(session: SessionSummary): string {
    return (this.familyMembersById.get(session.id) ?? [session])
      .map(
        member =>
          this.searchIndexByBranch.get(member.id) ??
          this.buildBranchSearchHaystack(member)
      )
      .join('\n')
  }

  private resolveSessionFamily(
    sessionId: string,
    requestedBranchId?: string
  ): ResolvedSessionFamily | null {
    const familyId = this.familySummaryById.has(sessionId)
      ? sessionId
      : this.familyIdBySessionId.get(sessionId)
    if (!familyId) {
      return null
    }

    const summary = this.familySummaryById.get(familyId)
    const members = this.familyMembersById.get(familyId)
    if (!summary || !members?.length) {
      return null
    }

    const defaultBranchId = this.familySummaryById.has(sessionId)
      ? (summary.currentBranchId ?? summary.id)
      : sessionId
    const candidateBranchId = requestedBranchId ?? defaultBranchId
    const branchId =
      this.familyIdBySessionId.get(candidateBranchId) === familyId
        ? candidateBranchId
        : (summary.currentBranchId ?? summary.id)
    const branch = this.sessionById.get(branchId)
    if (!branch) {
      return null
    }

    return {
      familyId,
      summary,
      members,
      branch,
      branches: this.branchesByFamilyId.get(familyId) ?? []
    }
  }

  private rebuildDerivedState(): void {
    this.sessionById = new Map(
      this.store.sessions.map(session => [session.id, session])
    )
    this.messagesBySession = new Map()
    this.messageLookupBySession = new Map()
    for (const message of this.store.messages) {
      const rows = this.messagesBySession.get(message.sessionId) ?? []
      rows.push(message)
      this.messagesBySession.set(message.sessionId, rows)
    }
    for (const [sessionId, rows] of this.messagesBySession.entries()) {
      rows.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
      this.messageLookupBySession.set(
        sessionId,
        new Map(rows.map(message => [message.id, message]))
      )
    }

    this.starsBySession = new Map()
    for (const star of this.store.stars) {
      const rows = this.starsBySession.get(star.sessionId) ?? []
      rows.push(star)
      this.starsBySession.set(star.sessionId, rows)
    }
    for (const rows of this.starsBySession.values()) {
      rows.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
    }

    const familyIndex = buildSessionFamilyIndex(
      this.store.sessions,
      this.messagesBySession
    )
    this.familySummaryById = new Map(
      familyIndex.summaries.map(session => [session.id, session])
    )
    this.familyMembersById = familyIndex.membersByFamilyId
    this.familyIdBySessionId = familyIndex.familyIdBySessionId
    this.branchesByFamilyId = familyIndex.branchesByFamilyId

    this.searchIndexByBranch = new Map(
      this.store.sessions.map(session => [
        session.id,
        this.buildBranchSearchHaystack(session)
      ])
    )
    this.searchIndexBySession = new Map()
    for (const session of familyIndex.summaries) {
      this.searchIndexBySession.set(
        session.id,
        this.buildFamilySearchHaystack(session)
      )
    }
    this.detailCache.clear()
  }

  private setDetailCache(cacheKey: string, detail: SessionDetail): void {
    if (this.detailCache.has(cacheKey)) {
      this.detailCache.delete(cacheKey)
    }
    this.detailCache.set(cacheKey, detail)
    if (this.detailCache.size <= this.detailCacheLimit) {
      return
    }
    const oldestKey = this.detailCache.keys().next().value as string | undefined
    if (!oldestKey) {
      return
    }
    this.detailCache.delete(oldestKey)
  }

  private reconcileStars(
    stars: MessageStarRecord[],
    sessionsById: ReadonlyMap<string, SessionSummary>,
    messagesBySession: ReadonlyMap<string, SessionMessage[]>
  ): MessageStarRecord[] {
    const output: MessageStarRecord[] = []
    for (const star of stars.map(entry => normalizeStarRecord(entry))) {
      if (!sessionsById.has(star.sessionId)) {
        continue
      }
      const liveMessage = (messagesBySession.get(star.sessionId) ?? []).find(
        message => message.id === star.messageId
      )
      if (liveMessage) {
        output.push(
          normalizeStarRecord({
            ...star,
            stale: false,
            lastKnownRole: liveMessage.role,
            lastKnownContent: liveMessage.content,
            lastKnownTimestamp: liveMessage.timestamp
          })
        )
        continue
      }
      output.push(
        normalizeStarRecord({
          ...star,
          stale: true
        })
      )
    }
    return output
  }

  replaceAll(rows: SessionInsert[]): void {
    logInfo('Replacing storage content', { rows: rows.length })
    const sessions = rows.map(row => normalizeSessionSummary(row.session))
    const messages = rows.flatMap(row =>
      row.messages.map(message => normalizeSessionMessage(message))
    )
    const sessionsById = new Map(sessions.map(session => [session.id, session]))
    const messagesBySession = new Map<string, SessionMessage[]>()
    for (const message of messages) {
      const entries = messagesBySession.get(message.sessionId) ?? []
      entries.push(message)
      messagesBySession.set(message.sessionId, entries)
    }

    this.store.sessions = sessions
    this.store.messages = messages
    this.store.stars = this.reconcileStars(
      this.store.stars,
      sessionsById,
      messagesBySession
    )
    this.store.artifacts = []
    this.rebuildDerivedState()
    this.persist()
  }

  getArtifactSyncCache(): Map<string, ArtifactSyncCacheEntry> {
    return new Map(this.store.artifacts.map(entry => [entry.filePath, entry]))
  }

  mergeFromSync(
    rows: SessionInsert[],
    syncedAt = new Date().toISOString(),
    artifactCache?: ArtifactSyncCacheEntry[]
  ): MergeSyncResult {
    logInfo('Merging sync rows into storage', { rows: rows.length, syncedAt })

    const existingSessionsById = new Map(
      this.store.sessions.map(session => [session.id, session])
    )
    const existingMessagesBySession = new Map<string, SessionMessage[]>()
    for (const message of this.store.messages) {
      const rowsForSession =
        existingMessagesBySession.get(message.sessionId) ?? []
      rowsForSession.push(message)
      existingMessagesBySession.set(message.sessionId, rowsForSession)
    }

    const nextSessionsById = new Map(existingSessionsById)
    const nextMessagesBySession = new Map(existingMessagesBySession)
    const seenInCurrentSync = new Set<string>()
    let newSessions = 0
    let updatedSessions = 0

    for (const row of rows) {
      const normalizedIncoming = normalizeSessionSummary(row.session)
      const existing = nextSessionsById.get(normalizedIncoming.id)
      seenInCurrentSync.add(normalizedIncoming.id)

      if (existing) {
        updatedSessions += 1
      } else {
        newSessions += 1
      }

      const upstreamChanged = existing
        ? new Date(normalizedIncoming.updatedAt).getTime() >
            new Date(existing.updatedAt).getTime() ||
          normalizedIncoming.messageCount !== existing.messageCount
        : true
      const preserveManualArchive = Boolean(
        existing?.userArchived && !upstreamChanged
      )
      const archiveTimestamp = preserveManualArchive
        ? existing?.userArchivedAt
        : undefined

      nextSessionsById.set(normalizedIncoming.id, {
        ...normalizedIncoming,
        firstSeenAt:
          existing?.firstSeenAt ?? normalizedIncoming.firstSeenAt ?? syncedAt,
        lastSeenAt: syncedAt,
        missingFromLastSync: false,
        userArchived: preserveManualArchive,
        userArchivedAt: archiveTimestamp
      })
      nextMessagesBySession.set(
        normalizedIncoming.id,
        row.messages.map(message => normalizeSessionMessage(message))
      )
    }

    for (const [sessionId, session] of nextSessionsById.entries()) {
      if (seenInCurrentSync.has(sessionId)) {
        continue
      }
      nextSessionsById.set(sessionId, {
        ...session,
        missingFromLastSync: true
      })
    }

    const pruneCutoff = subtractMonthsUtc(
      syncedAt,
      ARCHIVE_PRUNE_MONTHS
    ).getTime()
    let prunedArchivedSessions = 0
    for (const [sessionId, session] of nextSessionsById.entries()) {
      if (!session.userArchived) {
        continue
      }
      const archivedAt = ensureIso(session.userArchivedAt, session.updatedAt)
      if (new Date(archivedAt).getTime() >= pruneCutoff) {
        continue
      }
      nextSessionsById.delete(sessionId)
      nextMessagesBySession.delete(sessionId)
      prunedArchivedSessions += 1
    }

    this.store.sessions = [...nextSessionsById.values()]
    this.store.messages = [...nextMessagesBySession.values()].flat()
    if (artifactCache) {
      this.store.artifacts = [...artifactCache].sort((a, b) =>
        a.filePath.localeCompare(b.filePath)
      )
    }
    this.store.stars = this.reconcileStars(
      this.store.stars,
      nextSessionsById,
      nextMessagesBySession
    )
    this.rebuildDerivedState()
    this.persist()

    const archivedSessions = this.store.sessions.filter(
      session => session.missingFromLastSync
    ).length
    const result: MergeSyncResult = {
      newSessions,
      updatedSessions,
      archivedSessions,
      totalSessions: this.store.sessions.length
    }

    logInfo('Sync merge completed', {
      newSessions: result.newSessions,
      updatedSessions: result.updatedSessions,
      archivedSessions: result.archivedSessions,
      prunedArchivedSessions,
      totalSessions: result.totalSessions
    })
    return result
  }

  list(query: string): SessionSummary[] {
    const startedAt = performance.now()
    const trimmed = query.trim()
    if (!trimmed) {
      const results = [...this.familySummaryById.values()].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      logInfo('Listed sessions without query', {
        count: results.length,
        durationMs: Math.round(performance.now() - startedAt)
      })
      return results
    }

    const needle = normalize(trimmed)
    const results = [...this.familySummaryById.values()]
      .filter(session => {
        const haystack = this.searchIndexBySession.get(session.id)
        return Boolean(haystack?.includes(needle))
      })
      .map(session => {
        const matchingBranch = (
          this.familyMembersById.get(session.id) ?? [session]
        )
          .filter(member =>
            this.searchIndexByBranch.get(member.id)?.includes(needle)
          )
          .sort(
            (left, right) =>
              new Date(right.updatedAt).getTime() -
                new Date(left.updatedAt).getTime() ||
              right.messageCount - left.messageCount ||
              left.id.localeCompare(right.id)
          )[0]
        const currentBranchId = session.currentBranchId ?? session.id
        return matchingBranch && matchingBranch.id !== currentBranchId
          ? { ...session, searchMatchBranchId: matchingBranch.id }
          : session
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
    logInfo('Listed sessions with query', {
      query: trimmed,
      count: results.length,
      durationMs: Math.round(performance.now() - startedAt)
    })
    return results
  }

  getSessionDetail(
    sessionId: string,
    requestedBranchId?: string
  ): SessionDetail | null {
    const startedAt = performance.now()
    const family = this.resolveSessionFamily(sessionId, requestedBranchId)
    if (!family) {
      logWarn('Session detail not found', { sessionId, requestedBranchId })
      return null
    }

    const cacheKey = `${family.familyId}:${family.branch.id}`
    const cached = this.detailCache.get(cacheKey)
    if (cached) {
      this.detailCache.delete(cacheKey)
      this.detailCache.set(cacheKey, cached)
      logInfo('Loaded session detail from cache', {
        sessionId,
        messages: cached.messages.length,
        durationMs: Math.round(performance.now() - startedAt)
      })
      return cached
    }

    const starredMessageIds = new Set(
      family.members.flatMap(member =>
        (this.starsBySession.get(member.id) ?? [])
          .filter(star => !star.stale)
          .map(star => star.messageId)
      )
    )

    const messages = (this.messagesBySession.get(family.branch.id) ?? []).map(
      message => ({
        ...message,
        userStarred: starredMessageIds.has(message.id)
      })
    )

    const isFamily = family.branches.length > 1
    const hasAggregatedUsage =
      family.summary.tokenUsage !== family.branch.tokenUsage
    const detail: SessionDetail = {
      ...family.branch,
      familyId: isFamily ? family.familyId : undefined,
      currentBranchId: family.summary.currentBranchId,
      branchCount: family.branches.length,
      branches: isFamily ? family.branches : undefined,
      familyTokenUsage: hasAggregatedUsage
        ? family.summary.tokenUsage
        : undefined,
      messages
    }
    this.setDetailCache(cacheKey, detail)
    logInfo('Loaded session detail', {
      sessionId,
      messages: messages.length,
      durationMs: Math.round(performance.now() - startedAt)
    })
    return detail
  }

  listStarredMessages(query: string): StarredMessageSummary[] {
    const startedAt = performance.now()

    const rows: StarredMessageSummary[] = []
    const seenFamilyMessages = new Set<string>()
    for (const star of this.store.stars.map(entry =>
      normalizeStarRecord(entry)
    )) {
      const family = this.resolveSessionFamily(star.sessionId, star.sessionId)
      if (!family) {
        continue
      }
      const dedupeKey = `${family.familyId}:${star.messageId}`
      if (seenFamilyMessages.has(dedupeKey)) {
        continue
      }
      seenFamilyMessages.add(dedupeKey)
      const liveMember = family.members.find(member =>
        this.messageLookupBySession.get(member.id)?.has(star.messageId)
      )
      const liveMessage = liveMember
        ? this.messageLookupBySession.get(liveMember.id)?.get(star.messageId)
        : undefined
      rows.push({
        sessionId: family.familyId,
        branchId: liveMember?.id ?? star.sessionId,
        messageId: star.messageId,
        sessionTitle: family.summary.title,
        sessionSource: family.summary.source,
        repoPath: family.summary.repoPath,
        role: liveMessage?.role ?? star.lastKnownRole,
        content: liveMessage?.content ?? star.lastKnownContent,
        timestamp: liveMessage?.timestamp ?? star.lastKnownTimestamp,
        stale: !liveMessage || star.stale,
        starredAt: star.updatedAt
      })
    }

    const trimmed = query.trim().toLowerCase()
    const filtered = trimmed
      ? rows.filter(row =>
          [
            row.messageId,
            row.sessionTitle,
            row.repoPath,
            row.role,
            row.content,
            row.sessionSource
          ]
            .join('\n')
            .toLowerCase()
            .includes(trimmed)
        )
      : rows
    const sorted = filtered.sort(
      (a, b) =>
        new Date(b.starredAt).getTime() - new Date(a.starredAt).getTime()
    )
    logInfo('Listed starred messages', {
      query: query.trim(),
      count: sorted.length,
      durationMs: Math.round(performance.now() - startedAt)
    })
    return sorted
  }

  setArchived(sessionId: string, archived: boolean): SessionSummary | null {
    const family = this.resolveSessionFamily(sessionId)
    if (!family) {
      logWarn('Cannot set archive state: session not found', {
        sessionId,
        archived
      })
      return null
    }

    const now = new Date().toISOString()
    const memberIds = new Set(family.members.map(member => member.id))
    this.store.sessions = this.store.sessions.map(current =>
      memberIds.has(current.id)
        ? normalizeSessionSummary({
            ...current,
            userArchived: archived,
            userArchivedAt: archived ? now : undefined
          })
        : current
    )
    this.rebuildDerivedState()
    this.persist()
    logInfo('Updated session family archive state', {
      sessionId,
      familyId: family.familyId,
      branches: family.members.length,
      archived
    })
    return this.familySummaryById.get(family.familyId) ?? null
  }

  setMessageStarred(
    sessionId: string,
    messageId: string,
    starred: boolean
  ): MessageStarRecord | null {
    const family = this.resolveSessionFamily(sessionId)
    if (!family) {
      logWarn('Cannot update message star state: session not found', {
        sessionId,
        messageId,
        starred
      })
      return null
    }
    const session =
      this.sessionById.get(sessionId) ??
      family.members.find(member =>
        this.messageLookupBySession.get(member.id)?.has(messageId)
      ) ??
      family.branch

    const familySessionIds = new Set(family.members.map(member => member.id))
    const matchingIndexes = this.store.stars
      .map((entry, index) => ({ entry, index }))
      .filter(
        item =>
          familySessionIds.has(item.entry.sessionId) &&
          item.entry.messageId === messageId
      )
    const index = matchingIndexes[0]?.index ?? -1
    const now = new Date().toISOString()
    const liveSession =
      family.members.find(member =>
        this.messageLookupBySession.get(member.id)?.has(messageId)
      ) ?? session
    const liveMessage = this.messageLookupBySession
      .get(liveSession.id)
      ?.get(messageId)

    if (!starred) {
      if (index === -1) {
        return null
      }
      this.store.stars = this.store.stars.filter(
        entry =>
          !(
            familySessionIds.has(entry.sessionId) &&
            entry.messageId === messageId
          )
      )
      this.rebuildDerivedState()
      this.detailCache.delete(sessionId)
      this.persist()
      logInfo('Updated message star state', { sessionId, messageId, starred })
      return null
    }

    if (!liveMessage && index === -1) {
      logWarn('Cannot star message: message not found', {
        sessionId,
        messageId
      })
      return null
    }

    const next = normalizeStarRecord({
      sessionId: liveSession.id,
      messageId,
      createdAt: index >= 0 ? this.store.stars[index]!.createdAt : now,
      updatedAt: now,
      stale: !liveMessage,
      lastKnownRole:
        liveMessage?.role ??
        this.store.stars[index]?.lastKnownRole ??
        'assistant',
      lastKnownContent:
        liveMessage?.content ?? this.store.stars[index]?.lastKnownContent ?? '',
      lastKnownTimestamp:
        liveMessage?.timestamp ??
        this.store.stars[index]?.lastKnownTimestamp ??
        now
    })

    if (index >= 0) {
      this.store.stars = this.store.stars.filter(
        entry =>
          !(
            familySessionIds.has(entry.sessionId) &&
            entry.messageId === messageId
          )
      )
      this.store.stars.push(next)
    } else {
      this.store.stars.push(next)
    }
    this.rebuildDerivedState()
    this.detailCache.delete(sessionId)
    this.persist()
    logInfo('Updated message star state', { sessionId, messageId, starred })
    return next
  }
}

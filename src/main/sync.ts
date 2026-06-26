import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fg from 'fast-glob'
import type {
  AppConfig,
  AutoDiscoveredPatternInfo,
  SessionSource,
  SessionSummary,
  SyncResult
} from '../shared/types'
import { logError, logInfo, logWarn } from './logger'
import { loadOpenCodeSessions } from './opencode'
import { matchFixedSessionSource, parseSessionArtifacts } from './parsers'
import { isWithinRepoRoots } from './repo-roots'
import {
  SessionStorage,
  type ArtifactSyncCacheEntry,
  type SessionInsert
} from './storage'

const MAX_FILE_SIZE_BYTES = 64 * 1024 * 1024
const ARTIFACT_CACHE_PARSER_VERSION = 15

const expandHome = (value: string): string =>
  value.startsWith('~/') ? join(homedir(), value.slice(2)) : value

const unique = <T>(value: T[]): T[] => [...new Set(value)]

const autodiscoveryPatterns = [
  '**/.copilot/**/*.{json,jsonl}',
  '**/.vscode/**/*copilot*.{json,jsonl}',
  '**/.github/copilot/**/*.{json,jsonl}'
]
const artifactDiscoveryIgnore = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/release/**'
]

const normalizeGlobPath = (value: string): string => value.replace(/\\/g, '/')

export const getGlobalCopilotPattern = (
  home: string = homedir()
): string => {
  const normalizedHome = normalizeGlobPath(home)
  return `${normalizedHome}/.copilot/session-state/**/*.{json,jsonl}`
}

export const getGlobalVsCodeChatPattern = (
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  appData: string = process.env.APPDATA || home
): string => {
  const normalizedHome = normalizeGlobPath(home)
  const normalizedAppData = normalizeGlobPath(appData)

  if (platform === 'darwin') {
    return `${normalizedHome}/Library/Application Support/Code/User/workspaceStorage/*/chatSessions/*.jsonl`
  }
  if (platform === 'win32') {
    return `${normalizedAppData}/Code/User/workspaceStorage/*/chatSessions/*.jsonl`
  }
  // Linux
  return `${normalizedHome}/.config/Code/User/workspaceStorage/*/chatSessions/*.jsonl`
}

export const getGlobalClaudeCodePattern = (
  home: string = homedir()
): string => {
  const normalizedHome = normalizeGlobPath(home)
  return `${normalizedHome}/.claude/projects/**/*.jsonl`
}

const globalCopilotPattern = (() => {
  const home = homedir()
  return getGlobalCopilotPattern(home)
})()

const globalVsCodeChatPattern = (() => {
  const home = homedir()
  const appData = process.env.APPDATA || home
  return getGlobalVsCodeChatPattern(process.platform, home, appData)
})()

const globalClaudeCodePattern = (() => {
  const home = homedir()
  return getGlobalClaudeCodePattern(home)
})()

// Surfaces the same patterns syncSessions() globs below, so the Settings UI
// can show users what's already covered without them re-deriving it via
// explicitPatterns. Built from the same generator functions (and the same
// default args) as the globalXPattern constants above, so it can't drift
// from what's actually scanned.
export const getAutoDiscoveredPatterns = (
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  appData: string = process.env.APPDATA || home
): AutoDiscoveredPatternInfo[] => [
  { label: 'Copilot CLI session history', pattern: getGlobalCopilotPattern(home) },
  {
    label: 'VS Code Copilot Chat sessions',
    pattern: getGlobalVsCodeChatPattern(platform, home, appData)
  },
  { label: 'Claude Code sessions', pattern: getGlobalClaudeCodePattern(home) }
]

const COPILOT_SESSION_STORE_DB_PATH = join(
  homedir(),
  '.copilot',
  'session-store.db'
)
const COPILOT_CHAT_CWD = resolve(homedir(), '.copilot', 'chats')

const workspaceRepoCache = new Map<string, string | null>()

const normalizePathForComparison = (value: string): string =>
  resolve(expandHome(value)).replace(/\\/g, '/')

const isCopilotChatCwd = (value: string): boolean => {
  const normalizedValue = normalizePathForComparison(value)
  const normalizedChatRoot = normalizePathForComparison(COPILOT_CHAT_CWD)
  return (
    normalizedValue === normalizedChatRoot ||
    normalizedValue.startsWith(`${normalizedChatRoot}/`)
  )
}

const shouldIncludeArtifact = (
  artifact: SessionInsert,
  repoRoots: string[]
): boolean => {
  if (isWithinRepoRoots(artifact.session.repoPath, repoRoots)) {
    return true
  }
  return artifact.session.source === 'cli' && isCopilotChatCwd(artifact.session.repoPath)
}

const repoRootFromVsCodeWorkspaceStorage = async (
  filePath: string
): Promise<string | null> => {
  const normalized = filePath.replaceAll('\\', '/')
  const marker = '/workspaceStorage/'
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex === -1) {
    return null
  }

  const rest = normalized.slice(markerIndex + marker.length)
  const workspaceId = rest.split('/')[0]
  if (!workspaceId) {
    return null
  }
  if (workspaceRepoCache.has(workspaceId)) {
    return workspaceRepoCache.get(workspaceId) ?? null
  }

  const workspaceJsonPath =
    normalized.slice(0, markerIndex + marker.length) +
    `${workspaceId}/workspace.json`
  try {
    const raw = await fs.readFile(workspaceJsonPath, 'utf8')
    const parsed = JSON.parse(raw) as { folder?: unknown; configPath?: unknown }
    const folder = typeof parsed.folder === 'string' ? parsed.folder : null
    const configPath =
      typeof parsed.configPath === 'string' ? parsed.configPath : null

    if (folder?.startsWith('file://')) {
      const repoPath = fileURLToPath(folder)
      workspaceRepoCache.set(workspaceId, repoPath)
      return repoPath
    }

    if (configPath?.startsWith('file://')) {
      const pathFromConfig = fileURLToPath(configPath)
      const repoPath = pathFromConfig.replace(/\/[^/]+\.code-workspace$/, '')
      workspaceRepoCache.set(workspaceId, repoPath || null)
      return repoPath || null
    }
  } catch {
    workspaceRepoCache.set(workspaceId, null)
    return null
  }

  workspaceRepoCache.set(workspaceId, null)
  return null
}

const buildSearchPatterns = (config: AppConfig): string[] => {
  if (config.discoveryMode === 'autodiscovery') {
    return autodiscoveryPatterns
  }

  if (config.discoveryMode === 'explicit') {
    return config.explicitPatterns
  }

  return unique([...autodiscoveryPatterns, ...config.explicitPatterns])
}

interface CliSessionSummaryRow {
  id: string
  summary: string
}

const detectSourceFromFilePath = (filePath: string): SessionSource => {
  const fixedSource = matchFixedSessionSource(filePath)
  if (fixedSource) {
    return fixedSource
  }
  const normalized = filePath.toLowerCase()
  if (normalized.includes('chatsessions') || normalized.includes('vscode')) {
    return 'vscode'
  }
  return 'cli'
}

const cliSummaryToken = (
  cliSummaryBySessionId: Map<string, string>
): string => {
  if (cliSummaryBySessionId.size === 0) {
    return ''
  }
  const hash = createHash('sha1')
  for (const [sessionId, summary] of [...cliSummaryBySessionId.entries()].sort(
    (a, b) => a[0].localeCompare(b[0])
  )) {
    hash.update(sessionId)
    hash.update('\u0000')
    hash.update(summary)
    hash.update('\n')
  }
  return hash.digest('hex')
}

const loadCliSessionSummaryMap = async (): Promise<Map<string, string>> => {
  const summaries = new Map<string, string>()
  if (
    !(await fs
      .stat(COPILOT_SESSION_STORE_DB_PATH)
      .then(() => true)
      .catch(() => false))
  ) {
    return summaries
  }

  let DatabaseSyncClass: typeof import('node:sqlite').DatabaseSync
  try {
    const sqliteModule = await import('node:sqlite')
    DatabaseSyncClass = sqliteModule.DatabaseSync
  } catch (error) {
    logWarn('CLI summary lookup skipped: node:sqlite unavailable', {
      reason: (error as Error).message
    })
    return summaries
  }

  const database = new DatabaseSyncClass(COPILOT_SESSION_STORE_DB_PATH)
  try {
    const rows = database
      .prepare(
        `SELECT id, summary
         FROM sessions
         WHERE summary IS NOT NULL
           AND TRIM(summary) != ''`
      )
      .all() as unknown as CliSessionSummaryRow[]
    for (const row of rows) {
      const cleaned = row.summary.replace(/\s+/g, ' ').trim()
      if (cleaned) {
        summaries.set(row.id, cleaned)
      }
    }
    logInfo('Loaded CLI session summaries', { count: summaries.size })
  } catch (error) {
    logWarn('Failed loading CLI session summaries', {
      dbPath: COPILOT_SESSION_STORE_DB_PATH,
      reason: (error as Error).message
    })
  } finally {
    database.close()
  }

  return summaries
}

export const syncSessions = async (
  config: AppConfig,
  storage: SessionStorage
): Promise<SyncResult> => {
  const syncStartedAt = performance.now()
  const repoRoots = unique(
    config.repoRoots.map(expandHome).map(value => resolve(value))
  )
  const patterns = buildSearchPatterns(config)
  const cliSummaryBySessionId = await loadCliSessionSummaryMap()
  const summaryToken = cliSummaryToken(cliSummaryBySessionId)
  const previousArtifactCache = storage.getArtifactSyncCache()
  const nextArtifactCacheByPath = new Map<string, ArtifactSyncCacheEntry>()
  logInfo('Starting sync', {
    repoRoots: repoRoots.length,
    discoveryMode: config.discoveryMode,
    patterns: patterns.length,
    cliSummaries: cliSummaryBySessionId.size,
    cachedArtifacts: previousArtifactCache.size
  })

  const result: SyncResult = {
    filesScanned: 0,
    sessionsImported: 0,
    skippedFiles: 0,
    durationSeconds: 0,
    errors: []
  }

  const files = new Set<string>()
  const scanStartedAt = performance.now()

  const [repoRootEntries, globalEntries, globalVsCodeEntries, globalClaudeCodeEntries] =
    await Promise.all([
      Promise.all(
        repoRoots.map(async root => {
          try {
            const stat = await fs.stat(root)
            if (!stat.isDirectory()) {
              logWarn('Configured repo root is not a directory, skipping', {
                root
              })
              return []
            }
          } catch (error) {
            logWarn('Configured repo root does not exist, skipping', {
              root,
              reason: (error as Error).message
            })
            return []
          }

          const rootEntries = await fg(patterns, {
            cwd: root,
            absolute: true,
            onlyFiles: true,
            suppressErrors: true,
            unique: true,
            ignore: artifactDiscoveryIgnore
          })
          logInfo('Scanned repo root', { root, filesFound: rootEntries.length })
          return rootEntries
        })
      ),
      fg(globalCopilotPattern, {
        absolute: true,
        onlyFiles: true,
        suppressErrors: true,
        unique: true,
        ignore: ['**/node_modules/**', '**/.git/**']
      }),
      fg(globalVsCodeChatPattern, {
        absolute: true,
        onlyFiles: true,
        suppressErrors: true,
        unique: true
      }),
      fg(globalClaudeCodePattern, {
        absolute: true,
        onlyFiles: true,
        suppressErrors: true,
        unique: true
      })
    ])

  for (const rootEntries of repoRootEntries) {
    for (const entry of rootEntries) {
      files.add(entry)
    }
  }

  logInfo('Scanned global copilot session path', {
    filesFound: globalEntries.length,
    pattern: globalCopilotPattern
  })
  for (const entry of globalEntries) {
    files.add(entry)
  }

  logInfo('Scanned VS Code workspace chat sessions', {
    filesFound: globalVsCodeEntries.length,
    pattern: globalVsCodeChatPattern
  })
  for (const entry of globalVsCodeEntries) {
    files.add(entry)
  }

  logInfo('Scanned global Claude Code session path', {
    filesFound: globalClaudeCodeEntries.length,
    pattern: globalClaudeCodePattern
  })
  for (const entry of globalClaudeCodeEntries) {
    files.add(entry)
  }
  const scanDurationMs = Math.round(performance.now() - scanStartedAt)

  const inserts: SessionInsert[] = []
  let ignoredByRepoFilter = 0
  let skippedUnchanged = 0
  let parsedFiles = 0
  const parseStartedAt = performance.now()

  for (const filePath of files) {
    result.filesScanned += 1

    try {
      const stat = await fs.stat(filePath)
      if (stat.size > MAX_FILE_SIZE_BYTES) {
        result.skippedFiles += 1
        logWarn('Skipping artifact file above size limit', {
          filePath,
          fileSizeBytes: stat.size,
          limitBytes: MAX_FILE_SIZE_BYTES
        })
        continue
      }

      const repoRootFromWorkspace =
        await repoRootFromVsCodeWorkspaceStorage(filePath)
      const repoRoot =
        repoRootFromWorkspace ??
        repoRoots.find(root => filePath.startsWith(root)) ??
        repoRoots.find(root =>
          filePath.includes(root.split('/').at(-1) ?? '')
        ) ??
        filePath
      const source = detectSourceFromFilePath(filePath)
      const cacheToken = source === 'cli' ? summaryToken : ''
      const cached = previousArtifactCache.get(filePath)
      const unchanged = Boolean(
        cached &&
        cached.mtimeMs === stat.mtimeMs &&
        cached.size === stat.size &&
        cached.repoRoot === repoRoot &&
        cached.source === source &&
        cached.cliSummaryToken === cacheToken &&
        cached.parserVersion === ARTIFACT_CACHE_PARSER_VERSION
      )
      if (unchanged && cached) {
        skippedUnchanged += 1
        nextArtifactCacheByPath.set(filePath, cached)
        for (const artifact of cached.inserts) {
          if (!shouldIncludeArtifact(artifact, repoRoots)) {
            ignoredByRepoFilter += 1
            continue
          }
          inserts.push(artifact)
        }
        continue
      }

      const raw = await fs.readFile(filePath, 'utf8')
      const parsed = parseSessionArtifacts(raw, {
        filePath,
        repoRoot,
        source,
        cliSummaryBySessionId
      })
      parsedFiles += 1
      logInfo('Parsed session artifact file', {
        filePath,
        sessionsFound: parsed.length
      })

      for (const artifact of parsed) {
        if (!shouldIncludeArtifact(artifact, repoRoots)) {
          ignoredByRepoFilter += 1
          continue
        }
        inserts.push(artifact)
      }
      nextArtifactCacheByPath.set(filePath, {
        filePath,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        repoRoot,
        source,
        cliSummaryToken: cacheToken,
        parserVersion: ARTIFACT_CACHE_PARSER_VERSION,
        inserts: parsed
      })
    } catch (error) {
      logError('Failed processing artifact file', {
        filePath,
        reason: (error as Error).message
      })
      result.errors.push(`${filePath}: ${(error as Error).message}`)
    }
  }

  const openCodeSessions = await loadOpenCodeSessions(repoRoots)
  if (openCodeSessions.length > 0) {
    inserts.push(...openCodeSessions)
  }
  const parseDurationMs = Math.round(performance.now() - parseStartedAt)

  const dedupeStartedAt = performance.now()
  const dedupedById = new Map<string, SessionInsert>()
  for (const insert of inserts) {
    const current = dedupedById.get(insert.session.id)
    if (
      !current ||
      new Date(insert.session.updatedAt) > new Date(current.session.updatedAt)
    ) {
      dedupedById.set(insert.session.id, insert)
    }
  }

  const finalInserts = [...dedupedById.values()].sort((a, b) => {
    return (
      new Date(b.session.updatedAt).getTime() -
      new Date(a.session.updatedAt).getTime()
    )
  })
  const dedupeDurationMs = Math.round(performance.now() - dedupeStartedAt)

  const mergeStartedAt = performance.now()
  const mergeResult = storage.mergeFromSync(
    finalInserts,
    new Date().toISOString(),
    [...nextArtifactCacheByPath.values()]
  )
  const mergeDurationMs = Math.round(performance.now() - mergeStartedAt)
  result.sessionsImported = finalInserts.length

  if (result.errors.length > 20) {
    result.errors = result.errors.slice(0, 20)
  }

  result.durationSeconds = Math.max(
    1,
    Math.round((performance.now() - syncStartedAt) / 1000)
  )

  const totalDurationMs = Math.round(performance.now() - syncStartedAt)

  logInfo('Sync completed', {
    durationMs: totalDurationMs,
    durationSeconds: result.durationSeconds,
    scanDurationMs,
    parseDurationMs,
    dedupeDurationMs,
    mergeDurationMs,
    filesScanned: result.filesScanned,
    sessionsImported: result.sessionsImported,
    totalSessionsRetained: mergeResult.totalSessions,
    newlyDiscovered: mergeResult.newSessions,
    updatedExisting: mergeResult.updatedSessions,
    archivedSessions: mergeResult.archivedSessions,
    skippedFiles: result.skippedFiles,
    skippedUnchanged,
    parsedFiles,
    ignoredByRepoFilter,
    errors: result.errors.length,
    cachedArtifacts: nextArtifactCacheByPath.size
  })

  return result
}

export const getSessionOpenTargets = (
  session: SessionSummary
): { vscodeTarget: string; cliCwd: string } => ({
  vscodeTarget: session.openVscodeTarget || session.filePath,
  cliCwd: session.openCliCwd || session.repoPath
})

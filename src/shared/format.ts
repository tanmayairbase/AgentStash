import type { SessionSource } from './types'

export const formatTimestampIST = (isoLike: string): string => {
  const date = new Date(isoLike)
  if (Number.isNaN(date.getTime())) {
    return isoLike
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date)

  const map = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${map.month} ${map.day}, ${map.year} ${map.hour}:${map.minute} IST`
}

export const formatMinuteKeyIST = (isoLike: string): string => {
  const date = new Date(isoLike)
  if (Number.isNaN(date.getTime())) {
    return isoLike
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date)

  const map = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`
}

export type DateFilterPreset =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last14'
  | 'last30'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

const istDayIndex = (value: Date): number =>
  Math.floor((value.getTime() + IST_OFFSET_MS) / MS_PER_DAY)

export const matchesIstDatePreset = (
  isoLike: string,
  preset: DateFilterPreset,
  now: Date = new Date()
): boolean => {
  const date = new Date(isoLike)
  if (Number.isNaN(date.getTime())) {
    return false
  }

  const nowDay = istDayIndex(now)
  const targetDay = istDayIndex(date)

  if (preset === 'today') {
    return targetDay === nowDay
  }
  if (preset === 'yesterday') {
    return targetDay === nowDay - 1
  }
  if (preset === 'last7') {
    return targetDay >= nowDay - 6 && targetDay <= nowDay
  }
  if (preset === 'last14') {
    return targetDay >= nowDay - 13 && targetDay <= nowDay
  }
  return targetDay >= nowDay - 29 && targetDay <= nowDay
}

export const toTildePath = (pathLike: string): string => {
  if (/^\/Users\/[^/]+/.test(pathLike)) {
    return pathLike.replace(/^\/Users\/[^/]+/, '~')
  }
  if (/^\/home\/[^/]+/.test(pathLike)) {
    return pathLike.replace(/^\/home\/[^/]+/, '~')
  }
  if (/^[A-Za-z]:\\Users\\[^\\]+/.test(pathLike)) {
    return pathLike.replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~')
  }
  return pathLike
}

export const toSearchPreview = (value: string, maxLength = 120): string => {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, maxLength - 1)}…`
}

export const normalizeModelLabel = (
  value: string | null | undefined
): string => {
  const trimmed = (value ?? '').trim()
  if (!trimmed) {
    return ''
  }
  return trimmed.replace(/^copilot\//i, '')
}

export const formatSessionOrigin = (origin: SessionSource): string => {
  if (origin === 'vscode') {
    return 'VS Code'
  }
  if (origin === 'opencode') {
    return 'OpenCode'
  }
  return 'CLI'
}

export const formatAgentName = (source: SessionSource): string => {
  if (source === 'claude') {
    return 'Claude Code'
  }
  return 'Copilot'
}

export const matchesRepositoryFilter = (
  sessionRepoPath: string,
  selectedRepoPaths: string[]
): boolean => {
  if (selectedRepoPaths.length === 0) {
    return true
  }
  return selectedRepoPaths.includes(sessionRepoPath)
}

import type {
  ClaudeUsageEvent,
  ModelTokenUsage,
  SessionBranchSummary,
  SessionMessage,
  SessionSummary,
  SessionTokenUsage
} from '../shared/types'
import { sumModelTotals, ZERO_TOTALS } from './parsers/helpers'

export interface SessionFamilyIndex {
  summaries: SessionSummary[]
  membersByFamilyId: Map<string, SessionSummary[]>
  familyIdBySessionId: Map<string, string>
  branchesByFamilyId: Map<string, SessionBranchSummary[]>
}

const compareNewest = (left: SessionSummary, right: SessionSummary): number =>
  new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() ||
  right.messageCount - left.messageCount ||
  left.id.localeCompare(right.id)

const compareOldest = (left: SessionSummary, right: SessionSummary): number =>
  new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() ||
  left.id.localeCompare(right.id)

const aggregateUsageEvents = (
  sessions: SessionSummary[]
): SessionTokenUsage | undefined => {
  const eventsById = new Map<string, ClaudeUsageEvent>()
  const usageMagnitude = (event: ClaudeUsageEvent): number =>
    event.inputTokens +
    event.cachedInputTokens +
    event.cacheWriteTokens +
    event.cacheWrite1hTokens +
    event.outputTokens +
    event.reasoningTokens
  for (const session of sessions) {
    for (const event of session.claudeUsageEvents ?? []) {
      const existing = eventsById.get(event.id)
      if (
        !existing ||
        (event.timestamp ?? '').localeCompare(existing.timestamp ?? '') > 0 ||
        ((event.timestamp ?? '') === (existing.timestamp ?? '') &&
          usageMagnitude(event) > usageMagnitude(existing))
      ) {
        eventsById.set(event.id, event)
      }
    }
  }

  if (eventsById.size === 0) {
    return sessions.slice().sort(compareNewest)[0]?.tokenUsage
  }

  const byModelMap = new Map<string, ModelTokenUsage>()
  for (const event of eventsById.values()) {
    const current = byModelMap.get(event.modelId) ?? {
      modelId: event.modelId,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0
    }
    current.inputTokens += event.inputTokens
    current.cachedInputTokens += event.cachedInputTokens
    current.cacheWriteTokens += event.cacheWriteTokens
    current.cacheWrite1hTokens += event.cacheWrite1hTokens
    current.outputTokens += event.outputTokens
    current.reasoningTokens += event.reasoningTokens
    byModelMap.set(event.modelId, current)
  }

  const byModel = [...byModelMap.values()]
  return {
    source: 'claude-messages',
    byModel,
    totals: byModel.length > 0 ? sumModelTotals(byModel) : { ...ZERO_TOTALS }
  }
}

const buildBranchSummaries = (
  members: SessionSummary[],
  messagesBySession: ReadonlyMap<string, SessionMessage[]>,
  currentBranchId: string
): SessionBranchSummary[] => {
  const messageOccurrences = new Map<string, number>()
  for (const member of members) {
    for (const message of messagesBySession.get(member.id) ?? []) {
      messageOccurrences.set(
        message.id,
        (messageOccurrences.get(message.id) ?? 0) + 1
      )
    }
  }

  return members
    .slice()
    .sort(compareNewest)
    .map(member => {
      const divergencePrompt = (messagesBySession.get(member.id) ?? []).find(
        message =>
          message.role === 'user' && messageOccurrences.get(message.id) === 1
      )?.content
      return {
        id: member.id,
        title: member.title,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
        messageCount: member.messageCount,
        divergencePrompt,
        tokenUsage: member.tokenUsage,
        isCurrent: member.id === currentBranchId
      }
    })
}

export const buildSessionFamilyIndex = (
  sessions: SessionSummary[],
  messagesBySession: ReadonlyMap<string, SessionMessage[]>
): SessionFamilyIndex => {
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    const current = parent.get(id) ?? id
    if (current === id) {
      parent.set(id, id)
      return id
    }
    const root = find(current)
    parent.set(id, root)
    return root
  }
  const union = (left: string, right: string): void => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) {
      parent.set(rightRoot, leftRoot)
    }
  }

  const claudeCandidates = sessions.filter(
    session => session.source === 'claude' && !session.isSubagentSession
  )
  const lineageOwners = new Map<string, string>()
  for (const session of claudeCandidates) {
    parent.set(session.id, session.id)
    const lineageIds =
      session.lineageMessageIds ??
      (messagesBySession.get(session.id) ?? []).map(message => message.id)
    for (const messageId of lineageIds) {
      const owner = lineageOwners.get(messageId)
      if (owner) {
        union(session.id, owner)
      } else {
        lineageOwners.set(messageId, session.id)
      }
    }
  }
  for (const session of claudeCandidates) {
    for (const parentMessageId of session.lineageParentMessageIds ?? []) {
      const owner = lineageOwners.get(parentMessageId)
      if (owner) {
        union(session.id, owner)
      }
    }
  }

  const grouped = new Map<string, SessionSummary[]>()
  for (const session of sessions) {
    const groupKey =
      session.source === 'claude' && !session.isSubagentSession
        ? `claude:${find(session.id)}`
        : `session:${session.id}`
    const members = grouped.get(groupKey) ?? []
    members.push(session)
    grouped.set(groupKey, members)
  }

  const summaries: SessionSummary[] = []
  const membersByFamilyId = new Map<string, SessionSummary[]>()
  const familyIdBySessionId = new Map<string, string>()
  const branchesByFamilyId = new Map<string, SessionBranchSummary[]>()

  for (const members of grouped.values()) {
    const current = members.slice().sort(compareNewest)[0]!
    const familyId =
      members.length > 1
        ? members.slice().sort(compareOldest)[0]!.id
        : current.id
    const branches = buildBranchSummaries(
      members,
      messagesBySession,
      current.id
    )
    const isFamily = members.length > 1
    const familyUsage = isFamily
      ? aggregateUsageEvents(members)
      : current.tokenUsage
    const summary: SessionSummary = isFamily
      ? {
          ...current,
          id: familyId,
          familyId,
          currentBranchId: current.id,
          branchCount: members.length,
          createdAt: members
            .map(member => member.createdAt)
            .sort((left, right) => left.localeCompare(right))[0]!,
          updatedAt: current.updatedAt,
          userArchived: members.every(member => member.userArchived),
          userArchivedAt: members
            .map(member => member.userArchivedAt)
            .filter((value): value is string => Boolean(value))
            .sort()
            .at(-1),
          missingFromLastSync: members.every(
            member => member.missingFromLastSync
          ),
          tokenUsage: familyUsage
        }
      : current

    summaries.push(summary)
    membersByFamilyId.set(familyId, members)
    branchesByFamilyId.set(familyId, branches)
    for (const member of members) {
      familyIdBySessionId.set(member.id, familyId)
    }
  }

  return {
    summaries,
    membersByFamilyId,
    familyIdBySessionId,
    branchesByFamilyId
  }
}

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { SessionInsert } from '../src/main/storage'
import { SessionStorage } from '../src/main/storage'
import type {
  ClaudeUsageEvent,
  SessionMessage,
  SessionSummary
} from '../src/shared/types'

const usageEvent = (id: string, inputTokens: number): ClaudeUsageEvent => ({
  id,
  modelId: 'claude-sonnet-4-6',
  inputTokens,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite1hTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0
})

const insert = (
  id: string,
  createdAt: string,
  updatedAt: string,
  lineageMessageIds: string[],
  messages: SessionMessage[],
  claudeUsageEvents: ClaudeUsageEvent[]
): SessionInsert => {
  const session: SessionSummary = {
    id,
    source: 'claude',
    repoPath: '/repos/example',
    title: 'Shared conversation title',
    model: 'claude-sonnet-4-6',
    createdAt,
    updatedAt,
    messageCount: messages.length,
    filePath: `/tmp/${id}.jsonl`,
    openVscodeTarget: `/tmp/${id}.jsonl`,
    openCliCwd: '/repos/example',
    lineageMessageIds,
    lineageParentMessageIds: lineageMessageIds.includes('shared-message')
      ? ['shared-message']
      : [],
    claudeUsageEvents,
    tokenUsage: {
      source: 'claude-messages',
      byModel: [
        {
          modelId: 'claude-sonnet-4-6',
          inputTokens: claudeUsageEvents.reduce(
            (sum, event) => sum + event.inputTokens,
            0
          ),
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          cacheWrite1hTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0
        }
      ],
      totals: {
        inputTokens: claudeUsageEvents.reduce(
          (sum, event) => sum + event.inputTokens,
          0
        ),
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        cacheWrite1hTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0
      }
    }
  }
  return { session, messages }
}

describe('Claude session families', () => {
  it('groups file-backed branches, routes search, deduplicates usage, archive, and stars', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'agentstash-families-'))
    const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))
    const sharedMessage: SessionMessage = {
      id: 'shared-message',
      sessionId: 'branch-old',
      role: 'assistant',
      content: 'Shared answer',
      format: 'text',
      timestamp: '2026-07-24T10:01:00.000Z'
    }
    const oldBranch = insert(
      'branch-old',
      '2026-07-24T10:00:00.000Z',
      '2026-07-24T10:05:00.000Z',
      ['shared-message', 'old-prompt'],
      [
        sharedMessage,
        {
          id: 'old-prompt',
          sessionId: 'branch-old',
          role: 'user',
          content: 'Older branch only prompt',
          format: 'text',
          timestamp: '2026-07-24T10:05:00.000Z'
        }
      ],
      [usageEvent('api-shared', 10), usageEvent('api-old', 20)]
    )
    const newBranch = insert(
      'branch-new',
      '2026-07-24T10:00:00.000Z',
      '2026-07-24T10:20:00.000Z',
      ['shared-message', 'new-prompt'],
      [
        { ...sharedMessage, sessionId: 'branch-new' },
        {
          id: 'new-prompt',
          sessionId: 'branch-new',
          role: 'user',
          content: 'Newest branch prompt',
          format: 'text',
          timestamp: '2026-07-24T10:20:00.000Z'
        }
      ],
      [usageEvent('api-shared', 10), usageEvent('api-new', 30)]
    )
    const independent = insert(
      'independent',
      '2026-07-24T09:00:00.000Z',
      '2026-07-24T09:30:00.000Z',
      ['independent-message'],
      [
        {
          id: 'independent-message',
          sessionId: 'independent',
          role: 'user',
          content: 'Independent conversation',
          format: 'text',
          timestamp: '2026-07-24T09:30:00.000Z'
        }
      ],
      [usageEvent('api-independent', 5)]
    )

    storage.mergeFromSync(
      [oldBranch, newBranch, independent],
      '2026-07-24T11:00:00.000Z'
    )

    const listed = storage.list('')
    expect(listed).toHaveLength(2)
    const family = listed.find(session => session.branchCount === 2)
    expect(family).toMatchObject({
      currentBranchId: 'branch-new',
      branchCount: 2,
      messageCount: 2
    })
    expect(family?.tokenUsage?.totals.inputTokens).toBe(60)

    const search = storage.list('Older branch only')
    expect(search).toHaveLength(1)
    expect(search[0]).toMatchObject({
      id: family?.id,
      searchMatchBranchId: 'branch-old'
    })

    const currentDetail = storage.getSessionDetail(family!.id)
    expect(currentDetail?.id).toBe('branch-new')
    expect(currentDetail?.branches).toHaveLength(2)
    expect(currentDetail?.familyTokenUsage?.totals.inputTokens).toBe(60)
    expect(storage.getSessionDetail(family!.id, 'branch-old')?.id).toBe(
      'branch-old'
    )
    expect(storage.getSessionDetail(family!.id, 'independent')?.id).toBe(
      'branch-new'
    )

    storage.setMessageStarred(family!.id, 'shared-message', true)
    expect(
      storage
        .getSessionDetail(family!.id, 'branch-new')
        ?.messages.find(message => message.id === 'shared-message')?.userStarred
    ).toBe(true)
    expect(storage.listStarredMessages('')).toHaveLength(1)

    storage.setArchived(family!.id, true)
    expect(
      storage.list('').find(session => session.id === family!.id)
    ).toMatchObject({
      userArchived: true
    })
    expect(
      storage.getSessionDetail(family!.id, 'branch-new')?.userArchived
    ).toBe(true)
  })

  it('includes file-backed subagent usage in its parent conversation total', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'agentstash-subagent-'))
    const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))
    const parent = insert(
      'parent-session',
      '2026-07-24T10:00:00.000Z',
      '2026-07-24T10:05:00.000Z',
      ['parent-message'],
      [
        {
          id: 'parent-message',
          sessionId: 'parent-session',
          role: 'user',
          content: 'Investigate the issue',
          format: 'text',
          timestamp: '2026-07-24T10:00:00.000Z'
        }
      ],
      [usageEvent('parent-api-call', 10)]
    )
    const subagent = insert(
      'subagent-session',
      '2026-07-24T10:01:00.000Z',
      '2026-07-24T10:04:00.000Z',
      ['subagent-message'],
      [
        {
          id: 'subagent-message',
          sessionId: 'subagent-session',
          role: 'assistant',
          content: 'Investigation complete',
          format: 'text',
          timestamp: '2026-07-24T10:04:00.000Z'
        }
      ],
      [usageEvent('subagent-api-call', 20)]
    )
    subagent.session.isSubagentSession = true
    subagent.session.parentSessionId = parent.session.id

    storage.mergeFromSync([parent, subagent], '2026-07-24T11:00:00.000Z')

    const listed = storage.list('')
    expect(listed).toHaveLength(2)
    expect(listed.find(session => session.id === parent.session.id)?.tokenUsage?.totals.inputTokens).toBe(30)

    const detail = storage.getSessionDetail(parent.session.id)
    expect(detail?.tokenUsage?.totals.inputTokens).toBe(10)
    expect(detail?.familyTokenUsage?.totals.inputTokens).toBe(30)
  })
})

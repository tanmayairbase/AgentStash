import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig, SessionSource } from '../src/shared/types'
import { SessionStorage } from '../src/main/storage'

const { fgMock, parseSessionArtifactsMock, loadOpenCodeSessionsMock } =
  vi.hoisted(() => ({
    fgMock: vi.fn(),
    parseSessionArtifactsMock: vi.fn(),
    loadOpenCodeSessionsMock: vi.fn()
  }))

vi.mock('fast-glob', () => ({
  default: fgMock
}))

vi.mock('../src/main/parsers', () => ({
  parseSessionArtifacts: parseSessionArtifactsMock
}))

vi.mock('../src/main/opencode', () => ({
  loadOpenCodeSessions: loadOpenCodeSessionsMock
}))

import { syncSessions } from '../src/main/sync'

interface TestArtifactPayload {
  id: string
  updatedAt: string
  message: string
}

const buildConfig = (repoRoot: string): AppConfig => ({
  repoRoots: [repoRoot],
  discoveryMode: 'explicit',
  explicitPatterns: ['**/*.jsonl'],
  appearance: 'system',
  syncMode: 'manual',
  backgroundSyncIntervalMinutes: 10
})

const writeArtifact = async (
  filePath: string,
  payload: TestArtifactPayload
): Promise<void> => {
  await fs.mkdir(dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(payload), 'utf8')
}

describe('syncSessions incremental parsing', () => {
  beforeEach(() => {
    fgMock.mockReset()
    parseSessionArtifactsMock.mockReset()
    loadOpenCodeSessionsMock.mockReset()
    loadOpenCodeSessionsMock.mockResolvedValue([])
  })

  it('reuses cached parse output for unchanged files and reparses on change', async () => {
    const tempDir = await fs.mkdtemp(
      join(tmpdir(), 'copilot-sync-incremental-')
    )
    const repoRoot = join(tempDir, 'repo')
    const artifactPath = join(
      repoRoot,
      '.vscode',
      'chatSessions',
      'workspace-chat-1.jsonl'
    )
    const discoveredFiles = new Set<string>([artifactPath])
    const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))

    fgMock.mockImplementation(
      async (_patterns: unknown, options?: { cwd?: string }) => {
        if (options?.cwd === repoRoot) {
          return [...discoveredFiles]
        }
        return []
      }
    )

    parseSessionArtifactsMock.mockImplementation(
      (
        raw: string,
        context: {
          filePath: string
          repoRoot: string
          source: SessionSource
        }
      ) => {
        const payload = JSON.parse(raw) as TestArtifactPayload
        return [
          {
            session: {
              id: payload.id,
              source: context.source,
              repoPath: context.repoRoot,
              title: payload.message.slice(0, 120),
              model: 'gpt-5.3-codex',
              createdAt: payload.updatedAt,
              updatedAt: payload.updatedAt,
              messageCount: 2,
              filePath: context.filePath,
              openVscodeTarget: context.filePath,
              openCliCwd: context.repoRoot
            },
            messages: [
              {
                id: `${payload.id}-u1`,
                sessionId: payload.id,
                role: 'user' as const,
                content: payload.message,
                format: 'text' as const,
                timestamp: payload.updatedAt
              },
              {
                id: `${payload.id}-a1`,
                sessionId: payload.id,
                role: 'assistant' as const,
                content: `response:${payload.message}`,
                format: 'text' as const,
                timestamp: payload.updatedAt
              }
            ]
          }
        ]
      }
    )

    await writeArtifact(artifactPath, {
      id: 'session-incremental-1',
      updatedAt: '2026-03-20T10:00:00.000Z',
      message: 'first message'
    })

    const first = await syncSessions(buildConfig(repoRoot), storage)
    expect(first.filesScanned).toBe(1)
    expect(first.sessionsImported).toBe(1)
    expect(parseSessionArtifactsMock).toHaveBeenCalledTimes(1)
    expect(
      storage.list('').find(row => row.id === 'session-incremental-1')
        ?.missingFromLastSync
    ).toBe(false)

    const second = await syncSessions(buildConfig(repoRoot), storage)
    expect(second.filesScanned).toBe(1)
    expect(second.sessionsImported).toBe(1)
    expect(parseSessionArtifactsMock).toHaveBeenCalledTimes(1)

    await writeArtifact(artifactPath, {
      id: 'session-incremental-1',
      updatedAt: '2026-03-21T10:00:00.000Z',
      message: 'changed message'
    })
    const bumpedMtime = new Date(Date.now() + 5000)
    await fs.utimes(artifactPath, bumpedMtime, bumpedMtime)

    const third = await syncSessions(buildConfig(repoRoot), storage)
    expect(third.filesScanned).toBe(1)
    expect(third.sessionsImported).toBe(1)
    expect(parseSessionArtifactsMock).toHaveBeenCalledTimes(2)
    expect(
      storage.getSessionDetail('session-incremental-1')?.messages[0]?.content
    ).toBe('changed message')

    discoveredFiles.delete(artifactPath)
    const fourth = await syncSessions(buildConfig(repoRoot), storage)
    expect(fourth.filesScanned).toBe(0)
    expect(parseSessionArtifactsMock).toHaveBeenCalledTimes(2)

    const archived = storage
      .list('')
      .find(row => row.id === 'session-incremental-1')
    expect(archived?.missingFromLastSync).toBe(true)
    expect(
      storage.getSessionDetail('session-incremental-1')?.messages
    ).toHaveLength(2)
  })

  it('keeps Copilot app general chats even when cwd is outside repo roots', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'copilot-sync-chat-'))
    const repoRoot = join(tempDir, 'repo')
    const chatArtifactPath = join(
      tempDir,
      'home',
      '.copilot',
      'session-state',
      'general-chat-1',
      'events.jsonl'
    )
    const chatCwd = join(
      tempDir,
      'home',
      '.copilot',
      'chats',
      'scratch-chat-1'
    )
    const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))

    fgMock.mockImplementation(
      async (patterns: unknown, options?: { cwd?: string }) => {
        if (options?.cwd === repoRoot) {
          return []
        }
        if (
          typeof patterns === 'string' &&
          patterns.includes('/.copilot/session-state/')
        ) {
          return [chatArtifactPath]
        }
        return []
      }
    )

    parseSessionArtifactsMock.mockImplementation(
      (
        raw: string,
        context: {
          filePath: string
          repoRoot: string
          source: SessionSource
        }
      ) => {
        const payload = JSON.parse(raw) as TestArtifactPayload
        return [
          {
            session: {
              id: payload.id,
              source: context.source,
              repoPath: chatCwd,
              title: payload.message.slice(0, 120),
              model: 'gpt-5.4',
              createdAt: payload.updatedAt,
              updatedAt: payload.updatedAt,
              messageCount: 2,
              filePath: context.filePath,
              openVscodeTarget: context.filePath,
              openCliCwd: chatCwd
            },
            messages: [
              {
                id: `${payload.id}-u1`,
                sessionId: payload.id,
                role: 'user' as const,
                content: payload.message,
                format: 'text' as const,
                timestamp: payload.updatedAt
              },
              {
                id: `${payload.id}-a1`,
                sessionId: payload.id,
                role: 'assistant' as const,
                content: `response:${payload.message}`,
                format: 'text' as const,
                timestamp: payload.updatedAt
              }
            ]
          }
        ]
      }
    )

    await writeArtifact(chatArtifactPath, {
      id: 'general-chat-1',
      updatedAt: '2026-06-18T06:56:02.930Z',
      message: 'RQ hook typing'
    })

    const result = await syncSessions(buildConfig(repoRoot), storage)

    expect(result.filesScanned).toBe(1)
    expect(result.sessionsImported).toBe(1)
    expect(storage.list('').find(row => row.id === 'general-chat-1')?.repoPath).toBe(
      chatCwd
    )
  })
})

import { shell, ipcMain } from 'electron'
import type { AppConfig } from '../shared/types'
import { ConfigService } from './config'
import { logError, logInfo, logWarn } from './logger'
import { openInCli, openInVscode } from './openers'
import { SessionStorage } from './storage'
import { getAutoDiscoveredPatterns, syncSessions } from './sync'

export const registerIpcHandlers = (
  storage: SessionStorage,
  configService: ConfigService
): void => {
  logInfo('Registering IPC handlers')

  ipcMain.handle('config:get', async () => {
    logInfo('IPC config:get')
    return configService.load()
  })

  ipcMain.on('config:get-bootstrap-appearance', event => {
    logInfo('IPC config:get-bootstrap-appearance')
    event.returnValue = configService.getCachedAppearance()
  })

  ipcMain.handle('config:save', async (_event, config: AppConfig) => {
    logInfo('IPC config:save', {
      repoRoots: config.repoRoots.length,
      discoveryMode: config.discoveryMode,
      explicitPatterns: config.explicitPatterns.length
    })
    return configService.save(config)
  })

  ipcMain.handle('config:get-auto-discovered-patterns', async () => {
    logInfo('IPC config:get-auto-discovered-patterns')
    return getAutoDiscoveredPatterns()
  })

  ipcMain.handle('config:open-file', async () => {
    logInfo('IPC config:open-file', { configPath: configService.getPath() })
    await configService.load()
    const openResult = await shell.openPath(configService.getPath())
    if (openResult) {
      logError('Failed to open config file', { reason: openResult })
      throw new Error(openResult)
    }
  })

  ipcMain.handle('sessions:sync', async () => {
    logInfo('IPC sessions:sync')
    const config = await configService.load()
    return syncSessions(config, storage)
  })

  ipcMain.handle('sessions:list', async (_event, query: string) => {
    logInfo('IPC sessions:list', { query: query ?? '' })
    return storage.list(query ?? '')
  })

  ipcMain.handle('sessions:list-starred', async (_event, query: string) => {
    logInfo('IPC sessions:list-starred', { query: query ?? '' })
    return storage.listStarredMessages(query ?? '')
  })

  ipcMain.handle('sessions:get', async (_event, sessionId: string) => {
    logInfo('IPC sessions:get', { sessionId })
    return storage.getSessionDetail(sessionId)
  })

  ipcMain.handle(
    'sessions:set-archived',
    async (_event, sessionId: string, archived: boolean) => {
      logInfo('IPC sessions:set-archived', { sessionId, archived })
      return storage.setArchived(sessionId, archived)
    }
  )

  ipcMain.handle(
    'sessions:set-message-starred',
    async (_event, sessionId: string, messageId: string, starred: boolean) => {
      logInfo('IPC sessions:set-message-starred', {
        sessionId,
        messageId,
        starred
      })
      return storage.setMessageStarred(sessionId, messageId, starred)
    }
  )

  ipcMain.handle(
    'sessions:open-tool',
    async (_event, sessionId: string, tool: 'vscode' | 'cli') => {
      logInfo('IPC sessions:open-tool', { sessionId, tool })
      const detail = storage.getSessionDetail(sessionId)
      if (!detail) {
        logWarn('Cannot open tool: session detail missing', { sessionId, tool })
        return { ok: false, message: 'Session not found.' }
      }

      if (tool === 'vscode') {
        try {
          return await openInVscode(detail.openVscodeTarget, detail.repoPath)
        } catch (error) {
          logError('Failed opening session in VS Code', {
            sessionId,
            reason: (error as Error).message
          })
          throw error
        }
      }

      try {
        return await openInCli(detail.openCliCwd, detail.id)
      } catch (error) {
        logError('Failed opening session in CLI', {
          sessionId,
          reason: (error as Error).message
        })
        throw error
      }
    }
  )
}

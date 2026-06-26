import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { ConfigService } from './config'
import { registerExternalLinkHandlers } from './external-links'
import { registerIpcHandlers } from './ipc'
import { initializeLogger, logInfo, logWarn } from './logger'
import { SessionStorage } from './storage'

const APP_DISPLAY_NAME = 'AgentStash'
const CANONICAL_USER_DATA_DIR = 'Copilot Sessions Hub'
const currentDir = fileURLToPath(new URL('.', import.meta.url))
const devIconPath = (): string =>
  join(process.cwd(), 'build/icons/agentstash-512.png')
app.setName(APP_DISPLAY_NAME)

const resolveTheme = (
  appearance: 'system' | 'light' | 'dark'
): 'light' | 'dark' =>
  appearance === 'system'
    ? nativeTheme.shouldUseDarkColors
      ? 'dark'
      : 'light'
    : appearance

const getWindowBackgroundColor = (
  appearance: 'system' | 'light' | 'dark'
): string => (resolveTheme(appearance) === 'dark' ? '#0d1117' : '#f5f7fb')

const configureUserDataPath = (): string => {
  const target = join(app.getPath('appData'), CANONICAL_USER_DATA_DIR)
  app.setPath('userData', target)
  return target
}

const newestCandidateFile = (paths: string[]): string | null => {
  const entries = paths
    .filter(path => existsSync(path))
    .flatMap(path => {
      try {
        return [{ path, mtimeMs: statSync(path).mtimeMs }]
      } catch (error) {
        logWarn('Failed to stat migration candidate', {
          path,
          reason: (error as Error).message
        })
        return []
      }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  return entries[0]?.path ?? null
}

const migrateLegacyUserData = (targetDir: string): void => {
  const appData = app.getPath('appData')
  const legacyDirs = [
    join(appData, 'copilot-sessions-hub'),
    join(appData, 'Electron')
  ].filter(candidate => candidate !== targetDir && existsSync(candidate))

  if (legacyDirs.length === 0) {
    return
  }

  mkdirSync(targetDir, { recursive: true })
  for (const filename of ['config.json', 'sessions-store.json']) {
    const targetFile = join(targetDir, filename)
    if (existsSync(targetFile)) {
      continue
    }

    const sourceFile = newestCandidateFile(
      legacyDirs.map(dir => join(dir, filename))
    )
    if (!sourceFile) {
      continue
    }

    try {
      copyFileSync(sourceFile, targetFile)
      logInfo('Migrated legacy app data file', { sourceFile, targetFile })
    } catch (error) {
      logWarn('Failed migrating legacy app data file', {
        sourceFile,
        targetFile,
        reason: (error as Error).message
      })
    }
  }
}

const createWindow = async (
  appearance: 'system' | 'light' | 'dark'
): Promise<void> => {
  logInfo('Creating browser window')
  const iconPath = devIconPath()
  const hasCustomIcon = existsSync(iconPath)
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    title: APP_DISPLAY_NAME,
    icon: hasCustomIcon ? iconPath : undefined,
    backgroundColor: getWindowBackgroundColor(appearance),
    webPreferences: {
      preload: join(currentDir, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  registerExternalLinkHandlers(window.webContents, url =>
    shell.openExternal(url)
  )

  if (process.env['ELECTRON_RENDERER_URL']) {
    await window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await window.loadFile(join(currentDir, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  const userDataPath = configureUserDataPath()
  initializeLogger(userDataPath)
  migrateLegacyUserData(userDataPath)
  process.title = APP_DISPLAY_NAME
  logInfo('App ready', { userDataPath, appName: app.name })

  if (process.platform === 'darwin') {
    const iconPath = devIconPath()
    if (existsSync(iconPath)) {
      if (app.dock) {
        app.dock.setIcon(iconPath)
        logInfo('Applied custom dock icon for development', { iconPath })
      }
    } else {
      logWarn('Custom dock icon not found; falling back to default', {
        iconPath
      })
    }
  }

  const storage = new SessionStorage(
    join(app.getPath('userData'), 'sessions-store.json')
  )
  const configService = new ConfigService(
    join(app.getPath('userData'), 'config.json')
  )
  const initialConfig = await configService.load()

  registerIpcHandlers(storage, configService)
  await createWindow(initialConfig.appearance)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow(configService.getCachedAppearance())
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

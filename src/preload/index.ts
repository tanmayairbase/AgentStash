import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  AppearancePreference,
  RendererApi
} from '../shared/types'

const SYSTEM_DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

interface PreloadThemeGlobals {
  matchMedia?: (query: string) => { matches: boolean }
  document?: {
    documentElement?: {
      dataset: Record<string, string>
      style: { colorScheme: string }
    } | null
  }
}

const preloadGlobals = globalThis as typeof globalThis & PreloadThemeGlobals

const isAppearancePreference = (
  value: unknown
): value is AppearancePreference =>
  value === 'system' || value === 'light' || value === 'dark'

const resolveTheme = (appearance: AppearancePreference): 'light' | 'dark' =>
  appearance === 'system'
    ? typeof preloadGlobals.matchMedia === 'function' &&
      preloadGlobals.matchMedia(SYSTEM_DARK_MEDIA_QUERY).matches
      ? 'dark'
      : 'light'
    : appearance

const applyBootstrapTheme = (appearance: AppearancePreference): void => {
  const root = preloadGlobals.document?.documentElement
  if (!root) {
    return
  }

  const resolved = resolveTheme(appearance)
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
}

const bootstrapAppearance = ipcRenderer.sendSync(
  'config:get-bootstrap-appearance'
)
applyBootstrapTheme(
  isAppearancePreference(bootstrapAppearance) ? bootstrapAppearance : 'system'
)

const api: RendererApi = {
  getConfig: async () => ipcRenderer.invoke('config:get'),
  saveConfig: async (config: AppConfig) =>
    ipcRenderer.invoke('config:save', config),
  openConfigFile: async () => ipcRenderer.invoke('config:open-file'),
  getAutoDiscoveredPatterns: async () =>
    ipcRenderer.invoke('config:get-auto-discovered-patterns'),
  syncSessions: async () => ipcRenderer.invoke('sessions:sync'),
  listSessions: async (query: string) =>
    ipcRenderer.invoke('sessions:list', query),
  listStarredMessages: async (query: string) =>
    ipcRenderer.invoke('sessions:list-starred', query),
  getSessionDetail: async (sessionId: string) =>
    ipcRenderer.invoke('sessions:get', sessionId),
  openSessionInTool: async (sessionId: string, tool: 'vscode' | 'cli') =>
    ipcRenderer.invoke('sessions:open-tool', sessionId, tool),
  setSessionArchived: async (sessionId: string, archived: boolean) =>
    ipcRenderer.invoke('sessions:set-archived', sessionId, archived),
  setMessageStarred: async (
    sessionId: string,
    messageId: string,
    starred: boolean
  ) =>
    ipcRenderer.invoke(
      'sessions:set-message-starred',
      sessionId,
      messageId,
      starred
    )
}

contextBridge.exposeInMainWorld('copilotSessions', api)

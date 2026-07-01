import React, { useEffect, useState } from 'react'
import type {
  AppConfig,
  AppUpdateStatus,
  AppearancePreference,
  AutoDiscoveredPatternInfo,
  DiscoveryMode,
  SyncMode,
  UpdateDownloadProgress
} from '@shared/types'

interface Props {
  isOpen: boolean
  config: AppConfig | null
  autoDiscoveredPatterns: AutoDiscoveredPatternInfo[]
  updateStatus: AppUpdateStatus | null
  isCheckingUpdates: boolean
  isDownloadingUpdate: boolean
  updateDownloadProgress: UpdateDownloadProgress | null
  updateError: string | null
  onClose: () => void
  onSave: (next: AppConfig) => Promise<void>
  onCheckUpdates: () => Promise<void>
  onDownloadUpdate: () => Promise<void>
  onDismissUpdate: () => Promise<void>
}

const formatRelativeUpdateCheckTime = (
  value: string | null | undefined
): string => {
  if (!value) {
    return 'Never'
  }

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    return 'Unknown'
  }

  const elapsedMs = Math.max(0, Date.now() - timestamp)
  const elapsedSeconds = Math.floor(elapsedMs / 1000)
  if (elapsedSeconds < 60) {
    return 'Just now'
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`
  }

  const elapsedDays = Math.floor(elapsedHours / 24)
  return `${elapsedDays}d ago`
}

const formatDownloadProgress = (
  progress: UpdateDownloadProgress | null
): string | null => {
  if (!progress) {
    return null
  }
  if (progress.phase === 'verifying') {
    return 'Verifying download...'
  }
  if (progress.phase === 'opening') {
    return 'Opening DMG...'
  }
  if (progress.phase === 'complete') {
    return 'DMG opened.'
  }
  return progress.percent === null
    ? 'Downloading update...'
    : `Downloading update... ${progress.percent}%`
}

export const SettingsModal = ({
  isOpen,
  config,
  autoDiscoveredPatterns,
  updateStatus,
  isCheckingUpdates,
  isDownloadingUpdate,
  updateDownloadProgress,
  updateError,
  onClose,
  onSave,
  onCheckUpdates,
  onDownloadUpdate,
  onDismissUpdate
}: Props) => {
  const [repoRoots, setRepoRoots] = useState('')
  const [explicitPatterns, setExplicitPatterns] = useState('')
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>('both')
  const [appearance, setAppearance] = useState<AppearancePreference>('system')
  const [syncMode, setSyncMode] = useState<SyncMode>('manual')
  const [backgroundSyncIntervalMinutes, setBackgroundSyncIntervalMinutes] =
    useState('10')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!config) {
      return
    }

    setRepoRoots(config.repoRoots.join('\n'))
    setExplicitPatterns(config.explicitPatterns.join('\n'))
    setDiscoveryMode(config.discoveryMode)
    setAppearance(config.appearance)
    setSyncMode(config.syncMode)
    setBackgroundSyncIntervalMinutes(
      String(config.backgroundSyncIntervalMinutes)
    )
  }, [config])

  if (!isOpen) {
    return null
  }

  const latestUpdate = updateStatus?.latest ?? null
  const isLatestDismissed =
    Boolean(latestUpdate) &&
    updateStatus?.dismissedVersion === latestUpdate?.version
  const downloadProgressText = formatDownloadProgress(updateDownloadProgress)

  const submit = async (): Promise<void> => {
    setIsSaving(true)
    setSaveError(null)
    try {
      await onSave({
        repoRoots: repoRoots
          .split(/\r?\n/)
          .map(item => item.trim())
          .filter(Boolean),
        explicitPatterns: explicitPatterns
          .split(/\r?\n/)
          .map(item => item.trim())
          .filter(Boolean),
        discoveryMode,
        appearance,
        syncMode,
        backgroundSyncIntervalMinutes: Math.max(
          1,
          Number.parseInt(backgroundSyncIntervalMinutes, 10) || 10
        )
      })
      onClose()
    } catch (error) {
      setSaveError((error as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="App settings"
    >
      <div className="modal">
        <h3>Settings</h3>
        <p>Control app appearance and where session sync looks for data.</p>

        <section className="settings-updates" aria-label="Updates">
          <div className="settings-updates-header">
            <div>
              <h4>Updates</h4>
              <p>
                Current version: {updateStatus?.currentVersion ?? 'Unknown'}
              </p>
              <p>
                Last checked:{' '}
                {formatRelativeUpdateCheckTime(
                  updateStatus?.lastCheckedAt ?? null
                )}
              </p>
            </div>
            <div className="settings-updates-check">
              <button
                type="button"
                onClick={() => void onCheckUpdates()}
                disabled={isCheckingUpdates || isDownloadingUpdate}
              >
                {isCheckingUpdates ? 'Checking...' : 'Check for updates'}
              </button>
              <div className="settings-updates-status">
                {latestUpdate ? (
                  <p>Version {latestUpdate.version} is available.</p>
                ) : (
                  <p>AgentStash is up to date.</p>
                )}
              </div>
            </div>
          </div>
          {downloadProgressText && <p>{downloadProgressText}</p>}
          {updateError && (
            <p className="modal-error">Update failed: {updateError}</p>
          )}
          {latestUpdate && (
            <div className="settings-updates-actions">
              <button
                type="button"
                onClick={() => void onDownloadUpdate()}
                disabled={isDownloadingUpdate}
              >
                {isDownloadingUpdate ? 'Downloading...' : 'Download update'}
              </button>
              {!isLatestDismissed && (
                <button
                  type="button"
                  onClick={() => void onDismissUpdate()}
                  disabled={isDownloadingUpdate}
                >
                  Dismiss this version
                </button>
              )}
            </div>
          )}
        </section>

        <label>
          Appearance
          <select
            value={appearance}
            onChange={event =>
              setAppearance(event.target.value as AppearancePreference)
            }
            aria-label="Appearance"
          >
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>

        <label>
          Repository roots (one per line)
          <textarea
            value={repoRoots}
            onChange={event => setRepoRoots(event.target.value)}
            rows={6}
          />
        </label>

        <label>
          Discovery mode
          <select
            value={discoveryMode}
            onChange={event =>
              setDiscoveryMode(event.target.value as DiscoveryMode)
            }
          >
            <option value="both">
              Both autodiscovery and explicit patterns
            </option>
            <option value="autodiscovery">Autodiscovery only</option>
            <option value="explicit">Explicit patterns only</option>
          </select>
        </label>

        {autoDiscoveredPatterns.length > 0 && (
          <div className="settings-auto-discovery">
            <p>
              Always scanned on this machine, regardless of discovery mode or
              the explicit patterns below:
            </p>
            <ul>
              {autoDiscoveredPatterns.map(item => (
                <li key={item.label}>
                  <strong>{item.label}</strong>
                  <code>{item.pattern}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        <label>
          Explicit glob patterns (one per line)
          <textarea
            value={explicitPatterns}
            onChange={event => setExplicitPatterns(event.target.value)}
            rows={5}
          />
        </label>

        <label>
          Background sync mode
          <select
            value={syncMode}
            onChange={event => setSyncMode(event.target.value as SyncMode)}
            aria-label="Background sync mode"
          >
            <option value="manual">Manual sync only</option>
            <option value="manual-plus-background">
              Manual + periodic background sync
            </option>
          </select>
        </label>

        <label>
          Background sync interval (minutes)
          <input
            type="number"
            min={1}
            max={1440}
            value={backgroundSyncIntervalMinutes}
            onChange={event =>
              setBackgroundSyncIntervalMinutes(event.target.value)
            }
          />
        </label>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={isSaving || !config}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
        {saveError && <p className="modal-error">Save failed: {saveError}</p>}
      </div>
    </div>
  )
}

import React from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig, AppUpdateStatus } from '../src/shared/types'
import { SettingsModal } from '../src/renderer/src/components/SettingsModal'

const baseConfig: AppConfig = {
  repoRoots: ['/Users/me/projects/frontend2'],
  discoveryMode: 'both',
  explicitPatterns: ['**/.copilot/**/*.json'],
  appearance: 'system',
  syncMode: 'manual',
  backgroundSyncIntervalMinutes: 10
}

const updateStatus: AppUpdateStatus = {
  currentVersion: '11.0.0',
  latest: null,
  lastCheckedAt: null,
  dismissedVersion: null,
  updateAvailable: false,
  notificationVisible: false
}

const availableUpdateStatus: AppUpdateStatus = {
  currentVersion: '11.0.0',
  latest: {
    version: '12.0.0',
    releaseUrl:
      'https://github.com/tanmayairbase/AgentStash/releases/tag/12.0.0',
    publishedAt: '2026-07-01T00:00:00.000Z',
    assetName: 'AgentStash-12.0.0-arm64.dmg',
    assetUrl:
      'https://github.com/tanmayairbase/AgentStash/releases/download/12.0.0/AgentStash-12.0.0-arm64.dmg',
    assetSize: 123,
    assetDigest: 'abc123'
  },
  lastCheckedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  dismissedVersion: null,
  updateAvailable: true,
  notificationVisible: true
}

const updateProps = {
  updateStatus,
  isCheckingUpdates: false,
  isDownloadingUpdate: false,
  updateDownloadProgress: null,
  updateError: null,
  onCheckUpdates: vi.fn(async () => undefined),
  onDownloadUpdate: vi.fn(async () => undefined),
  onDismissUpdate: vi.fn(async () => undefined)
}

describe('SettingsModal', () => {
  afterEach(() => {
    cleanup()
  })

  it('saves updated repo roots', async () => {
    const onClose = vi.fn()
    const onSave = vi.fn(async () => undefined)

    render(
      <SettingsModal
        isOpen={true}
        config={baseConfig}
        autoDiscoveredPatterns={[]}
        {...updateProps}
        onClose={onClose}
        onSave={onSave}
      />
    )

    fireEvent.change(screen.getByLabelText('Repository roots (one per line)'), {
      target: { value: '/Users/me/projects/airbase-frontend' }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        repoRoots: ['/Users/me/projects/airbase-frontend'],
        discoveryMode: 'both',
        explicitPatterns: ['**/.copilot/**/*.json'],
        appearance: 'system',
        syncMode: 'manual',
        backgroundSyncIntervalMinutes: 10
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('saves background sync settings', async () => {
    const onClose = vi.fn()
    const onSave = vi.fn(async () => undefined)

    render(
      <SettingsModal
        isOpen={true}
        config={baseConfig}
        autoDiscoveredPatterns={[]}
        {...updateProps}
        onClose={onClose}
        onSave={onSave}
      />
    )

    const dialog = screen.getByRole('dialog', { name: 'App settings' })

    fireEvent.change(
      within(dialog).getByRole('combobox', { name: 'Background sync mode' }),
      {
        target: { value: 'manual-plus-background' }
      }
    )
    fireEvent.change(
      within(dialog).getByRole('spinbutton', {
        name: 'Background sync interval (minutes)'
      }),
      {
        target: { value: '5' }
      }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        repoRoots: ['/Users/me/projects/frontend2'],
        discoveryMode: 'both',
        explicitPatterns: ['**/.copilot/**/*.json'],
        appearance: 'system',
        syncMode: 'manual-plus-background',
        backgroundSyncIntervalMinutes: 5
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('saves appearance changes', async () => {
    const onClose = vi.fn()
    const onSave = vi.fn(async () => undefined)

    render(
      <SettingsModal
        isOpen={true}
        config={baseConfig}
        autoDiscoveredPatterns={[]}
        {...updateProps}
        onClose={onClose}
        onSave={onSave}
      />
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Appearance' }), {
      target: { value: 'light' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        repoRoots: ['/Users/me/projects/frontend2'],
        discoveryMode: 'both',
        explicitPatterns: ['**/.copilot/**/*.json'],
        appearance: 'light',
        syncMode: 'manual',
        backgroundSyncIntervalMinutes: 10
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('lists the always-on auto-discovered patterns', () => {
    render(
      <SettingsModal
        isOpen={true}
        config={baseConfig}
        autoDiscoveredPatterns={[
          {
            label: 'Claude Code sessions',
            pattern: '/Users/me/.claude/projects/**/*.jsonl'
          }
        ]}
        {...updateProps}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />
    )

    expect(screen.getByText('Claude Code sessions')).not.toBeNull()
    expect(
      screen.getByText('/Users/me/.claude/projects/**/*.jsonl')
    ).not.toBeNull()
  })

  it('renders no auto-discovery section when the list is empty', () => {
    render(
      <SettingsModal
        isOpen={true}
        config={baseConfig}
        autoDiscoveredPatterns={[]}
        {...updateProps}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />
    )

    expect(screen.queryByText(/Always scanned/)).toBeNull()
  })

  it('renders update status and wires update actions', () => {
    const onCheckUpdates = vi.fn(async () => undefined)
    const onDownloadUpdate = vi.fn(async () => undefined)
    const onDismissUpdate = vi.fn(async () => undefined)

    render(
      <SettingsModal
        isOpen={true}
        config={baseConfig}
        autoDiscoveredPatterns={[]}
        {...updateProps}
        updateStatus={availableUpdateStatus}
        onCheckUpdates={onCheckUpdates}
        onDownloadUpdate={onDownloadUpdate}
        onDismissUpdate={onDismissUpdate}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />
    )

    expect(screen.getByText('Version 12.0.0 is available.')).toBeTruthy()
    expect(screen.getByText(/Last checked: 2h ago/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download update' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss this version' })
    )

    expect(onCheckUpdates).toHaveBeenCalledTimes(1)
    expect(onDownloadUpdate).toHaveBeenCalledTimes(1)
    expect(onDismissUpdate).toHaveBeenCalledTimes(1)
  })

  it('hides dismiss after the latest version has been dismissed', () => {
    render(
      <SettingsModal
        isOpen={true}
        config={baseConfig}
        autoDiscoveredPatterns={[]}
        {...updateProps}
        updateStatus={{
          ...availableUpdateStatus,
          dismissedVersion: availableUpdateStatus.latest?.version ?? null,
          notificationVisible: false
        }}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />
    )

    expect(screen.getByRole('button', { name: 'Download update' })).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Dismiss this version' })
    ).toBeNull()
  })

  it('shows update progress and errors while disabling check actions', () => {
    render(
      <SettingsModal
        isOpen={true}
        config={baseConfig}
        autoDiscoveredPatterns={[]}
        {...updateProps}
        isCheckingUpdates={true}
        isDownloadingUpdate={true}
        updateDownloadProgress={{
          phase: 'downloading',
          bytesReceived: 50,
          totalBytes: 100,
          percent: 50
        }}
        updateError="Network unavailable"
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />
    )

    expect(screen.getByRole('button', { name: 'Checking...' })).toBeDisabled()
    expect(screen.getByText('Downloading update... 50%')).toBeTruthy()
    expect(screen.getByText('Update failed: Network unavailable')).toBeTruthy()
  })
})

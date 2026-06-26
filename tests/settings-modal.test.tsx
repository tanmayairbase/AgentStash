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
import type { AppConfig } from '../src/shared/types'
import { SettingsModal } from '../src/renderer/src/components/SettingsModal'

const baseConfig: AppConfig = {
  repoRoots: ['/Users/me/projects/frontend2'],
  discoveryMode: 'both',
  explicitPatterns: ['**/.copilot/**/*.json'],
  appearance: 'system',
  syncMode: 'manual',
  backgroundSyncIntervalMinutes: 10
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
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />
    )

    expect(screen.queryByText(/Always scanned/)).toBeNull()
  })
})

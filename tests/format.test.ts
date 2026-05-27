import { describe, expect, it } from 'vitest'
import {
  formatSessionOrigin,
  formatTimestampIST,
  matchesIstDatePreset,
  matchesRepositoryFilter,
  normalizeModelLabel,
  toTildePath
} from '../src/shared/format'

describe('formatTimestampIST', () => {
  it('formats into required MMM DD, YYYY HH:mm IST format', () => {
    const value = formatTimestampIST('2026-03-11T18:10:27.492Z')
    expect(value).toMatch(/^[A-Z][a-z]{2} \d{2}, \d{4} \d{2}:\d{2} IST$/)
  })
})

describe('toTildePath', () => {
  it('replaces macOS user home prefix with tilde', () => {
    expect(toTildePath('/Users/trajani/projects/frontend2')).toBe(
      '~/projects/frontend2'
    )
  })
})

describe('matchesIstDatePreset', () => {
  const now = new Date('2026-03-12T04:46:21.111Z')

  it('evaluates day-window filters in IST', () => {
    expect(matchesIstDatePreset('2026-03-12T00:10:00.000Z', 'today', now)).toBe(
      true
    )
    expect(
      matchesIstDatePreset('2026-03-11T18:00:00.000Z', 'yesterday', now)
    ).toBe(true)
    expect(matchesIstDatePreset('2026-03-06T10:00:00.000Z', 'last7', now)).toBe(
      true
    )
    expect(
      matchesIstDatePreset('2026-02-27T10:00:00.000Z', 'last14', now)
    ).toBe(true)
    expect(
      matchesIstDatePreset('2026-02-20T10:00:00.000Z', 'last30', now)
    ).toBe(true)
    expect(
      matchesIstDatePreset('2026-02-01T10:00:00.000Z', 'last30', now)
    ).toBe(false)
  })
})

describe('formatSessionOrigin', () => {
  it('formats source values into user-friendly labels', () => {
    expect(formatSessionOrigin('cli')).toBe('CLI')
    expect(formatSessionOrigin('vscode')).toBe('VS Code')
    expect(formatSessionOrigin('opencode')).toBe('OpenCode')
  })
})

describe('matchesRepositoryFilter', () => {
  it('matches only exact repository selections', () => {
    expect(
      matchesRepositoryFilter('/Users/trajani/projects', [
        '/Users/trajani/projects'
      ])
    ).toBe(true)
    expect(
      matchesRepositoryFilter('/Users/trajani/projects/frontend2', [
        '/Users/trajani/projects'
      ])
    ).toBe(false)
  })
})

describe('normalizeModelLabel', () => {
  it('removes copilot provider prefix and trims whitespace', () => {
    expect(normalizeModelLabel(' copilot/gpt-5.3-codex ')).toBe('gpt-5.3-codex')
    expect(normalizeModelLabel('copilot/claude-sonnet-4.6')).toBe(
      'claude-sonnet-4.6'
    )
    expect(normalizeModelLabel('gpt-5.3-codex')).toBe('gpt-5.3-codex')
    expect(normalizeModelLabel('')).toBe('')
  })
})

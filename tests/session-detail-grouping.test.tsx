import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionDetail } from '../src/shared/types'
import { SessionDetailView } from '../src/renderer/src/components/SessionDetailView'

const detail: SessionDetail = {
  id: 's1',
  source: 'cli',
  repoPath: '/repos/a',
  title: 'Session title',
  agent: 'security-upgrade-agent',
  model: 'copilot/gpt-5.3-codex',
  createdAt: '2026-03-11T10:00:00.000Z',
  updatedAt: '2026-03-11T10:05:00.000Z',
  messageCount: 4,
  filePath: '/repos/a/events.jsonl',
  openVscodeTarget: '/repos/a/events.jsonl',
  openCliCwd: '/repos/a',
  messages: [
    {
      id: 'm1',
      sessionId: 's1',
      role: 'assistant',
      content: 'line one',
      format: 'text',
      timestamp: '2026-03-11T10:00:10.000Z'
    },
    {
      id: 'm2',
      sessionId: 's1',
      role: 'assistant',
      content: 'line two',
      format: 'text',
      timestamp: '2026-03-11T10:00:40.000Z'
    },
    {
      id: 'm3',
      sessionId: 's1',
      role: 'user',
      content: 'Use `pnpm build` before deploy.',
      format: 'text',
      timestamp: '2026-03-11T10:01:00.000Z',
      references: [
        { path: '/repos/a/src/index.tsx', startLine: 48, endLine: 52 }
      ]
    },
    {
      id: 'm4',
      sessionId: 's1',
      role: 'assistant',
      content: 'answer',
      format: 'text',
      timestamp: '2026-03-11T10:02:00.000Z',
      edits: [
        {
          path: '/repos/a/src/index.tsx',
          startLine: 88,
          endLine: 88,
          addedLines: 1,
          removedLines: 1
        }
      ]
    }
  ]
}

const setThreadMetrics = (
  thread: HTMLDivElement,
  options: {
    scrollTop?: number
    scrollHeight: number
    clientHeight: number
    scrollTo?: ReturnType<typeof vi.fn>
  }
): ReturnType<typeof vi.fn> => {
  Object.defineProperties(thread, {
    scrollTop: {
      value: options.scrollTop ?? 0,
      writable: true,
      configurable: true
    },
    scrollHeight: {
      value: options.scrollHeight,
      configurable: true
    },
    clientHeight: {
      value: options.clientHeight,
      configurable: true
    },
    scrollTo: {
      value: options.scrollTo ?? vi.fn(),
      configurable: true
    }
  })

  return thread.scrollTo as ReturnType<typeof vi.fn>
}

describe('SessionDetailView grouping', () => {
  afterEach(() => {
    cleanup()
  })

  it('combines contiguous messages with same role and HH:mm into one bubble', () => {
    render(<SessionDetailView detail={detail} />)

    const assistantBubbles = screen.getAllByLabelText('assistant message')
    expect(assistantBubbles).toHaveLength(2)
    expect(screen.getByText('Origin: CLI')).toBeTruthy()
    expect(screen.getByText('Agent: security-upgrade-agent')).toBeTruthy()
    expect(screen.getByText('Model: gpt-5.3-codex')).toBeTruthy()
    expect(screen.getByText('index.tsx:48-52')).toBeTruthy()
    expect(screen.getByText('Edited index.tsx +1 -1 (88-88)')).toBeTruthy()
    expect(screen.getByText('pnpm build')).toBeTruthy()
    expect(screen.getByText(/line one/)).toBeTruthy()
    expect(screen.getByText(/line two/)).toBeTruthy()
    expect(screen.queryByText('Read-only transcript')).toBeNull()
  })

  it('triggers copy callback from header icon button', () => {
    const onCopySessionId = vi.fn()
    render(
      <SessionDetailView detail={detail} onCopySessionId={onCopySessionId} />
    )

    fireEvent.click(screen.getByLabelText('Copy session ID'))
    expect(onCopySessionId).toHaveBeenCalledWith('s1')
  })

  it('shows chunked transcript loading controls for large sessions', () => {
    const start = new Date('2026-03-11T00:00:00.000Z').getTime()
    const largeDetail: SessionDetail = {
      ...detail,
      id: 's-large',
      messageCount: 260,
      messages: Array.from({ length: 260 }).map((_, index) => ({
        id: `m-large-${index + 1}`,
        sessionId: 's-large',
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `line ${index + 1}`,
        format: 'text',
        timestamp: new Date(start + index * 60_000).toISOString()
      }))
    }

    render(<SessionDetailView detail={largeDetail} />)
    expect(screen.getByText('line 260')).toBeTruthy()
    expect(screen.queryByText('line 1')).toBeNull()
    expect(screen.getByText(/Load older messages/)).toBeTruthy()

    fireEvent.click(screen.getByText(/Load older messages/))
    expect(screen.getByText('line 1')).toBeTruthy()
  })

  it('scrolls to the top when switching sessions', async () => {
    const nextDetail: SessionDetail = {
      ...detail,
      id: 's2',
      title: 'Second session',
      messages: detail.messages.map(message => ({
        ...message,
        id: `${message.id}-s2`,
        sessionId: 's2'
      }))
    }

    const { container, rerender } = render(<SessionDetailView detail={detail} />)
    const thread = container.querySelector('.message-thread') as HTMLDivElement

    thread.scrollTop = 275
    rerender(<SessionDetailView detail={nextDetail} />)

    await waitFor(() => {
      expect(thread.scrollTop).toBe(0)
    })
  })

  it('renders transcript links as external browser links', () => {
    const linkedDetail: SessionDetail = {
      ...detail,
      messages: [
        {
          id: 'm-link-a',
          sessionId: 's1',
          role: 'assistant',
          content: 'See [PR #42](https://github.com/org/repo/pull/42).',
          format: 'markdown',
          timestamp: '2026-03-11T10:03:00.000Z'
        },
        {
          id: 'm-link-u',
          sessionId: 's1',
          role: 'user',
          content: 'Reference https://example.com/docs for context.',
          format: 'markdown',
          timestamp: '2026-03-11T10:04:00.000Z'
        }
      ]
    }

    render(<SessionDetailView detail={linkedDetail} />)

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0].getAttribute('href')).toBe(
      'https://github.com/org/repo/pull/42'
    )
    expect(links[0].getAttribute('target')).toBe('_blank')
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer')
    expect(links[1].getAttribute('href')).toBe('https://example.com/docs')
    expect(links[1].getAttribute('target')).toBe('_blank')
    expect(links[1].getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('preserves multiline user prompts as readable lists', () => {
    const multilineDetail: SessionDetail = {
      ...detail,
      messages: [
        {
          id: 'm-multiline-user',
          sessionId: 's1',
          role: 'user',
          content:
            "Here's what I want you to do next:\n- run the typecheck again\n- group failures by CODEOWNERS\n- create subtasks",
          format: 'markdown',
          timestamp: '2026-03-11T10:04:00.000Z'
        }
      ]
    }

    const { container } = render(<SessionDetailView detail={multilineDetail} />)
    const userBubble = screen.getByLabelText('user message')
    const items = userBubble.querySelectorAll('li')

    expect(screen.getByText("Here's what I want you to do next:")).toBeTruthy()
    expect(items).toHaveLength(3)
    expect(container.textContent).toContain('run the typecheck again')
    expect(container.textContent).toContain('group failures by CODEOWNERS')
    expect(container.textContent).toContain('create subtasks')
  })

  it('renders GFM tables with inline HTML without breaking structure', () => {
    const tableDetail: SessionDetail = {
      ...detail,
      messages: [
        {
          id: 'm-table',
          sessionId: 's1',
          role: 'assistant',
          content:
            '| Metric | BEFORE | AFTER | Δ |\n' +
            '| --- | --- | --- | --- |\n' +
            '| Execution time | 6.536 ms | 0.892 ms | ~7.3× faster |\n' +
            '| Top-level Buffers<br/>\n`read` (disk) | 30 | 2 | 15× fewer disk reads |\n' +
            '| TRE access path | `BitmapAnd(...)` → Bitmap Heap Scan | **single**<br/>\nIndex Scan using ... | plan simplified |',
          format: 'markdown',
          timestamp: '2026-03-11T10:04:00.000Z'
        }
      ]
    }

    const { container } = render(<SessionDetailView detail={tableDetail} />)
    const rows = container.querySelectorAll('.message-content table tbody tr')

    expect(rows).toHaveLength(3)
    expect(container.textContent).toContain('read')
    expect(container.textContent).toContain('15× fewer disk reads')
    expect(container.textContent).toContain('plan simplified')
  })

  it('does not alter markdown inside fenced code blocks', () => {
    const codeBlockDetail: SessionDetail = {
      ...detail,
      messages: [
        {
          id: 'm-codeblock',
          sessionId: 's1',
          role: 'assistant',
          content:
            'Example markdown:\n\n' +
            '```md\n' +
            '| a | b<br/>\n| c | d |\n' +
            '```\n\n' +
            'Text after.',
          format: 'markdown',
          timestamp: '2026-03-11T10:04:00.000Z'
        }
      ]
    }

    const { container } = render(<SessionDetailView detail={codeBlockDetail} />)
    const code = container.querySelector('.message-content pre code')

    expect(code).toBeTruthy()
    expect(code?.textContent).toContain('| a | b')
    expect(code?.textContent).toContain('| c | d |')
    expect(container.querySelectorAll('.message-content table')).toHaveLength(0)
  })

  it('shows a single contextual floating scroll pill for long threads', async () => {
    const { container } = render(<SessionDetailView detail={detail} />)
    const thread = container.querySelector('.message-thread') as HTMLDivElement

    setThreadMetrics(thread, {
      scrollTop: 0,
      scrollHeight: 1600,
      clientHeight: 600
    })
    fireEvent.scroll(thread)

    expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).toBeNull()

    thread.scrollTop = 180
    fireEvent.scroll(thread)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Scroll to bottom' })
      ).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull()

    thread.scrollTop = 320
    fireEvent.scroll(thread)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Scroll to bottom' })
      ).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull()

    thread.scrollTop = 180
    fireEvent.scroll(thread)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Back to top' })).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).toBeNull()

    thread.scrollTop = 90
    fireEvent.scroll(thread)

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Scroll to bottom' })
      ).toBeNull()
    })
    expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull()

    thread.scrollTop = 980
    fireEvent.scroll(thread)

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Scroll to bottom' })
      ).toBeNull()
    })
    expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull()
  })

  it('uses smooth scrolling when the floating pills are clicked', async () => {
    const { container } = render(<SessionDetailView detail={detail} />)
    const thread = container.querySelector('.message-thread') as HTMLDivElement
    const scrollTo = setThreadMetrics(thread, {
      scrollTop: 0,
      scrollHeight: 1600,
      clientHeight: 600
    })

    fireEvent.scroll(thread)

    thread.scrollTop = 180
    fireEvent.scroll(thread)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Scroll to bottom' })
    )
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 1600,
      behavior: 'smooth'
    })

    thread.scrollTop = 320
    fireEvent.scroll(thread)

    thread.scrollTop = 180
    fireEvent.scroll(thread)

    fireEvent.click(await screen.findByRole('button', { name: 'Back to top' }))
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('keeps same-minute user messages separate when their modes differ', () => {
    const modeDetail: SessionDetail = {
      ...detail,
      id: 's-mode',
      modes: ['plan', 'autopilot'],
      latestMode: 'autopilot',
      messages: [
        {
          id: 'm-plan',
          sessionId: 's-mode',
          role: 'user',
          mode: 'plan',
          content: 'Draft the plan first.',
          format: 'text',
          timestamp: '2026-03-11T10:01:00.000Z'
        },
        {
          id: 'm-auto',
          sessionId: 's-mode',
          role: 'user',
          mode: 'autopilot',
          content: 'Now implement it.',
          format: 'text',
          timestamp: '2026-03-11T10:01:30.000Z'
        }
      ]
    }

    render(<SessionDetailView detail={modeDetail} />)

    expect(screen.getAllByLabelText('user message')).toHaveLength(2)
    expect(screen.queryByText(/^Mode:$/)).toBeNull()
    expect(
      screen.getByText('Draft the plan first.').closest('article')?.className
    ).toContain('message-mode-plan')
    expect(
      screen.getByText('Now implement it.').closest('article')?.className
    ).toContain('message-mode-autopilot')
  })

  it('renders a thinking-only assistant message as a collapsible disclosure instead of an empty bubble', () => {
    const thinkingDetail: SessionDetail = {
      ...detail,
      id: 's-thinking',
      messages: [
        {
          id: 'm-thinking',
          sessionId: 's-thinking',
          role: 'assistant',
          content: '',
          thinking: 'Considering the right approach...',
          format: 'text',
          timestamp: '2026-03-11T10:05:00.000Z'
        }
      ]
    }

    render(<SessionDetailView detail={thinkingDetail} />)

    const bubble = screen.getByLabelText('assistant message')
    const disclosure = bubble.querySelector('details.message-thinking')
    expect(disclosure).toBeTruthy()
    expect(disclosure?.hasAttribute('open')).toBe(false)
    expect(screen.getByText('Considering the right approach...')).toBeTruthy()
  })

  it('renders an AskUserQuestion-only assistant message as a Q&A block instead of an empty bubble', () => {
    const questionDetail: SessionDetail = {
      ...detail,
      id: 's-question',
      messages: [
        {
          id: 'm-question',
          sessionId: 's-question',
          role: 'assistant',
          content: '',
          format: 'text',
          timestamp: '2026-03-11T10:05:00.000Z',
          questions: [
            {
              question: 'Push commit 20671ef to origin/master?',
              header: 'Push to remote',
              options: [
                { label: 'Yes, push now', description: 'Push it.' },
                { label: 'No, hold off', description: 'Keep it local.' }
              ],
              multiSelect: false,
              answer: 'Yes, push now'
            }
          ]
        }
      ]
    }

    render(<SessionDetailView detail={questionDetail} />)

    const bubble = screen.getByLabelText('assistant message')
    expect(
      bubble.querySelector('.message-questions')
    ).toBeTruthy()
    expect(
      screen.getByText('Push commit 20671ef to origin/master?')
    ).toBeTruthy()
    expect(screen.getByText('Yes, push now')).toBeTruthy()
  })

  it('keeps thinking and questions when a thinking-only turn merges with a same-minute text reply', () => {
    const mergedDetail: SessionDetail = {
      ...detail,
      id: 's-merged-thinking',
      messages: [
        {
          id: 'm-think-first',
          sessionId: 's-merged-thinking',
          role: 'assistant',
          content: '',
          thinking: 'Let me check the file first.',
          format: 'text',
          timestamp: '2026-03-11T10:05:00.000Z'
        },
        {
          id: 'm-text-second',
          sessionId: 's-merged-thinking',
          role: 'assistant',
          content: 'Here is the answer.',
          format: 'text',
          timestamp: '2026-03-11T10:05:20.000Z'
        }
      ]
    }

    render(<SessionDetailView detail={mergedDetail} />)

    const bubbles = screen.getAllByLabelText('assistant message')
    expect(bubbles).toHaveLength(1)
    expect(screen.getByText('Let me check the file first.')).toBeTruthy()
    expect(screen.getByText(/Here is the answer\./)).toBeTruthy()
  })
})

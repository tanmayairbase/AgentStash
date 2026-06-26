import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import AnsiToHtml from 'ansi-to-html'
import { marked } from 'marked'
import { normalizeExternalUrl } from '@shared/links'
import type {
  SessionDetail,
  SessionExecutionMode,
  SessionMessage,
  SessionTokenUsage
} from '@shared/types'
import {
  formatAgentName,
  formatMinuteKeyIST,
  formatSessionOrigin,
  formatTimestampIST,
  normalizeModelLabel
} from '@shared/format'
import { TokenUsageBarWithTooltip } from './TokenUsageBarWithTooltip'

type TranscriptTheme = 'light' | 'dark'

const createAnsiConverter = (theme: TranscriptTheme): AnsiToHtml =>
  new AnsiToHtml({
    fg: theme === 'light' ? '#172033' : '#e6edf3',
    bg: theme === 'light' ? '#f8fafc' : '#161b22',
    newline: true,
    escapeXML: true
  })

const normalizeRenderedLinks = (html: string): string => {
  if (typeof document === 'undefined') {
    return html
  }

  const template = document.createElement('template')
  template.innerHTML = html

  for (const link of template.content.querySelectorAll<HTMLAnchorElement>(
    'a[href]'
  )) {
    const normalized = normalizeExternalUrl(link.getAttribute('href') ?? '')
    if (!normalized) {
      link.replaceWith(document.createTextNode(link.textContent ?? ''))
      continue
    }

    link.setAttribute('href', normalized)
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
  }

  return template.innerHTML
}

const renderMarkdownContent = (content: string): string =>
  normalizeRenderedLinks(marked.parse(content, { breaks: true }) as string)

const renderUserContent = (content: string): string =>
  renderMarkdownContent(content)
const DETAIL_CHUNK_SIZE = 220
const SCROLL_CONTROL_EDGE_THRESHOLD = 28
const SCROLL_CONTROL_REVEAL_THRESHOLD = 140
const SCROLL_CONTROL_TOP_THRESHOLD = 120
const SCROLL_CONTROL_MIN_OVERFLOW = 160

type ScrollControlAction = 'top' | 'bottom' | null

const getScrollControlAction = (
  element: HTMLElement,
  previousScrollTop: number,
  currentAction: ScrollControlAction
): ScrollControlAction => {
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
  if (maxScrollTop < SCROLL_CONTROL_MIN_OVERFLOW) {
    return null
  }

  const nearTop = element.scrollTop <= SCROLL_CONTROL_EDGE_THRESHOLD
  const nearBottom =
    maxScrollTop - element.scrollTop <= SCROLL_CONTROL_EDGE_THRESHOLD
  const scrollingDown = element.scrollTop > previousScrollTop
  const scrollingUp = element.scrollTop < previousScrollTop

  if (nearBottom) {
    return null
  }

  if (element.scrollTop <= SCROLL_CONTROL_REVEAL_THRESHOLD || nearTop) {
    return null
  }

  if (scrollingDown) {
    return 'bottom'
  }

  if (scrollingUp) {
    return element.scrollTop > SCROLL_CONTROL_TOP_THRESHOLD ? 'top' : 'bottom'
  }

  return currentAction ?? 'bottom'
}

interface Props {
  detail: SessionDetail | null
  theme?: TranscriptTheme
  onCopySessionId?: (sessionId: string) => Promise<void> | void
  onToggleMessageStar?: (
    sessionId: string,
    messageId: string,
    starred: boolean
  ) => Promise<void> | void
  focusMessageId?: string | null
  onFocusedMessageConsumed?: () => void
}

interface MessageGroup {
  id: string
  primaryMessageId: string
  messageIds: string[]
  role: SessionMessage['role']
  mode?: SessionMessage['mode']
  combinedContent: string
  thinking?: string
  questions: NonNullable<SessionMessage['questions']>
  timestamp: string
  hasStarredMessage: boolean
  references: NonNullable<SessionMessage['references']>
  edits: NonNullable<SessionMessage['edits']>
}

const toFileLabel = (path: string): string => {
  const normalized = path.replaceAll('\\', '/')
  return normalized.split('/').at(-1) || path
}

const formatExecutionMode = (mode: SessionExecutionMode): string =>
  mode === 'autopilot' ? 'Autopilot' : 'Plan'

const groupMessagesByMinute = (messages: SessionMessage[]): MessageGroup[] => {
  const groups: MessageGroup[] = []

  for (const message of messages) {
    const minuteKey = formatMinuteKeyIST(message.timestamp)
    const last = groups[groups.length - 1]
    const lastMinuteKey = last ? formatMinuteKeyIST(last.timestamp) : ''

    if (
      last &&
      last.role === message.role &&
      last.mode === message.mode &&
      lastMinuteKey === minuteKey
    ) {
      last.combinedContent = `${last.combinedContent}\n\n${message.content}`
      last.messageIds.push(message.id)
      last.hasStarredMessage =
        last.hasStarredMessage || Boolean(message.userStarred)
      if (message.references) {
        for (const reference of message.references) {
          const key = `${reference.path}:${reference.startLine ?? ''}:${reference.endLine ?? ''}`
          const exists = last.references.some(
            item =>
              `${item.path}:${item.startLine ?? ''}:${item.endLine ?? ''}` ===
              key
          )
          if (!exists) {
            last.references.push(reference)
          }
        }
      }
      if (message.edits) {
        for (const edit of message.edits) {
          const existing = last.edits.find(item => item.path === edit.path)
          if (existing) {
            existing.addedLines =
              (existing.addedLines ?? 0) + (edit.addedLines ?? 0)
            existing.removedLines =
              (existing.removedLines ?? 0) + (edit.removedLines ?? 0)
            if (edit.startLine !== undefined) {
              existing.startLine =
                existing.startLine !== undefined
                  ? Math.min(existing.startLine, edit.startLine)
                  : edit.startLine
            }
            if (edit.endLine !== undefined) {
              existing.endLine =
                existing.endLine !== undefined
                  ? Math.max(existing.endLine, edit.endLine)
                  : edit.endLine
            }
          } else {
            last.edits.push(edit)
          }
        }
      }
      if (message.thinking) {
        last.thinking = last.thinking
          ? `${last.thinking}\n\n${message.thinking}`
          : message.thinking
      }
      if (message.questions) {
        last.questions.push(...message.questions)
      }
      continue
    }

    groups.push({
      id: message.id,
      primaryMessageId: message.id,
      messageIds: [message.id],
      role: message.role,
      mode: message.mode,
      combinedContent: message.content,
      thinking: message.thinking,
      questions: message.questions ? [...message.questions] : [],
      timestamp: message.timestamp,
      hasStarredMessage: Boolean(message.userStarred),
      references: message.references ? [...message.references] : [],
      edits: message.edits ? [...message.edits] : []
    })
  }

  return groups
}

export const SessionDetailView = ({
  detail,
  theme = 'dark',
  onCopySessionId,
  onToggleMessageStar,
  focusMessageId,
  onFocusedMessageConsumed
}: Props) => {
  const ansiConverter = useMemo(() => createAnsiConverter(theme), [theme])
  const threadRef = useRef<HTMLDivElement | null>(null)
  const autoScrolledSessionIdRef = useRef<string | null>(null)
  const lastThreadScrollTopRef = useRef(0)
  const groupedMessages = useMemo(
    () => groupMessagesByMinute(detail?.messages ?? []),
    [detail]
  )
  const [visibleCount, setVisibleCount] = useState(DETAIL_CHUNK_SIZE)
  const [scrollControlAction, setScrollControlAction] =
    useState<ScrollControlAction>(null)

  const syncScrollControls = useCallback(() => {
    const thread = threadRef.current
    if (!thread) {
      lastThreadScrollTopRef.current = 0
      setScrollControlAction(current => (current === null ? current : null))
      return
    }

    const nextAction = getScrollControlAction(
      thread,
      lastThreadScrollTopRef.current,
      scrollControlAction
    )
    lastThreadScrollTopRef.current = thread.scrollTop

    setScrollControlAction(current =>
      current === nextAction ? current : nextAction
    )
  }, [scrollControlAction])

  const scrollThreadToTop = useCallback(() => {
    const thread = threadRef.current
    if (!thread) {
      return
    }

    thread.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const scrollThreadToBottom = useCallback(() => {
    const thread = threadRef.current
    if (!thread) {
      return
    }

    thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (!detail) {
      return
    }
    if (groupedMessages.length <= DETAIL_CHUNK_SIZE) {
      setVisibleCount(groupedMessages.length)
      return
    }
    setVisibleCount(DETAIL_CHUNK_SIZE)
  }, [detail, groupedMessages.length])

  const visibleMessages = useMemo(() => {
    if (groupedMessages.length <= visibleCount) {
      return groupedMessages
    }
    return groupedMessages.slice(groupedMessages.length - visibleCount)
  }, [groupedMessages, visibleCount])

  const renderAssistantContent = useCallback(
    (content: string): string => {
      if (content.includes('\u001b[')) {
        return `<pre class="ansi-output">${ansiConverter.toHtml(content)}</pre>`
      }

      return renderMarkdownContent(content)
    },
    [ansiConverter]
  )

  useLayoutEffect(() => {
    if (!detail) {
      autoScrolledSessionIdRef.current = null
      lastThreadScrollTopRef.current = 0
      setScrollControlAction(null)
      return
    }
    if (focusMessageId) {
      return
    }

    const initialVisibleCount = Math.min(
      groupedMessages.length,
      DETAIL_CHUNK_SIZE
    )
    if (visibleCount !== initialVisibleCount) {
      return
    }
    if (autoScrolledSessionIdRef.current === detail.id) {
      return
    }

    const thread = threadRef.current
    if (!thread) {
      return
    }

    thread.scrollTop = 0
    lastThreadScrollTopRef.current = 0
    syncScrollControls()
    autoScrolledSessionIdRef.current = detail.id
  }, [
    detail,
    focusMessageId,
    groupedMessages.length,
    syncScrollControls,
    visibleCount
  ])

  useEffect(() => {
    const thread = threadRef.current
    if (!thread) {
      lastThreadScrollTopRef.current = 0
      setScrollControlAction(null)
      return
    }

    const handleScroll = (): void => {
      syncScrollControls()
    }

    thread.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', syncScrollControls)
    syncScrollControls()

    return () => {
      thread.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', syncScrollControls)
    }
  }, [detail?.id, syncScrollControls, visibleMessages.length])

  useEffect(() => {
    if (!focusMessageId) {
      return
    }
    const target =
      [
        ...document.querySelectorAll<HTMLElement>(
          'article[data-message-id-list]'
        )
      ].find(entry =>
        (entry.dataset.messageIdList ?? '')
          .split(/\s+/)
          .includes(focusMessageId)
      ) ?? null
    if (!target) {
      if (groupedMessages.length > visibleCount) {
        setVisibleCount(groupedMessages.length)
      }
      return
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target.classList.add('message-focused')
    window.setTimeout(() => {
      target.classList.remove('message-focused')
    }, 1200)
    onFocusedMessageConsumed?.()
  }, [
    detail,
    focusMessageId,
    groupedMessages.length,
    onFocusedMessageConsumed,
    visibleCount
  ])

  if (!detail) {
    return (
      <section className="detail empty-state">
        <h2>Select a session</h2>
        <p>Pick a session from the left sidebar to see details.</p>
      </section>
    )
  }

  return (
    <section className="detail">
      <header className="detail-header">
        <div className="detail-title-wrap">
          <h2 title={detail.title}>{detail.title}</h2>
          <div className="detail-meta">
            <span>Origin: {formatSessionOrigin(detail.source)}</span>
            {detail.agent ? <span>Agent: {detail.agent}</span> : null}
            <span>Model: {normalizeModelLabel(detail.model) || 'Unknown'}</span>
            <span>Updated: {formatTimestampIST(detail.updatedAt)}</span>
            <span>Messages: {detail.messageCount}</span>
          </div>
        </div>
        <button
          type="button"
          className="detail-copy-session-id"
          aria-label="Copy session ID"
          title={`Copy session ID: ${detail.id}`}
          onClick={() => {
            void onCopySessionId?.(detail.id)
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M9 9h10v12H9z" />
            <path d="M5 3h10v3H8v9H5z" />
          </svg>
        </button>
        <TokenUsageBarWithTooltip
          usage={
            detail.tokenUsage ??
            ({
              source: 'unavailable',
              byModel: [],
              totals: {
                inputTokens: 0,
                cachedInputTokens: 0,
                cacheWriteTokens: 0,
                cacheWrite1hTokens: 0,
                outputTokens: 0,
                reasoningTokens: 0
              }
            } satisfies SessionTokenUsage)
          }
          modelLabel={normalizeModelLabel(detail.model)}
        />
      </header>

      <div className="detail-thread-wrap">
        <div ref={threadRef} className="message-thread">
          {groupedMessages.length > visibleMessages.length ? (
            <button
              type="button"
              className="message-load-older"
              onClick={() =>
                setVisibleCount(current =>
                  Math.min(groupedMessages.length, current + DETAIL_CHUNK_SIZE)
                )
              }
            >
              Load older messages (
              {groupedMessages.length - visibleMessages.length} remaining)
            </button>
          ) : null}
          {visibleMessages.map(message => (
            <article
              key={message.id}
              className={`message ${message.role === 'user' ? 'message-user' : 'message-assistant'} ${message.role === 'user' && message.mode ? `message-mode-${message.mode}` : ''}`}
              aria-label={`${message.role} message`}
              data-message-id-list={message.messageIds.join(' ')}
            >
              <div className="message-header">
                <div className="message-role">
                  {message.role === 'user' ? 'You' : formatAgentName(detail.source)}
                  {message.role === 'user' && message.mode ? (
                    <span
                      className={`message-mode-pill message-mode-pill-${message.mode}`}
                    >
                      {formatExecutionMode(message.mode)}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={`message-star ${message.hasStarredMessage ? 'active' : ''}`}
                  aria-label={
                    message.hasStarredMessage
                      ? 'Unstar message'
                      : 'Star message'
                  }
                  title={
                    message.hasStarredMessage
                      ? 'Unstar message'
                      : 'Star message'
                  }
                  onClick={() => {
                    void onToggleMessageStar?.(
                      detail.id,
                      message.primaryMessageId,
                      !message.hasStarredMessage
                    )
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                  </svg>
                </button>
              </div>
              {message.references.length > 0 && (
                <div className="message-artifacts">
                  {message.references.map(reference => {
                    const label =
                      reference.startLine && reference.endLine
                        ? `${toFileLabel(reference.path)}:${reference.startLine}-${reference.endLine}`
                        : toFileLabel(reference.path)
                    return (
                      <span
                        key={`${reference.path}:${reference.startLine ?? ''}:${reference.endLine ?? ''}`}
                        className="message-artifact-chip"
                      >
                        {label}
                      </span>
                    )
                  })}
                </div>
              )}
              {message.edits.length > 0 && (
                <div className="message-artifacts">
                  {message.edits.map(edit => {
                    const lineRange =
                      edit.startLine && edit.endLine
                        ? ` (${edit.startLine}-${edit.endLine})`
                        : ''
                    const added = edit.addedLines ?? 0
                    const removed = edit.removedLines ?? 0
                    const delta =
                      added > 0 || removed > 0 ? ` +${added} -${removed}` : ''
                    return (
                      <span
                        key={`edit:${edit.path}`}
                        className="message-artifact-chip"
                      >
                        Edited {toFileLabel(edit.path)}
                        {delta}
                        {lineRange}
                      </span>
                    )
                  })}
                </div>
              )}
              {message.thinking ? (
                <details className="message-thinking">
                  <summary>Thinking</summary>
                  <div className="message-thinking-content">
                    {message.thinking}
                  </div>
                </details>
              ) : null}
              {message.questions.length > 0 && (
                <div className="message-questions">
                  {message.questions.map((question, index) => {
                    const matchedOption = question.options.find(
                      option => option.label === question.answer
                    )
                    return (
                      <div key={index} className="message-question">
                        <div className="message-question-text">
                          {question.question}
                        </div>
                        {matchedOption ? (
                          <ul className="message-question-options">
                            {question.options.map(option => (
                              <li
                                key={option.label}
                                className={
                                  option.label === question.answer
                                    ? 'message-question-option-selected'
                                    : undefined
                                }
                              >
                                {option.label}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="message-question-answer">
                            {question.answer}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="message-content">
                {message.role === 'assistant' ? (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: renderAssistantContent(message.combinedContent)
                    }}
                  />
                ) : (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: renderUserContent(message.combinedContent)
                    }}
                  />
                )}
              </div>
              <time className="message-time">
                {formatTimestampIST(message.timestamp)}
              </time>
            </article>
          ))}
        </div>
        {scrollControlAction ? (
          <div className="message-thread-scroll-controls">
            <button
              type="button"
              className={`message-thread-scroll-button ${scrollControlAction === 'top' ? 'message-thread-scroll-button-up' : ''}`}
              aria-label={
                scrollControlAction === 'top'
                  ? 'Back to top'
                  : 'Scroll to bottom'
              }
              title={
                scrollControlAction === 'top'
                  ? 'Back to top'
                  : 'Scroll to bottom'
              }
              onClick={
                scrollControlAction === 'top'
                  ? scrollThreadToTop
                  : scrollThreadToBottom
              }
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 16.5a1 1 0 0 1-.7-.29l-5-5 1.4-1.42 4.3 4.3 4.3-4.3 1.4 1.42-5 5a1 1 0 0 1-.7.29Z" />
              </svg>
              <span>
                {scrollControlAction === 'top'
                  ? 'Back to top'
                  : 'Scroll to bottom'}
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

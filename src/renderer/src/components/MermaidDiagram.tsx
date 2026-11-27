import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TranscriptTheme } from './SessionDetailView'
import { copySvgAsPng, downloadSvgAsPng } from './mermaidImage'

type MermaidApi = (typeof import('mermaid'))['default']

let mermaidModulePromise: Promise<MermaidApi> | null = null

const loadMermaid = (): Promise<MermaidApi> => {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then(module => module.default)
    mermaidModulePromise.catch(() => {
      mermaidModulePromise = null
    })
  }
  return mermaidModulePromise
}

// mermaid shares global state (theme + id counters) and is not safe to call
// concurrently, so every render is queued behind the previous one. We also only
// re-initialize when the theme actually changes.
let mermaidRenderChain: Promise<unknown> = Promise.resolve()
let initializedTheme: TranscriptTheme | null = null

const renderMermaid = (
  theme: TranscriptTheme,
  source: string
): Promise<string> => {
  const run = mermaidRenderChain.then(async () => {
    const mermaid = await loadMermaid()
    if (initializedTheme !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        // Without this, a failed render draws mermaid's "bomb" error diagram
        // into a temp node appended to <body> and then throws before cleaning
        // it up, leaving orphaned error graphics stuck on the page. We render
        // our own error state instead (see the 'error' branch below).
        suppressErrorRendering: true,
        theme: theme === 'light' ? 'default' : 'dark'
      })
      initializedTheme = theme
    }
    const renderId = `mermaid-${Math.random().toString(36).slice(2)}`
    const { svg } = await mermaid.render(renderId, source)
    return svg
  })
  // Keep the chain alive regardless of this render's outcome so a single
  // failure doesn't wedge every subsequent diagram.
  mermaidRenderChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

type DiagramState =
  { status: 'pending' } | { status: 'ready'; svg: string } | { status: 'error' }

// Fullscreen lightbox for a rendered diagram. Rendered through a portal so the
// overlay escapes the scrollable message column and covers the whole window.
const MermaidLightbox = ({
  svg,
  theme,
  onClose
}: {
  svg: string
  theme: TranscriptTheme
  onClose: () => void
}) => {
  const overlayRef = useRef<HTMLDivElement>(null)
  type ExportTarget = 'copy' | 'download'
  const [feedback, setFeedback] = useState<{
    target: ExportTarget
    ok: boolean
  } | null>(null)
  const resetTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  const runExport = (
    event: React.MouseEvent,
    target: ExportTarget,
    action: (svg: string, background: string) => Promise<void>
  ): void => {
    event.stopPropagation()
    const background = overlayRef.current
      ? getComputedStyle(overlayRef.current).backgroundColor
      : '#ffffff'
    const showResult = (ok: boolean): void => {
      setFeedback({ target, ok })
      window.clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => setFeedback(null), 2000)
    }
    action(svg, background).then(
      () => showResult(true),
      error => {
        console.error(`Failed to ${target} mermaid diagram as image`, error)
        showResult(false)
      }
    )
  }

  const label = (
    target: ExportTarget,
    idle: string,
    done: string,
    failed: string
  ): string =>
    feedback?.target !== target ? idle : feedback.ok ? done : failed

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={overlayRef}
      className="mermaid-lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded diagram"
      onClick={onClose}
    >
      <div
        className="mermaid-lightbox-toolbar"
        onClick={event => event.stopPropagation()}
      >
        <button
          type="button"
          className="mermaid-lightbox-close"
          aria-label="Download diagram as PNG"
          onClick={event => runExport(event, 'download', downloadSvgAsPng)}
        >
          <span aria-live="polite">
            {label('download', 'Download', 'Saved', 'Download failed')}
          </span>
        </button>
        <button
          type="button"
          className="mermaid-lightbox-close"
          aria-label="Copy diagram as image"
          onClick={event => runExport(event, 'copy', copySvgAsPng)}
        >
          <span aria-live="polite">
            {label('copy', 'Copy image', 'Copied', 'Copy failed')}
          </span>
        </button>
        <button
          type="button"
          className="mermaid-lightbox-close"
          aria-label="Close expanded diagram"
          onClick={onClose}
        >
          <kbd>Esc</kbd>
          <span>to close</span>
        </button>
      </div>
      <div
        className="mermaid-lightbox-content"
        data-mermaid-theme={theme}
        onClick={event => event.stopPropagation()}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>,
    document.body
  )
}

// Renders a single mermaid diagram. The component owns the async render and the
// resulting SVG lives in React state, so re-renders (theme toggles, sync
// refreshes) leave it untouched instead of wiping an imperatively injected node.
export const MermaidDiagram = ({
  source,
  theme
}: {
  source: string
  theme: TranscriptTheme
}) => {
  const [state, setState] = useState<DiagramState>({ status: 'pending' })
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'pending' })

    renderMermaid(theme, source).then(
      svg => {
        if (!cancelled) {
          setState({ status: 'ready', svg })
        }
      },
      error => {
        console.error('Failed to render mermaid diagram', error)
        if (!cancelled) {
          setState({ status: 'error' })
        }
      }
    )

    return () => {
      cancelled = true
    }
  }, [source, theme])

  if (state.status === 'ready') {
    return (
      <>
        <div
          className="mermaid-diagram mermaid-diagram-clickable"
          data-mermaid-theme={theme}
          role="button"
          tabIndex={0}
          title="Click to expand"
          aria-label="Expand diagram"
          onClick={() => setExpanded(true)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setExpanded(true)
            }
          }}
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
        {expanded && (
          <MermaidLightbox
            svg={state.svg}
            theme={theme}
            onClose={() => setExpanded(false)}
          />
        )}
      </>
    )
  }

  if (state.status === 'error') {
    return <div className="mermaid-diagram mermaid-diagram-error">{source}</div>
  }

  return <div className="mermaid-diagram" aria-busy="true" />
}

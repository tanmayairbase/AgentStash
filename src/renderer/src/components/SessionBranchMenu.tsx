import React, { useEffect, useId, useRef, useState } from 'react'
import { formatTimestampIST, toSearchPreview } from '@shared/format'
import type { SessionBranchSummary } from '@shared/types'
import { BranchIcon } from './BranchIcon'

interface Props {
  branches: SessionBranchSummary[]
  selectedBranchId: string
  onSelectBranch?: (branchId: string) => void
}

const formatBranchText = (
  branch: SessionBranchSummary,
  prompt: string
): string => {
  const status = branch.isCurrent ? 'Current' : 'Older'
  return `${status} - ${formatTimestampIST(branch.updatedAt)}${
    prompt ? ` - ${prompt}` : ''
  }`
}

const formatBranchLabel = (branch: SessionBranchSummary): string =>
  formatBranchText(
    branch,
    branch.divergencePrompt
      ? toSearchPreview(branch.divergencePrompt, 56)
      : ''
  )

export const SessionBranchMenu = ({
  branches,
  selectedBranchId,
  onSelectBranch
}: Props) => {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const closeOnOutsideClick = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    const focusFrame = window.requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')
        ?.focus()
    })
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const branchCountLabel = `${branches.length} ${
    branches.length === 1 ? 'branch' : 'branches'
  }`
  const viewingOlderBranch =
    branches.find(branch => branch.id === selectedBranchId)?.isCurrent === false
  const triggerLabel = `Switch conversation branch, ${branchCountLabel}${
    viewingOlderBranch ? ', viewing older branch' : ''
  }`

  return (
    <div ref={rootRef} className="detail-branch-menu">
      <button
        ref={triggerRef}
        type="button"
        className={`detail-header-action detail-branch-trigger${
          viewingOlderBranch ? ' detail-branch-trigger--older' : ''
        }`}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={
          viewingOlderBranch
            ? `Viewing older branch - switch branch (${branchCountLabel})`
            : `Switch conversation branch (${branchCountLabel})`
        }
        onClick={() => setOpen(current => !current)}
      >
        <BranchIcon />
        <span>{branches.length}</span>
      </button>
      {open ? (
        <div
          id={menuId}
          className="detail-branch-menu-popover"
          role="menu"
          onKeyDown={event => {
            if (
              event.key !== 'ArrowDown' &&
              event.key !== 'ArrowUp' &&
              event.key !== 'Home' &&
              event.key !== 'End'
            ) {
              return
            }
            event.preventDefault()
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="menuitemradio"]'
              )
            ]
            const currentIndex = items.indexOf(
              document.activeElement as HTMLButtonElement
            )
            const nextIndex =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : event.key === 'ArrowDown'
                    ? (currentIndex + 1) % items.length
                    : (currentIndex - 1 + items.length) % items.length
            items[nextIndex]?.focus()
          }}
        >
          {branches.map(branch => {
            const selected = branch.id === selectedBranchId
            const fullLabel = formatBranchText(
              branch,
              branch.divergencePrompt ?? ''
            )
            const tooltipId = `${menuId}-${branch.id}-tooltip`
            return (
              <button
                key={branch.id}
                type="button"
                className="detail-branch-menu-item"
                role="menuitemradio"
                aria-checked={selected}
                aria-describedby={tooltipId}
                onClick={() => {
                  onSelectBranch?.(branch.id)
                  setOpen(false)
                  triggerRef.current?.focus()
                }}
              >
                <span className="detail-branch-menu-check" aria-hidden="true">
                  {selected ? '✓' : ''}
                </span>
                <span className="detail-branch-menu-label">
                  {formatBranchLabel(branch)}
                </span>
                <span
                  id={tooltipId}
                  className="detail-branch-menu-tooltip"
                  role="tooltip"
                >
                  {fullLabel}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

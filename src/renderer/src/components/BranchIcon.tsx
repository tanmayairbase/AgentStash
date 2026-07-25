import React from 'react'

interface Props {
  className?: string
}

export const BranchIcon = ({ className }: Props) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="6" cy="5" r="2" />
    <circle cx="18" cy="7" r="2" />
    <circle cx="6" cy="19" r="2" />
    <path d="M6 7v10M8 12h4a6 6 0 0 0 6-3" />
  </svg>
)

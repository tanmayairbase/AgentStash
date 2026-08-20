import React from 'react'

const normalizeCodeSpan = (value: string): string => {
  const normalized = value.replace(/\r?\n/g, ' ')
  if (
    normalized.length >= 2 &&
    normalized.startsWith(' ') &&
    normalized.endsWith(' ') &&
    normalized.trim().length > 0
  ) {
    return normalized.slice(1, -1)
  }
  return normalized
}

export const InlineCodeText = ({
  text,
  allowUnclosedCode = false
}: {
  text: string
  allowUnclosedCode?: boolean
}) => {
  const parts: React.ReactNode[] = []
  const pattern = /(`+)([\s\S]*?)\1/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push(text.slice(cursor, match.index))
    }
    parts.push(
      <code className="inline-code" key={`code-${match.index}`}>
        {normalizeCodeSpan(match[2])}
      </code>
    )
    cursor = pattern.lastIndex
  }

  const remaining = text.slice(cursor)
  if (allowUnclosedCode && text.endsWith('…')) {
    const opening = /`+/.exec(remaining)
    if (opening?.index !== undefined) {
      if (opening.index > 0) {
        parts.push(remaining.slice(0, opening.index))
      }
      parts.push(
        <code className="inline-code" key={`code-${cursor + opening.index}`}>
          {normalizeCodeSpan(
            remaining.slice(opening.index + opening[0].length)
          )}
        </code>
      )
      return <>{parts}</>
    }
  }

  if (remaining) {
    parts.push(remaining)
  }

  return <>{parts}</>
}

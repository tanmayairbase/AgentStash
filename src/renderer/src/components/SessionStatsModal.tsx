import { useEffect, useState, type ReactElement } from 'react'
import type { DateFilterPreset } from '@shared/format'
import type { SessionCostStats } from '@shared/session-stats'

interface Props {
  isOpen: boolean
  stats: SessionCostStats
  dateFilter: DateFilterPreset | ''
  onClose: () => void
}

const INITIAL_MODEL_ROWS = 5

const fmtUsd = (n: number): string => {
  if (n > 0 && n < 0.01) {
    return '<$0.01'
  }
  return `$${n.toFixed(2)}`
}

const dateFilterLabel = (value: DateFilterPreset | ''): string => {
  switch (value) {
    case 'today':
      return 'Today'
    case 'yesterday':
      return 'Yesterday'
    case 'last7':
      return 'Last 7 days'
    case 'last14':
      return 'Last 14 days'
    case 'last30':
      return 'Last 30 days'
    default:
      return 'All dates'
  }
}

export const SessionStatsModal = ({
  isOpen,
  stats,
  dateFilter,
  onClose
}: Props): ReactElement | null => {
  const [showAllModels, setShowAllModels] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setShowAllModels(false)
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  const hiddenModelCount = Math.max(0, stats.models.length - INITIAL_MODEL_ROWS)
  const visibleModels = showAllModels
    ? stats.models
    : stats.models.slice(0, INITIAL_MODEL_ROWS)

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Session stats"
    >
      <div className="modal stats-modal">
        <h3>Stats</h3>
        <p>
          Current filtered sessions. Range: {dateFilterLabel(dateFilter)}. Date
          basis: last activity in IST.
        </p>

        <div className="stats-summary-grid">
          <article className="stats-card">
            <span className="stats-card__label">Est. cost</span>
            <strong className="stats-card__value" data-testid="stats-total-cost">
              {fmtUsd(stats.totalCostUsd)}
            </strong>
          </article>
          <article className="stats-card">
            <span className="stats-card__label">Sessions</span>
            <strong
              className="stats-card__value"
              data-testid="stats-session-count"
            >
              {stats.sessionCount}
            </strong>
          </article>
          <article className="stats-card">
            <span className="stats-card__label">Unpriced</span>
            <strong
              className="stats-card__value"
              data-testid="stats-unpriced-session-count"
            >
              {stats.unpricedSessionCount}
            </strong>
          </article>
          <article className="stats-card">
            <span className="stats-card__label">Avg priced session</span>
            <strong
              className="stats-card__value"
              data-testid="stats-average-cost"
            >
              {stats.averageCostUsd === null ? '—' : fmtUsd(stats.averageCostUsd)}
            </strong>
          </article>
        </div>

        {stats.unpricedSessionCount > 0 && (
          <p className="stats-note">
            Unpriced sessions stay out of cost totals and averages.
          </p>
        )}

        <section className="stats-section">
          <div className="stats-section__header">
            <h4>By model</h4>
            <span>{stats.models.length} priced models</span>
          </div>

          {stats.models.length === 0 ? (
            <p>No priced models in current view.</p>
          ) : (
            <div className="stats-model-list">
              {visibleModels.map(model => (
                <article
                  key={model.modelId}
                  className="stats-model-row"
                  data-testid={`stats-model-${model.modelId}`}
                >
                  <div className="stats-model-row__primary">
                    <strong>{model.modelId}</strong>
                    <span>{model.sessionCount} sessions</span>
                  </div>
                  <span className="stats-model-row__cost">
                    {fmtUsd(model.totalCostUsd)}
                  </span>
                </article>
              ))}
              {hiddenModelCount > 0 && (
                <button
                  type="button"
                  className="stats-model-toggle"
                  onClick={() => setShowAllModels(current => !current)}
                >
                  {showAllModels
                    ? 'Show less'
                    : `Show more (${hiddenModelCount} more)`}
                </button>
              )}
            </div>
          )}
        </section>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

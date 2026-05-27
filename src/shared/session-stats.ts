import { computeCost } from './pricing'
import type { SessionSummary } from './types'

export interface ModelCostStat {
  modelId: string
  totalCostUsd: number
  sessionCount: number
}

export interface SessionCostStats {
  sessionCount: number
  pricedSessionCount: number
  unpricedSessionCount: number
  totalCostUsd: number
  averageCostUsd: number | null
  models: ModelCostStat[]
}

export const aggregateSessionCostStats = (
  sessions: SessionSummary[]
): SessionCostStats => {
  const modelTotals = new Map<
    string,
    { totalCostUsd: number; sessionIds: Set<string> }
  >()
  let pricedSessionCount = 0
  let unpricedSessionCount = 0
  let totalCostUsd = 0

  for (const session of sessions) {
    const usage = session.tokenUsage
    if (!usage || usage.source === 'unavailable') {
      unpricedSessionCount += 1
      continue
    }

    let sessionHasPricedModel = false
    for (const model of usage.byModel) {
      const cost = computeCost(model)
      if (cost === null) {
        continue
      }

      sessionHasPricedModel = true
      totalCostUsd += cost
      const current = modelTotals.get(model.modelId) ?? {
        totalCostUsd: 0,
        sessionIds: new Set<string>()
      }
      current.totalCostUsd += cost
      current.sessionIds.add(session.id)
      modelTotals.set(model.modelId, current)
    }

    if (sessionHasPricedModel) {
      pricedSessionCount += 1
    } else {
      unpricedSessionCount += 1
    }
  }

  const models = [...modelTotals.entries()]
    .map(([modelId, value]) => ({
      modelId,
      totalCostUsd: value.totalCostUsd,
      sessionCount: value.sessionIds.size
    }))
    .sort(
      (left, right) =>
        right.totalCostUsd - left.totalCostUsd ||
        right.sessionCount - left.sessionCount ||
        left.modelId.localeCompare(right.modelId)
    )

  return {
    sessionCount: sessions.length,
    pricedSessionCount,
    unpricedSessionCount,
    totalCostUsd,
    averageCostUsd:
      pricedSessionCount > 0 ? totalCostUsd / pricedSessionCount : null,
    models
  }
}

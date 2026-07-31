import type { ReactElement } from 'react'
import type { SessionTokenUsage } from '../../../shared/types'
import { TokenUsageBar } from './TokenUsageBar'
import { TokenUsageTooltipContent } from './TokenUsageTooltipContent'

export interface TokenUsageBarWithTooltipProps {
  usage: SessionTokenUsage
  modelLabel: string | null
  familyUsage?: SessionTokenUsage
}

export function TokenUsageBarWithTooltip({
  usage,
  modelLabel,
  familyUsage
}: TokenUsageBarWithTooltipProps): ReactElement {
  return (
    <div className="token-usage-bar-host">
      <TokenUsageBar usage={usage} modelLabel={modelLabel} />
      <div className="token-usage-bar-tooltip" role="presentation">
        {familyUsage ? (
          <div className="token-tooltip__scope">Current session</div>
        ) : null}
        <TokenUsageTooltipContent usage={usage} />
        {familyUsage ? (
          <div className="token-tooltip__family">
            <div className="token-tooltip__scope">Conversation total</div>
            <TokenUsageTooltipContent usage={familyUsage} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

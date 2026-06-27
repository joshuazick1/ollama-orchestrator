import { Card } from '../components/ui/card';
import { cn } from '../lib/utils';

export interface TokenUsageData {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface TokenUsageCardProps {
  usage: TokenUsageData | null;
  className?: string;
}

export const TokenUsageCard = ({ usage, className }: TokenUsageCardProps) => {
  if (!usage) {
    return null;
  }

  return (
    <Card className={cn('p-3', className)}>
      <div className="text-xs text-text-subtle mb-2">Token Usage</div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-semibold">{usage.prompt_tokens ?? 0}</div>
          <div className="text-xs text-text-subtle">Prompt</div>
        </div>
        <div>
          <div className="text-lg font-semibold">{usage.completion_tokens ?? 0}</div>
          <div className="text-xs text-text-subtle">Completion</div>
        </div>
        <div>
          <div className="text-lg font-semibold">{usage.total_tokens ?? 0}</div>
          <div className="text-xs text-text-subtle">Total</div>
        </div>
      </div>
    </Card>
  );
};

export default TokenUsageCard;

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Badge } from "@stdui/react";

interface SentimentBadgeProps {
  sentiment: number;
}

export function SentimentBadge({ sentiment }: SentimentBadgeProps) {
  const color = sentiment > 0.3 ? "success" as const : sentiment < -0.3 ? "danger" as const : "secondary" as const;
  const Icon = sentiment > 0.3 ? TrendingUp : sentiment < -0.3 ? TrendingDown : Minus;
  const label = sentiment > 0.3 ? "positive" : sentiment < -0.3 ? "negative" : "neutral";

  return (
    <Badge variant="soft" color={color} className="text-[10px] gap-0.5">
      <Icon className="h-3 w-3" />
      {label} ({sentiment > 0 ? "+" : ""}{sentiment.toFixed(1)})
    </Badge>
  );
}

interface ConfidenceBadgeProps {
  confidence: number;
}

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 70 ? "primary" as const : pct >= 40 ? "warning" as const : "secondary" as const;

  return (
    <Badge variant="soft" color={color} className="text-[10px]">
      {pct}% confidence
    </Badge>
  );
}

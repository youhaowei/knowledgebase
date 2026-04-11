import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Badge } from "@stdui/react";

interface SentimentBadgeProps {
  sentiment: number;
}

function getSentimentDisplay(sentiment: number) {
  if (sentiment > 0.3) {
    return {
      color: "success" as const,
      Icon: TrendingUp,
      label: "positive",
    };
  }
  if (sentiment < -0.3) {
    return {
      color: "danger" as const,
      Icon: TrendingDown,
      label: "negative",
    };
  }
  return {
    color: "secondary" as const,
    Icon: Minus,
    label: "neutral",
  };
}

function getConfidenceColor(confidence: number) {
  const pct = Math.round(confidence * 100);
  if (pct >= 70) return "primary" as const;
  if (pct >= 40) return "warning" as const;
  return "secondary" as const;
}

export function SentimentBadge({ sentiment }: SentimentBadgeProps) {
  const { color, Icon, label } = getSentimentDisplay(sentiment);

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
  const color = getConfidenceColor(confidence);

  return (
    <Badge variant="soft" color={color} className="text-[10px]">
      {pct}% confidence
    </Badge>
  );
}

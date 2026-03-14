import { useTranslation } from "react-i18next";
import { Shield, ShieldAlert, ShieldQuestion, ShieldX } from "lucide-react";
import type { ConfidenceTier } from "@/types/api";
import { cn } from "@/utils/cn";
import { confidenceBadgeClass } from "@/utils/format";

interface ConfidenceBadgeProps {
  tier: ConfidenceTier;
  score?: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

const icons: Record<ConfidenceTier, React.ElementType> = {
  high: Shield,
  medium: ShieldAlert,
  low: ShieldX,
  insufficient_data: ShieldQuestion,
};

export function ConfidenceBadge({
  tier,
  score,
  size = "md",
  showLabel = true,
}: ConfidenceBadgeProps) {
  const { t } = useTranslation();
  const Icon = icons[tier];

  const sizeClasses = {
    sm: "text-2xs px-1.5 py-0.5 gap-1",
    md: "text-xs px-2 py-0.5 gap-1.5",
    lg: "text-sm px-2.5 py-1 gap-2",
  };

  const iconSizes = {
    sm: "w-3 h-3",
    md: "w-3.5 h-3.5",
    lg: "w-4 h-4",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-full",
        confidenceBadgeClass[tier],
        sizeClasses[size]
      )}
      title={score !== undefined ? `Score: ${(score * 100).toFixed(0)}%` : undefined}
    >
      <Icon className={iconSizes[size]} />
      {showLabel && <span>{t(`question.confidence.${tier}`)}</span>}
      {score !== undefined && (
        <span className="opacity-75">{(score * 100).toFixed(0)}%</span>
      )}
    </span>
  );
}

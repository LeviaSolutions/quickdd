import { cn } from "@/utils/cn";

interface ProgressBarProps {
  value: number; // 0-100
  className?: string;
  size?: "sm" | "md" | "lg";
  color?: "brand" | "green" | "amber" | "red";
  showLabel?: boolean;
}

const colorMap = {
  brand: "bg-brand-600",
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

const sizeMap = {
  sm: "h-1",
  md: "h-2",
  lg: "h-3",
};

export function ProgressBar({
  value,
  className,
  size = "md",
  color = "brand",
  showLabel = false,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className={cn(
          "flex-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden",
          sizeMap[size]
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            colorMap[color]
          )}
          style={{ width: `${clamped}%` }}
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums min-w-[3ch] text-right">
          {Math.round(clamped)}%
        </span>
      )}
    </div>
  );
}

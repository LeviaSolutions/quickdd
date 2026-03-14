import { cn } from "@/utils/cn";

interface TrafficLightProps {
  status: "green" | "amber" | "red";
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
}

const colorMap = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

const sizeMap = {
  sm: "w-2.5 h-2.5",
  md: "w-3.5 h-3.5",
  lg: "w-5 h-5",
};

export function TrafficLight({
  status,
  size = "md",
  pulse = false,
}: TrafficLightProps) {
  return (
    <span
      className={cn(
        "inline-block rounded-full",
        colorMap[status],
        sizeMap[size],
        pulse && status === "red" && "animate-pulse-slow"
      )}
      role="img"
      aria-label={status}
    />
  );
}

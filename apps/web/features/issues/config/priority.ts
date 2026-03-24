import type { IssuePriority } from "@multica/types";

export const PRIORITY_ORDER: IssuePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

export const PRIORITY_CONFIG: Record<
  IssuePriority,
  { label: string; bars: number; color: string }
> = {
  urgent: { label: "Urgent", bars: 4, color: "text-destructive" },
  high: { label: "High", bars: 3, color: "text-warning" },
  medium: { label: "Medium", bars: 2, color: "text-warning" },
  low: { label: "Low", bars: 1, color: "text-info" },
  none: { label: "No priority", bars: 0, color: "text-muted-foreground" },
};

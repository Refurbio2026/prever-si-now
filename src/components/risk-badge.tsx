import { Badge } from "@/components/ui/badge";
import type { RiskLevel } from "@/lib/types";

const config: Record<RiskLevel, { label: string; className: string }> = {
  low: { label: "Nízke riziko", className: "bg-success/15 text-success hover:bg-success/20" },
  medium: { label: "Stredné riziko", className: "bg-warning/25 text-warning-foreground hover:bg-warning/30" },
  high: { label: "Vysoké riziko", className: "bg-destructive/15 text-destructive hover:bg-destructive/20" },
};

export function RiskBadge({ level, className = "" }: { level: RiskLevel; className?: string }) {
  const c = config[level];
  return (
    <Badge variant="secondary" className={`rounded-full border-0 ${c.className} ${className}`}>
      {c.label}
    </Badge>
  );
}

export function riskLevelFromScore(score: number | undefined): RiskLevel {
  if (score === undefined || score === null) return "medium";
  if (score >= 75) return "low";
  if (score >= 50) return "medium";
  return "high";
}

export function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} mld €`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} mil €`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)} tis €`;
  return `${value.toLocaleString("sk-SK")} €`;
}

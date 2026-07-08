import type { ChangeSeverity } from "@/lib/monitoring.functions";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";

const META: Record<ChangeSeverity, { label: string; className: string; Icon: typeof Info }> = {
  info: {
    label: "Info",
    className: "bg-primary/10 text-primary border-primary/20",
    Icon: Info,
  },
  warning: {
    label: "Upozornenie",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    Icon: AlertTriangle,
  },
  critical: {
    label: "Kritické",
    className: "bg-destructive/15 text-destructive border-destructive/30",
    Icon: ShieldAlert,
  },
};

export function SeverityBadge({ severity }: { severity: ChangeSeverity }) {
  const meta = META[severity];
  const Icon = meta.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.className}`}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

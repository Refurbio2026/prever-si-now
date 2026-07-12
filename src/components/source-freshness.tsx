// Small header widget for section cards that stream from external registers.
// Sources like FS SR publish periodic snapshots (monthly), while our importer
// checks every night. Showing both dates makes the distinction obvious:
//
//   Údaje k: 31. 5. 2026 (zdroj FS)
//   Naposledy overené: 11. 7. 2026
//
// If `sourceDate` and `lastCheckedAt` fall on the same day we collapse to a
// single line to avoid noise.

function fmt(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  try {
    return new Date(v).toLocaleDateString("sk-SK");
  } catch {
    return typeof v === "string" ? v : null;
  }
}

function sameDay(a: string | Date | null | undefined, b: string | Date | null | undefined): boolean {
  if (!a || !b) return false;
  try {
    const da = new Date(a);
    const db = new Date(b);
    return (
      da.getFullYear() === db.getFullYear() &&
      da.getMonth() === db.getMonth() &&
      da.getDate() === db.getDate()
    );
  } catch {
    return false;
  }
}

export function SourceFreshness({
  sourceDate,
  sourceLabel,
  lastCheckedAt,
  className = "",
}: {
  /** The `record_date` published by the upstream register (snapshot date). */
  sourceDate: string | Date | null | undefined;
  /** Short label for the upstream register, e.g. "FS" or "SP". */
  sourceLabel?: string;
  /** Our `data_freshness.last_success_at` — when our importer last verified. */
  lastCheckedAt: string | Date | null | undefined;
  className?: string;
}) {
  const src = fmt(sourceDate);
  const checked = fmt(lastCheckedAt);
  if (!src && !checked) return null;

  // Fall back to a single line when we only have one date, or when they
  // coincide (importer ran on the same day as the source snapshot).
  const primary = src ?? checked;
  const showBoth = src && checked && !sameDay(sourceDate, lastCheckedAt);

  return (
    <div className={`flex flex-col items-end text-right leading-tight ${className}`}>
      <span className="whitespace-nowrap text-[11px] text-muted-foreground">
        Údaje k: {primary}
        {src && sourceLabel ? ` (zdroj ${sourceLabel})` : ""}
      </span>
      {showBoth && (
        <span className="whitespace-nowrap text-[10.5px] text-muted-foreground/70">
          Naposledy overené: {checked}
        </span>
      )}
    </div>
  );
}

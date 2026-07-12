import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";

export function Logo({
  className = "",
  tone = "dark",
}: {
  className?: string;
  tone?: "dark" | "light";
}) {
  const wordmarkColor = tone === "light" ? "text-cream" : "text-foreground";
  const mutedColor = tone === "light" ? "text-cream/60" : "text-ink-muted";
  return (
    <Link to="/" className={`inline-flex items-center gap-2.5 ${className}`}>
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary text-primary-foreground">
        <ShieldCheck className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </span>
      <span className={`font-serif text-[17px] font-medium tracking-tight ${wordmarkColor}`}>
        preversi<span className={mutedColor}>.sk</span>
      </span>
    </Link>
  );
}

import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`inline-flex items-center gap-2 font-display font-bold text-lg ${className}`}>
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[image:var(--gradient-primary)] text-primary-foreground shadow-soft">
        <ShieldCheck className="h-4 w-4" />
      </span>
      <span>
        Prever<span className="text-primary">Si</span>
        <span className="text-muted-foreground font-medium">.sk</span>
      </span>
    </Link>
  );
}

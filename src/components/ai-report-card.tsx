import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Loader2, ShieldCheck, ShieldAlert, ShieldX, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getAiReportFn, type Recommendation } from "@/lib/ai-report.functions";

interface AiReportCardProps {
  ico: string;
}

const RECO_META: Record<Recommendation, { label: string; className: string; Icon: typeof ShieldCheck }> = {
  "LOW RISK": {
    label: "Nízke riziko",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    Icon: ShieldCheck,
  },
  "MEDIUM RISK": {
    label: "Stredné riziko",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    Icon: ShieldAlert,
  },
  "HIGH RISK": {
    label: "Vysoké riziko",
    className: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
    Icon: ShieldX,
  },
};

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{value}/100</span>
      </div>
      <Progress value={value} className="h-2" />
    </div>
  );
}

export function AiReportCard({ ico }: AiReportCardProps) {
  const fetchReport = useServerFn(getAiReportFn);
  const query = useQuery({
    queryKey: ["ai-report", ico],
    queryFn: () => fetchReport({ data: { ico } }),
    staleTime: 30 * 60_000,
    retry: false,
  });

  if (query.isLoading) {
    return (
      <Card className="overflow-hidden rounded-2xl border-primary/20 shadow-soft">
        <div className="bg-[image:var(--gradient-primary)] px-6 py-4">
          <div className="flex items-center gap-2 text-primary-foreground">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-semibold">AI Business Intelligence</span>
          </div>
        </div>
        <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Generujem exekutívne zhrnutie…
        </div>
      </Card>
    );
  }

  if (query.isError || !query.data || !query.data.ok) {
    const message =
      (query.data && !query.data.ok && query.data.error) ||
      (query.error as Error | undefined)?.message ||
      "AI zhrnutie sa momentálne nedá vygenerovať.";
    return (
      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" />
          AI Business Intelligence
        </div>
        <p className="text-sm text-muted-foreground">{message}</p>
      </Card>
    );
  }

  const report = query.data.data;
  const reco = RECO_META[report.recommendation];
  const RecoIcon = reco.Icon;

  return (
    <Card className="overflow-hidden rounded-2xl border-primary/20 shadow-soft">
      <div className="bg-[image:var(--gradient-primary)] px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-primary-foreground">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-semibold">AI Business Intelligence</span>
            <Badge variant="secondary" className="ml-1 bg-white/15 text-primary-foreground hover:bg-white/20">
              {query.data.source === "cache" ? "z vyrovnávacej pamäte" : "novo vygenerované"}
            </Badge>
          </div>
          <div
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${reco.className}`}
          >
            <RecoIcon className="h-3.5 w-3.5" />
            {reco.label}
          </div>
        </div>
      </div>

      <div className="space-y-5 p-6">
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">{report.summary}</p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ScoreBar label="Celkové skóre" value={report.overallScore} />
          <ScoreBar label="Finančné zdravie" value={report.financialScore} />
          <ScoreBar label="Rast" value={report.growthScore} />
          <ScoreBar label="Verejný sektor" value={report.publicScore} />
        </div>

        {(report.strengths.length > 0 ||
          report.weaknesses.length > 0 ||
          report.warnings.length > 0) && (
          <div className="grid gap-4 md:grid-cols-3">
            {report.strengths.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Silné stránky
                </div>
                <ul className="space-y-1 text-sm text-foreground">
                  {report.strengths.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.weaknesses.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  <XCircle className="h-3.5 w-3.5" /> Slabé stránky
                </div>
                <ul className="space-y-1 text-sm text-foreground">
                  {report.weaknesses.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.warnings.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
                  <AlertTriangle className="h-3.5 w-3.5" /> Upozornenia
                </div>
                <ul className="space-y-1 text-sm text-foreground">
                  {report.warnings.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-red-500" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          AI zhrnutie dopĺňa verejné údaje. Generované {new Date(report.generatedAt).toLocaleString("sk-SK")} • platnosť 30 dní.
        </p>
      </div>
    </Card>
  );
}

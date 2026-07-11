import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, CheckCircle2, X, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  getTaxDebtMatchStatsFn,
  listUnmatchedTaxDebtorsFn,
  matchTaxDebtorFn,
  ignoreTaxDebtorFn,
} from "@/lib/tax-debt.functions";

export const Route = createFileRoute("/admin/datahub/tax-matching")({
  component: TaxMatchingPage,
  head: () => ({
    meta: [
      { title: "Daňoví dlžníci — párovanie — PreverSi.sk" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function formatEur(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("sk-SK", { style: "currency", currency: "EUR" }).format(n);
}
function formatDate(v: string | null): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("sk-SK");
  } catch {
    return v;
  }
}

function TaxMatchingPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [manualIco, setManualIco] = useState<Record<string, string>>({});

  const fetchStats = useServerFn(getTaxDebtMatchStatsFn);
  const fetchList = useServerFn(listUnmatchedTaxDebtorsFn);
  const runMatch = useServerFn(matchTaxDebtorFn);
  const runIgnore = useServerFn(ignoreTaxDebtorFn);

  const stats = useQuery({
    queryKey: ["tax-debt-match-stats"],
    queryFn: () => fetchStats(),
    refetchInterval: 30_000,
  });
  const list = useQuery({
    queryKey: ["tax-debt-unmatched", search],
    queryFn: () => fetchList({ data: { search: search || undefined, limit: 50, offset: 0 } }),
  });

  const matchMut = useMutation({
    mutationFn: (input: { id: string; ico: string }) =>
      runMatch({ data: { unmatchedId: input.id, ico: input.ico } }),
    onSuccess: () => {
      toast.success("Priradené.");
      qc.invalidateQueries({ queryKey: ["tax-debt-match-stats"] });
      qc.invalidateQueries({ queryKey: ["tax-debt-unmatched"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Chyba"),
  });
  const ignoreMut = useMutation({
    mutationFn: (id: string) => runIgnore({ data: { unmatchedId: id } }),
    onSuccess: () => {
      toast.success("Ignorované.");
      qc.invalidateQueries({ queryKey: ["tax-debt-match-stats"] });
      qc.invalidateQueries({ queryKey: ["tax-debt-unmatched"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Chyba"),
  });

  const s = stats.data;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Daňoví dlžníci — párovanie</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Oficiálny dataset FS neobsahuje IČO. Priraďovanie prebieha podľa názvu a adresy.
          </p>
        </div>
        <Link
          to="/admin/datahub"
          className="text-sm text-primary hover:underline"
        >
          ← Späť na DataHub
        </Link>
      </div>

      {/* Summary */}
      <Card className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-5">
        <SummaryCell label="Spolu" value={s?.totalRecords ?? "—"} />
        <SummaryCell label="Presná zhoda" value={s?.matchedExact ?? "—"} tone="good" />
        <SummaryCell label="Fuzzy zhoda" value={s?.matchedFuzzy ?? "—"} tone="warn" />
        <SummaryCell label="Manuálne" value={s?.matchedManual ?? "—"} />
        <SummaryCell label="Nespárované" value={s?.unmatched ?? "—"} tone="bad" />
        <div className="col-span-2 text-xs text-muted-foreground sm:col-span-5">
          Údaje k: {formatDate(s?.sourceRecordDate ?? null)} · Posledný beh:{" "}
          {s?.lastRunAt ? new Date(s.lastRunAt).toLocaleString("sk-SK") : "—"}
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Nespárované záznamy</h2>
          <Input
            placeholder="Hľadať podľa názvu…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>

        {list.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Načítavam…
          </div>
        ) : list.isError ? (
          <div className="text-sm text-destructive">
            Chyba: {list.error instanceof Error ? list.error.message : "unknown"}
          </div>
        ) : !list.data?.items.length ? (
          <div className="text-sm text-muted-foreground">Žiadne nespárované záznamy.</div>
        ) : (
          <div className="flex flex-col divide-y divide-border/60">
            {list.data.items.map((row) => (
              <div key={row.id} className="flex flex-col gap-3 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{row.debtorNameRaw}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {row.addressRaw ?? "—"}
                    </div>
                    <div className="mt-1 text-xs">
                      Dlh: <span className="font-medium">{formatEur(row.amount)}</span> · Údaje k:{" "}
                      {formatDate(row.sourceRecordDate)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex items-center gap-1">
                      <Input
                        placeholder="IČO"
                        value={manualIco[row.id] ?? ""}
                        onChange={(e) =>
                          setManualIco((m) => ({ ...m, [row.id]: e.target.value }))
                        }
                        className="w-28"
                      />
                      <Button
                        size="sm"
                        onClick={() => {
                          const ico = (manualIco[row.id] ?? "").trim();
                          if (!/^\d{6,8}$/.test(ico)) {
                            toast.error("Neplatné IČO");
                            return;
                          }
                          matchMut.mutate({ id: row.id, ico });
                        }}
                        disabled={matchMut.isPending}
                      >
                        Spárovať
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => ignoreMut.mutate(row.id)}
                      disabled={ignoreMut.isPending}
                    >
                      <X className="mr-1 h-3.5 w-3.5" /> Ignorovať
                    </Button>
                  </div>
                </div>

                {row.candidates.length > 0 && (
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="mb-2 text-[11px] font-medium uppercase text-muted-foreground">
                      Navrhované zhody
                    </div>
                    <div className="flex flex-col gap-1">
                      {row.candidates.map((c) => (
                        <div
                          key={c.ico}
                          className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-background"
                        >
                          <div className="flex-1 text-xs">
                            <span className="font-mono">{c.ico}</span> · {c.nameNormalized}{" "}
                            {c.psc && <span className="text-muted-foreground">· {c.psc}</span>}
                          </div>
                          <Badge variant="secondary">
                            {(c.similarity * 100).toFixed(0)}%
                          </Badge>
                          <Link
                            to="/company/$ico"
                            params={{ ico: c.ico }}
                            className="text-xs text-primary hover:underline"
                            target="_blank"
                          >
                            <ExternalLink className="inline h-3 w-3" />
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => matchMut.mutate({ id: row.id, ico: c.ico })}
                            disabled={matchMut.isPending}
                          >
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Použiť
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "good" | "warn" | "bad";
}) {
  const color =
    tone === "good"
      ? "text-success"
      : tone === "warn"
        ? "text-warning-foreground"
        : tone === "bad"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div>
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

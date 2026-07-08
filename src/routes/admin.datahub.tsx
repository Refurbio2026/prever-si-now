import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Loader2,
  PlayCircle,
  RotateCw,
  Search,
  Trash2,
  Upload,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ALL_SOURCES,
  type ImportSourceId,
  type BatchProgress,
  clearSuccessFn,
  enqueueImportsFn,
  getQueueItemsFn,
  getQueueStatsFn,
  processImportQueueFn,
  retryFailedFn,
  searchAndEnqueueFn,
} from "@/lib/datahub.functions";

export const Route = createFileRoute("/admin/datahub")({
  component: DataHubPage,
  head: () => ({
    meta: [
      { title: "DataHub — PreverSi.sk" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

const SOURCE_LABELS: Record<ImportSourceId, string> = {
  finstat: "Finstat detail",
  ruz: "RÚZ výkazy",
  rpvs: "RPVS partneri",
  crz: "CRZ zmluvy",
  registry: "ORSR registry",
  people: "ORSR osoby",
  history: "ORSR história",
  ai: "AI report",
};

function DataHubPage() {
  const qc = useQueryClient();
  const [icosText, setIcosText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSources, setSelectedSources] = useState<ImportSourceId[]>([
    ...ALL_SOURCES,
  ]);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [lastBatch, setLastBatch] = useState<BatchProgress | null>(null);

  const runEnqueue = useServerFn(enqueueImportsFn);
  const runSearch = useServerFn(searchAndEnqueueFn);
  const runProcess = useServerFn(processImportQueueFn);
  const runRetry = useServerFn(retryFailedFn);
  const runClear = useServerFn(clearSuccessFn);
  const fetchStats = useServerFn(getQueueStatsFn);
  const fetchItems = useServerFn(getQueueItemsFn);

  const stats = useQuery({
    queryKey: ["datahub-stats"],
    queryFn: () => fetchStats(),
    refetchInterval: 3000,
  });
  const failed = useQuery({
    queryKey: ["datahub-items", "failed"],
    queryFn: () => fetchItems({ data: { status: "failed", limit: 25 } }),
    refetchInterval: 5000,
  });
  const recent = useQuery({
    queryKey: ["datahub-items", "recent"],
    queryFn: () => fetchItems({ data: { limit: 30 } }),
    refetchInterval: 3000,
  });

  const parsedIcos = useMemo(
    () =>
      Array.from(
        new Set(
          icosText
            .split(/[\s,;]+/)
            .map((s) => s.trim())
            .filter((s) => /^\d{6,8}$/.test(s)),
        ),
      ),
    [icosText],
  );

  function refreshAll() {
    qc.invalidateQueries({ queryKey: ["datahub-stats"] });
    qc.invalidateQueries({ queryKey: ["datahub-items"] });
  }

  const enqueueMut = useMutation({
    mutationFn: () =>
      runEnqueue({
        data: {
          icos: parsedIcos,
          sources: selectedSources,
          priority: 5,
          forceRefresh,
        },
      }),
    onSuccess: (r) => {
      toast.success(
        `Zaradené ${r.enqueued} úloh (preskočené duplicity: ${r.skippedDuplicates}).`,
      );
      refreshAll();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const searchMut = useMutation({
    mutationFn: () =>
      runSearch({
        data: {
          query: searchQuery.trim(),
          sources: selectedSources,
          priority: 5,
          forceRefresh,
          limit: 10,
        },
      }),
    onSuccess: (r) => {
      toast.success(
        `Nájdených ${r.matched.length}, zaradených ${r.enqueued} úloh (preskočené: ${r.skippedDuplicates}).`,
      );
      refreshAll();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const processMut = useMutation({
    mutationFn: (limit: number) => runProcess({ data: { limit } }),
    onSuccess: (r) => {
      setLastBatch(r);
      toast.success(
        `Dávka: ${r.processed} spracovaných, ${r.successful} úspešných, ${r.failed} neúspešných, ${r.skipped} preskočených.`,
      );
      refreshAll();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const retryMut = useMutation({
    mutationFn: () => runRetry(),
    onSuccess: (r) => {
      toast.success(`Znovu zaradených ${r.requeued} úloh.`);
      refreshAll();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const clearMut = useMutation({
    mutationFn: () => runClear(),
    onSuccess: (r) => {
      toast.success(`Vyčistených ${r.deleted} úspešných úloh.`);
      refreshAll();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const busy =
    enqueueMut.isPending ||
    searchMut.isPending ||
    processMut.isPending ||
    retryMut.isPending ||
    clearMut.isPending;

  function toggleSource(s: ImportSourceId) {
    setSelectedSources((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Technická diagnostika importov</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          PreverSi importuje údaje automaticky pri návšteve profilu firmy. Táto stránka
          slúži iba na manuálne diagnostikovanie a opravu importov. Iba pre adminov.
        </p>
      </div>

      {/* Source picker + options */}
      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <h2 className="text-lg font-semibold">Zdroje</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {ALL_SOURCES.map((s) => {
            const active = selectedSources.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleSource(s)}
                className={`rounded-xl border px-3 py-1.5 text-sm transition ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/70 text-muted-foreground hover:border-primary/40"
                }`}
              >
                {SOURCE_LABELS[s]}
              </button>
            );
          })}
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <Checkbox
            checked={forceRefresh}
            onCheckedChange={(v) => setForceRefresh(v === true)}
          />
          Vynútiť refresh cache
        </label>
      </Card>

      {/* A. Import by IČO */}
      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <h2 className="text-lg font-semibold">Import podľa IČO</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Jedno IČO na riadok (alebo oddelené čiarkou/medzerou). Rozpoznaných: {parsedIcos.length}.
        </p>
        <Textarea
          value={icosText}
          onChange={(e) => setIcosText(e.target.value)}
          placeholder="35815256\n31333532"
          rows={6}
          className="mt-3 font-mono"
        />
        <div className="mt-3 flex justify-end">
          <Button
            onClick={() => enqueueMut.mutate()}
            disabled={
              busy || parsedIcos.length === 0 || selectedSources.length === 0
            }
            className="rounded-xl"
          >
            {enqueueMut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Importovať firmy
          </Button>
        </div>
      </Card>

      {/* B. Import from search */}
      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <h2 className="text-lg font-semibold">Import z vyhľadávania</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Vyhľadá cez Finstat a zaradí top 10 výsledkov do fronty pre vybrané zdroje.
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="napr. Slovnaft"
          />
          <Button
            onClick={() => searchMut.mutate()}
            disabled={busy || searchQuery.trim().length < 2 || selectedSources.length === 0}
            className="rounded-xl"
          >
            {searchMut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Vyhľadať a importovať
          </Button>
        </div>
      </Card>

      {/* D. Queue UI */}
      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Fronta importov</h2>
          {stats.isFetching && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Pending" value={stats.data?.pending ?? 0} tone="muted" />
          <StatCard label="Running" value={stats.data?.running ?? 0} tone="info" />
          <StatCard label="Success" value={stats.data?.success ?? 0} tone="success" />
          <StatCard label="Failed" value={stats.data?.failed ?? 0} tone="danger" />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={() => processMut.mutate(10)}
            disabled={busy}
            className="rounded-xl"
          >
            {processMut.isPending && processMut.variables === 10 ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="mr-2 h-4 w-4" />
            )}
            Spustiť ďalších 10
          </Button>
          <Button
            onClick={() => processMut.mutate(50)}
            disabled={busy}
            variant="outline"
            className="rounded-xl"
          >
            {processMut.isPending && processMut.variables === 50 ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="mr-2 h-4 w-4" />
            )}
            Spustiť ďalších 50
          </Button>
          <Button
            onClick={() => retryMut.mutate()}
            disabled={busy}
            variant="outline"
            className="rounded-xl"
          >
            {retryMut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RotateCw className="mr-2 h-4 w-4" />
            )}
            Zopakovať zlyhané
          </Button>
          <Button
            onClick={() => clearMut.mutate()}
            disabled={busy}
            variant="ghost"
            className="rounded-xl"
          >
            {clearMut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Vyčistiť úspešné
          </Button>
        </div>

        {lastBatch && (
          <div className="mt-4 rounded-xl border border-border/60 bg-muted/30 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 text-success" />
              Posledná dávka
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Spracovaných {lastBatch.processed} · úspešných {lastBatch.successful}
              {" · "}
              neúspešných {lastBatch.failed} · preskočených {lastBatch.skipped}
            </div>
            {lastBatch.errors.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-destructive">
                {lastBatch.errors.slice(0, 5).map((e, i) => (
                  <li key={i} className="font-mono">
                    {e.ico} · {e.source} — {e.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      {/* Latest errors */}
      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <h2 className="text-lg font-semibold">Posledné chyby</h2>
        {failed.data && failed.data.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">IČO</th>
                  <th className="py-2 pr-3">Zdroj</th>
                  <th className="py-2 pr-3">Pokusy</th>
                  <th className="py-2 pr-3">Chyba</th>
                  <th className="py-2 pr-3">Kedy</th>
                </tr>
              </thead>
              <tbody>
                {failed.data.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 align-top">
                    <td className="py-2 pr-3 font-mono">{r.ico}</td>
                    <td className="py-2 pr-3">{r.source}</td>
                    <td className="py-2 pr-3">{r.attempts}</td>
                    <td className="py-2 pr-3 text-xs text-destructive">
                      {r.lastError ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {fmt(r.finishedAt ?? r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Žiadne zlyhané úlohy.</p>
        )}
      </Card>

      {/* Recent queue items */}
      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <h2 className="text-lg font-semibold">Aktivita fronty</h2>
        {recent.data && recent.data.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">IČO</th>
                  <th className="py-2 pr-3">Zdroj</th>
                  <th className="py-2 pr-3">Stav</th>
                  <th className="py-2 pr-3">Prio</th>
                  <th className="py-2 pr-3">Pokusy</th>
                  <th className="py-2 pr-3">Vytvorené</th>
                  <th className="py-2 pr-3">Dokončené</th>
                </tr>
              </thead>
              <tbody>
                {recent.data.map((r) => (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-mono">{r.ico}</td>
                    <td className="py-2 pr-3">{r.source}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="py-2 pr-3">{r.priority}</td>
                    <td className="py-2 pr-3">{r.attempts}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {fmt(r.createdAt)}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {r.finishedAt ? fmt(r.finishedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Fronta je prázdna.</p>
        )}
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "muted" | "info" | "success" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-destructive"
        : tone === "info"
          ? "text-primary"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "success") {
    return (
      <Badge variant="secondary" className="rounded-full">
        <CheckCircle2 className="mr-1 h-3 w-3 text-success" /> success
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="rounded-full">
        <AlertTriangle className="mr-1 h-3 w-3" /> failed
      </Badge>
    );
  }
  if (status === "running") {
    return (
      <Badge variant="outline" className="rounded-full">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" /> running
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="rounded-full">
      {status}
    </Badge>
  );
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("sk-SK");
  } catch {
    return iso;
  }
}

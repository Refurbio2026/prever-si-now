import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useServerFn } from "@tanstack/react-query";
import { useServerFn as useSFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { sk } from "date-fns/locale";

import { AdminGuard } from "@/components/admin-guard";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getWorkerStatusFn,
  setWorkerPausedFn,
  type WorkerStatus,
} from "@/lib/datahub-worker.functions";

export const Route = createFileRoute("/admin/settings")({
  component: () => (
    <AdminGuard>
      <AdminSettings />
    </AdminGuard>
  ),
});

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: sk });
  } catch {
    return iso;
  }
}

function AdminSettings() {
  const getStatus = useSFn(getWorkerStatusFn);
  const setPaused = useSFn(setWorkerPausedFn);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<WorkerStatus>({
    queryKey: ["datahub-worker-status"],
    queryFn: () => getStatus({ data: undefined as never }),
    refetchInterval: 15_000,
  });

  const pauseMutation = useMutation({
    mutationFn: (paused: boolean) => setPaused({ data: { paused } }),
    onSuccess: (res) => {
      toast.success(res.workerPaused ? "Worker pozastavený." : "Worker spustený.");
      queryClient.invalidateQueries({ queryKey: ["datahub-worker-status"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const paused = data?.settings.workerPaused ?? false;
  const lastRun = data?.lastRun ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Nastavenia</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Systémové nastavenia a monitoring automatického DataHub workera.
        </p>
      </div>

      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Automatický DataHub worker</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Cron plán spúšťa import fronty každú minútu. Pozastavenie zastaví
              spracovanie bez straty existujúcich úloh.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="worker-pause" className="text-sm">
              {paused ? "Pozastavený" : "Aktívny"}
            </Label>
            <Switch
              id="worker-pause"
              checked={!paused}
              disabled={pauseMutation.isPending || isLoading}
              onCheckedChange={(next) => pauseMutation.mutate(!next)}
            />
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-4">
          <StatTile
            label="Posledný beh"
            value={lastRun ? formatTime(lastRun.startedAt) : "—"}
            sub={lastRun ? `${lastRun.triggerSource} · ${formatDuration(lastRun.durationMs)}` : undefined}
          />
          <StatTile label="Spracované (24h)" value={String(data?.totals.last24h.processed ?? 0)} />
          <StatTile label="Úspešné (24h)" value={String(data?.totals.last24h.successful ?? 0)} />
          <StatTile
            label="Zlyhané (24h)"
            value={String(data?.totals.last24h.failed ?? 0)}
            danger={(data?.totals.last24h.failed ?? 0) > 0}
          />
        </div>
      </Card>

      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <h2 className="text-lg font-semibold">História behov</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Posledných 20 spustení workera (cron aj manuálne).
        </p>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Čas</TableHead>
                <TableHead>Zdroj</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead className="text-right">Spracované</TableHead>
                <TableHead className="text-right">Úspešné</TableHead>
                <TableHead className="text-right">Zlyhané</TableHead>
                <TableHead className="text-right">Preskočené</TableHead>
                <TableHead className="text-right">Trvanie</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.recentRuns ?? []).map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatTime(run.startedAt)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{run.triggerSource}</TableCell>
                  <TableCell>
                    {run.errorMessage ? (
                      <Badge variant="destructive">Chyba</Badge>
                    ) : run.paused ? (
                      <Badge variant="secondary">Pozastavené</Badge>
                    ) : (
                      <Badge variant="outline">OK</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{run.processed}</TableCell>
                  <TableCell className="text-right tabular-nums">{run.successful}</TableCell>
                  <TableCell className="text-right tabular-nums">{run.failed}</TableCell>
                  <TableCell className="text-right tabular-nums">{run.skipped}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDuration(run.durationMs)}
                  </TableCell>
                </TableRow>
              ))}
              {(!data?.recentRuns || data.recentRuns.length === 0) && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    {isLoading ? "Načítavam…" : "Zatiaľ žiadne spustenia."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  danger,
}: {
  label: string;
  value: string;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold ${danger ? "text-destructive" : "text-foreground"}`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

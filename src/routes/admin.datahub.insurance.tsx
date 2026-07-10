import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PlayCircle, RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  getDeactivatedInsuranceFn,
  getInsuranceImportStatusFn,
  runAllInsuranceImportsFn,
  runInsuranceImportFn,
  type DeactivatedInsuranceRow,
  type InsuranceProviderStatus,
} from "@/lib/insurance-debt.functions";
import { INSURANCE_PROVIDERS } from "@/lib/insurance-debt.types";

export const Route = createFileRoute("/admin/datahub/insurance")({
  component: InsuranceAdminPage,
  head: () => ({
    meta: [
      { title: "DataHub — Poisťovne — PreverSi.sk" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function formatDate(v: string | null): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("sk-SK");
  } catch {
    return v;
  }
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    success: "bg-success/15 text-success",
    empty: "bg-muted text-foreground",
    unchanged: "bg-muted text-foreground",
    failed: "bg-destructive/15 text-destructive",
    not_implemented: "bg-warning/25 text-warning-foreground",
  };
  return (
    <Badge variant="secondary" className={`rounded-full border-0 ${map[status] ?? "bg-muted"}`}>
      {status}
    </Badge>
  );
}

function InsuranceAdminPage() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getInsuranceImportStatusFn);
  const runOneFn = useServerFn(runInsuranceImportFn);
  const runAllFn = useServerFn(runAllInsuranceImportsFn);

  const q = useQuery({
    queryKey: ["insurance-admin-status"],
    queryFn: () => statusFn(),
    refetchInterval: 15_000,
  });

  const runOne = useMutation({
    mutationFn: (provider: (typeof INSURANCE_PROVIDERS)[number]) =>
      runOneFn({ data: { provider } }),
    onSuccess: (res) => {
      toast.success(`${res.provider}: ${res.status}`, {
        description: res.errorMessage ?? undefined,
      });
      qc.invalidateQueries({ queryKey: ["insurance-admin-status"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const runAll = useMutation({
    mutationFn: () => runAllFn(),
    onSuccess: (results) => {
      toast.success(`Spustené: ${results.length} poisťovní.`);
      qc.invalidateQueries({ queryKey: ["insurance-admin-status"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Poisťovne — importy dlžníkov</h1>
          <p className="text-sm text-muted-foreground">
            Technická diagnostika. Bežní používatelia sem nemajú prístup.
          </p>
        </div>
        <Button
          onClick={() => runAll.mutate()}
          disabled={runAll.isPending}
          className="rounded-xl"
        >
          {runAll.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="mr-2 h-4 w-4" />
          )}
          Importovať všetky poisťovne
        </Button>
      </header>

      {q.isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Načítavam…
        </div>
      ) : q.isError ? (
        <Card className="rounded-2xl p-6 text-sm text-destructive">
          {(q.error as Error).message}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {q.data?.providers.map((p) => (
              <ProviderCard
                key={p.provider}
                provider={p}
                onRun={() => runOne.mutate(p.provider)}
                pending={runOne.isPending && runOne.variables === p.provider}
              />
            ))}
          </div>

          <Card className="rounded-2xl p-4">
            <h2 className="mb-3 text-lg font-semibold">Posledné behy</h2>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Čas</TableHead>
                    <TableHead>Poisťovňa</TableHead>
                    <TableHead>Stav</TableHead>
                    <TableHead>Validácia</TableHead>
                    <TableHead className="text-right">Stiah.</TableHead>
                    <TableHead className="text-right">Norm.</TableHead>
                    <TableHead className="text-right">Valid.</TableHead>
                    <TableHead className="text-right">+ Ins</TableHead>
                    <TableHead className="text-right">△ Upd</TableHead>
                    <TableHead className="text-right">= Unc</TableHead>
                    <TableHead className="text-right">− Deac</TableHead>
                    <TableHead>Hash</TableHead>
                    <TableHead>Chyba</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.data?.recentRuns.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDate(r.startedAt)}
                      </TableCell>
                      <TableCell className="text-xs">{r.provider}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.validationStatus ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">{r.recordsDownloaded}</TableCell>
                      <TableCell className="text-right">{r.recordsNormalized}</TableCell>
                      <TableCell className="text-right">{r.recordsValid}</TableCell>
                      <TableCell className="text-right text-success">
                        {r.recordsInserted}
                      </TableCell>
                      <TableCell className="text-right">{r.recordsUpdated}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {r.recordsUnchanged}
                      </TableCell>
                      <TableCell className="text-right text-destructive">
                        {r.recordsDeactivated}
                      </TableCell>
                      <TableCell className="max-w-[100px] truncate font-mono text-[10px] text-muted-foreground">
                        {r.contentHash?.slice(0, 10) ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                        {r.errorMessage ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          <DeactivatedInsurancePanel />
        </>
      )}
    </div>
  );
}

function DeactivatedInsurancePanel() {
  const [provider, setProvider] = useState<(typeof INSURANCE_PROVIDERS)[number]>(
    INSURANCE_PROVIDERS[0],
  );
  const fn = useServerFn(getDeactivatedInsuranceFn);
  const q = useQuery({
    queryKey: ["insurance-deactivated", provider],
    queryFn: () => fn({ data: { provider } }),
  });
  return (
    <Card className="rounded-2xl p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Deaktivované záznamy</h2>
          <p className="text-xs text-muted-foreground">
            Firmy, ktoré už nie sú v aktuálnom zverejnenom zozname (nezmazané, verzované).
          </p>
        </div>
        <select
          className="rounded-xl border bg-background px-3 py-1.5 text-xs"
          value={provider}
          onChange={(e) =>
            setProvider(e.target.value as (typeof INSURANCE_PROVIDERS)[number])
          }
        >
          {INSURANCE_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>IČO</TableHead>
              <TableHead>Názov</TableHead>
              <TableHead className="text-right">Suma (€)</TableHead>
              <TableHead>Dátum zdroja</TableHead>
              <TableHead>Deaktivované</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).map((r) => (
              <TableRow key={`${r.ico}-${r.removedAt}`}>
                <TableCell className="font-mono text-xs">{r.ico}</TableCell>
                <TableCell className="text-xs">{r.debtorName ?? "—"}</TableCell>
                <TableCell className="text-right text-xs">
                  {r.debtAmount != null ? r.debtAmount.toFixed(2) : "—"}
                </TableCell>
                <TableCell className="text-xs">
                  {r.sourceRecordDate ?? "—"}
                </TableCell>
                <TableCell className="text-xs">
                  {r.removedAt ? formatDate(r.removedAt) : "—"}
                </TableCell>
              </TableRow>
            ))}
            {q.data && q.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-xs text-muted-foreground">
                  Žiadne deaktivované záznamy pre {provider}.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function ProviderCard({
  provider,
  onRun,
  pending,
}: {
  provider: InsuranceProviderStatus;
  onRun: () => void;
  pending: boolean;
}) {
  return (
    <Card className="rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{provider.label}</h3>
          <p className="text-xs text-muted-foreground">{provider.provider}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onRun}
          disabled={pending}
          className="rounded-xl"
        >
          {pending ? (
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-3 w-3" />
          )}
          Spustiť import
        </Button>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Posledný úspech</dt>
          <dd>{formatDate(provider.lastSuccess?.startedAt ?? null)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Posledný pokus</dt>
          <dd>{formatDate(provider.lastAttempt?.startedAt ?? null)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Uložených dlžníkov</dt>
          <dd>{provider.totalDebtors.toLocaleString("sk-SK")}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Stav</dt>
          <dd>{provider.lastAttempt ? statusBadge(provider.lastAttempt.status) : "—"}</dd>
        </div>
      </dl>
      {provider.lastAttempt?.sourceUrl && (
        <a
          href={provider.lastAttempt.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" /> Zdroj
        </a>
      )}
      {provider.lastAttempt?.errorMessage && (
        <p className="mt-3 text-xs text-muted-foreground">{provider.lastAttempt.errorMessage}</p>
      )}
    </Card>
  );
}

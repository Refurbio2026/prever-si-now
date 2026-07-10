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
  getDeactivatedTaxFn,
  getTaxImportStatusFn,
  runAllTaxImportsFn,
  runTaxImportFn,
  type DeactivatedTaxRow,
  type TaxDatasetStatus,
} from "@/lib/tax-status.functions";
import { TAX_DATASETS } from "@/lib/tax-status.types";

export const Route = createFileRoute("/admin/datahub/tax")({
  component: TaxAdminPage,
  head: () => ({
    meta: [
      { title: "DataHub — Finančná správa — PreverSi.sk" },
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
    <Badge
      variant="secondary"
      className={`rounded-full border-0 ${map[status] ?? "bg-muted"}`}
    >
      {status}
    </Badge>
  );
}

function TaxAdminPage() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getTaxImportStatusFn);
  const runOneFn = useServerFn(runTaxImportFn);
  const runAllFn = useServerFn(runAllTaxImportsFn);

  const q = useQuery({
    queryKey: ["tax-admin-status"],
    queryFn: () => statusFn(),
    refetchInterval: 15_000,
  });

  const runOne = useMutation({
    mutationFn: (dataset: (typeof TAX_DATASETS)[number]) =>
      runOneFn({ data: { dataset } }),
    onSuccess: (res) => {
      toast.success(`${res.dataset}: ${res.status}`, {
        description: res.errorMessage ?? undefined,
      });
      qc.invalidateQueries({ queryKey: ["tax-admin-status"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const runAll = useMutation({
    mutationFn: () => runAllFn(),
    onSuccess: (results) => {
      toast.success(`Spustené: ${results.length} datasetov.`);
      qc.invalidateQueries({ queryKey: ["tax-admin-status"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Finančná správa — importy</h1>
          <p className="text-sm text-muted-foreground">
            Technická diagnostika. Zdroje: financnasprava.sk, opendata.financnasprava.sk.
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
          Importovať všetky datasety
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
          <div className="grid gap-4 md:grid-cols-3">
            {q.data?.datasets.map((d) => (
              <DatasetCard
                key={d.dataset}
                dataset={d}
                onRun={() => runOne.mutate(d.dataset)}
                pending={runOne.isPending && runOne.variables === d.dataset}
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
                    <TableHead>Dataset</TableHead>
                    <TableHead>Stav</TableHead>
                    <TableHead className="text-right">Stiahnuté</TableHead>
                    <TableHead className="text-right">Norm.</TableHead>
                    <TableHead className="text-right">Valid. IČO</TableHead>
                    <TableHead>Dátum zdroja</TableHead>
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
                      <TableCell className="text-xs">{r.dataset}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell className="text-right">
                        {r.recordsDownloaded}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.recordsNormalized}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.recordsWithValidIco}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.sourceRecordDate ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate text-[10px] text-muted-foreground">
                        {r.contentHash?.slice(0, 12) ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[320px] truncate text-xs text-muted-foreground">
                        {r.errorMessage ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function DatasetCard({
  dataset,
  onRun,
  pending,
}: {
  dataset: TaxDatasetStatus;
  onRun: () => void;
  pending: boolean;
}) {
  return (
    <Card className="rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{dataset.label}</h3>
          <p className="text-xs text-muted-foreground">{dataset.dataset}</p>
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
          Spustiť
        </Button>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Posledný úspech</dt>
          <dd>{formatDate(dataset.lastSuccess?.startedAt ?? null)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Posledný pokus</dt>
          <dd>{formatDate(dataset.lastAttempt?.startedAt ?? null)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Dátum zdroja</dt>
          <dd className="text-xs">
            {dataset.lastSuccess?.sourceRecordDate ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Záznamov v DB</dt>
          <dd>{dataset.totalRecords.toLocaleString("sk-SK")}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Hash</dt>
          <dd className="truncate font-mono text-[10px]">
            {dataset.lastSuccess?.contentHash?.slice(0, 16) ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Stav</dt>
          <dd>
            {dataset.lastAttempt
              ? statusBadge(dataset.lastAttempt.status)
              : "—"}
          </dd>
        </div>
      </dl>
      {dataset.lastAttempt?.sourceUrl && (
        <a
          href={dataset.lastAttempt.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" /> Zdroj
        </a>
      )}
      {dataset.lastAttempt?.errorMessage && (
        <p className="mt-3 text-xs text-muted-foreground">
          {dataset.lastAttempt.errorMessage}
        </p>
      )}
    </Card>
  );
}

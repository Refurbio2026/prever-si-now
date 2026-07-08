import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Loader2, CheckCircle2, XCircle, RotateCw, Users, History, Building2, PlayCircle } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  getImportLogsFn,
  importCompanyRegistryFn,
  importCompanyPeopleFn,
  importCompanyHistoryFn,
  type ImportLogEntry,
  type ImportJobResult,
} from "@/lib/company-records.functions";

export const Route = createFileRoute("/admin/imports")({
  component: AdminImportsPage,
  head: () => ({
    meta: [
      { title: "Import údajov — PreverSi.sk" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

type JobKind = "registry" | "people" | "history" | "all";

function AdminImportsPage() {
  const [ico, setIco] = useState("");
  const qc = useQueryClient();

  const fetchLogs = useServerFn(getImportLogsFn);
  const runRegistry = useServerFn(importCompanyRegistryFn);
  const runPeople = useServerFn(importCompanyPeopleFn);
  const runHistory = useServerFn(importCompanyHistoryFn);

  const validIco = /^\d{6,8}$/.test(ico.trim());

  const logsQuery = useQuery({
    queryKey: ["import-logs"],
    queryFn: () => fetchLogs({ data: { limit: 100 } }),
    refetchInterval: 5000,
    staleTime: 0,
  });

  const runners: Record<Exclude<JobKind, "all">, (args: { data: { ico: string } }) => Promise<ImportJobResult>> = {
    registry: runRegistry,
    people: runPeople,
    history: runHistory,
  };

  const mutation = useMutation({
    mutationFn: async ({ ico: targetIco, kind }: { ico: string; kind: JobKind }) => {
      if (!/^\d{6,8}$/.test(targetIco)) throw new Error("Neplatné IČO.");
      if (kind === "all") {
        await Promise.all([
          runRegistry({ data: { ico: targetIco } }),
          runPeople({ data: { ico: targetIco } }),
          runHistory({ data: { ico: targetIco } }),
        ]);
      } else {
        await runners[kind]({ data: { ico: targetIco } });
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["import-logs"] });
      qc.invalidateQueries({ queryKey: ["company-records"] });
    },
  });

  const trigger = (kind: JobKind, targetIco?: string) =>
    mutation.mutate({ ico: (targetIco ?? ico).trim(), kind });

  const pendingKind = mutation.isPending ? (mutation.variables?.kind ?? null) : null;
  const pendingIco = mutation.isPending ? (mutation.variables?.ico ?? null) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Import údajov z verejných registrov</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manuálne spustenie importných úloh (ORSR/RPO). Každý beh sa zaznamenáva do tabuľky{" "}
          <code>import_logs</code>.
        </p>
      </div>

      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="ico" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              IČO
            </label>
            <Input
              id="ico"
              value={ico}
              onChange={(e) => setIco(e.target.value.replace(/\D+/g, "").slice(0, 8))}
              placeholder="napr. 54613124"
              className="mt-1"
            />
          </div>
        </div>
        {!validIco && ico.length > 0 && (
          <p className="mt-2 text-xs text-destructive">IČO musí mať 6 až 8 číslic.</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={() => trigger("registry")}
            disabled={!validIco || mutation.isPending}
            variant="outline"
            className="rounded-xl"
          >
            {pendingKind === "registry" && pendingIco === ico.trim() ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Building2 className="mr-2 h-4 w-4" />
            )}
            Import registry
          </Button>
          <Button
            onClick={() => trigger("people")}
            disabled={!validIco || mutation.isPending}
            variant="outline"
            className="rounded-xl"
          >
            {pendingKind === "people" && pendingIco === ico.trim() ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Users className="mr-2 h-4 w-4" />
            )}
            Import people
          </Button>
          <Button
            onClick={() => trigger("history")}
            disabled={!validIco || mutation.isPending}
            variant="outline"
            className="rounded-xl"
          >
            {pendingKind === "history" && pendingIco === ico.trim() ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <History className="mr-2 h-4 w-4" />
            )}
            Import history
          </Button>
          <Button
            onClick={() => trigger("all")}
            disabled={!validIco || mutation.isPending}
            className="rounded-xl"
          >
            {pendingKind === "all" && pendingIco === ico.trim() ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="mr-2 h-4 w-4" />
            )}
            Import all
          </Button>
        </div>
        {mutation.isError && (
          <p className="mt-3 text-sm text-destructive">
            {(mutation.error as Error).message}
          </p>
        )}
      </Card>

      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">História importov</h2>
          {logsQuery.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <LogsTable
          logs={logsQuery.data ?? []}
          onReimport={(targetIco) => trigger("all", targetIco)}
          isReimportingIco={pendingIco}
        />
      </Card>
    </div>
  );
}

function LogsTable({
  logs,
  onReimport,
  isReimportingIco,
}: {
  logs: ImportLogEntry[];
  onReimport: (ico: string) => void;
  isReimportingIco: string | null;
}) {
  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">Zatiaľ neboli spustené žiadne importy.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3">IČO</th>
            <th className="py-2 pr-3">Zdroj</th>
            <th className="py-2 pr-3">Stav</th>
            <th className="py-2 pr-3">Záznamov</th>
            <th className="py-2 pr-3">Začiatok</th>
            <th className="py-2 pr-3">Koniec</th>
            <th className="py-2 pr-3">Chyba</th>
            <th className="py-2 pr-3 text-right">Akcia</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b border-border/40 align-top">
              <td className="py-2 pr-3 font-mono">{log.ico}</td>
              <td className="py-2 pr-3">{log.source}</td>
              <td className="py-2 pr-3"><StatusBadge status={log.status} /></td>
              <td className="py-2 pr-3">{log.recordsCount}</td>
              <td className="py-2 pr-3 text-xs text-muted-foreground">{fmt(log.startedAt)}</td>
              <td className="py-2 pr-3 text-xs text-muted-foreground">{log.finishedAt ? fmt(log.finishedAt) : "—"}</td>
              <td className="py-2 pr-3 text-xs text-destructive">{log.errorMessage ?? "—"}</td>
              <td className="py-2 pr-3 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-lg"
                  onClick={() => onReimport(log.ico)}
                  disabled={isReimportingIco === log.ico}
                >
                  {isReimportingIco === log.ico ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCw className="mr-1 h-3 w-3" />
                  )}
                  Reimportovať
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ok") {
    return (
      <Badge variant="secondary" className="rounded-full">
        <CheckCircle2 className="mr-1 h-3 w-3 text-success" /> ok
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="destructive" className="rounded-full">
        <XCircle className="mr-1 h-3 w-3" /> error
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
      <Download className="mr-1 h-3 w-3" /> {status}
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

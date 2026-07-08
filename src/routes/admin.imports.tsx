import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Loader2, CheckCircle2, XCircle } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  getCompanyRecordsFn,
  importCompanyRegistryFn,
  importCompanyPeopleFn,
  importCompanyHistoryFn,
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

type JobKey = "registry" | "people" | "history";

interface JobRunState {
  status: "idle" | "running" | "ok" | "error";
  imported?: number;
  error?: string;
  finishedAt?: string;
}

function AdminImportsPage() {
  const [ico, setIco] = useState("");
  const [jobs, setJobs] = useState<Record<JobKey, JobRunState>>({
    registry: { status: "idle" },
    people: { status: "idle" },
    history: { status: "idle" },
  });

  const qc = useQueryClient();
  const fetchRecords = useServerFn(getCompanyRecordsFn);
  const runRegistry = useServerFn(importCompanyRegistryFn);
  const runPeople = useServerFn(importCompanyPeopleFn);
  const runHistory = useServerFn(importCompanyHistoryFn);

  const validIco = /^\d{6,8}$/.test(ico.trim());

  const recordsQuery = useQuery({
    queryKey: ["admin-imports-records", ico],
    queryFn: () => fetchRecords({ data: { ico: ico.trim() } }),
    enabled: validIco,
    staleTime: 0,
  });

  const registryCount = recordsQuery.data?.registry ? 1 : 0;
  const peopleCount = recordsQuery.data?.people.length ?? 0;
  const historyCount = recordsQuery.data?.history.length ?? 0;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!validIco) throw new Error("Zadaj platné IČO (6–8 číslic).");
      const trimmed = ico.trim();
      setJobs({
        registry: { status: "running" },
        people: { status: "running" },
        history: { status: "running" },
      });
      const [registry, people, history] = await Promise.all([
        runRegistry({ data: { ico: trimmed } }),
        runPeople({ data: { ico: trimmed } }),
        runHistory({ data: { ico: trimmed } }),
      ]);
      return { registry, people, history };
    },
    onSuccess: (res) => {
      const stamp = new Date().toISOString();
      setJobs({
        registry: toJobState(res.registry, stamp),
        people: toJobState(res.people, stamp),
        history: toJobState(res.history, stamp),
      });
      qc.invalidateQueries({ queryKey: ["admin-imports-records", ico] });
      qc.invalidateQueries({ queryKey: ["company-records", ico.trim()] });
    },
    onError: (err) => {
      const msg = (err as Error).message ?? "Import zlyhal.";
      const stamp = new Date().toISOString();
      setJobs({
        registry: { status: "error", error: msg, finishedAt: stamp },
        people: { status: "error", error: msg, finishedAt: stamp },
        history: { status: "error", error: msg, finishedAt: stamp },
      });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Import údajov z verejných registrov</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manuálne spustenie importných úloh (ORSR/RPO) pre konkrétne IČO.
          Dáta sa uložia do interných tabuliek <code>company_registry</code>,{" "}
          <code>company_people</code> a <code>company_history</code>.
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
          <Button
            onClick={() => mutation.mutate()}
            disabled={!validIco || mutation.isPending}
            className="rounded-xl"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importujem…
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" /> Importovať údaje
              </>
            )}
          </Button>
        </div>
        {!validIco && ico.length > 0 && (
          <p className="mt-2 text-xs text-destructive">IČO musí mať 6 až 8 číslic.</p>
        )}
      </Card>

      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <h2 className="mb-4 text-lg font-semibold">Stav importných úloh</h2>
        <div className="space-y-3">
          <JobRow name="importCompanyRegistry" state={jobs.registry} />
          <JobRow name="importCompanyPeople" state={jobs.people} />
          <JobRow name="importCompanyHistory" state={jobs.history} />
        </div>
      </Card>

      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Aktuálny obsah databázy</h2>
          {recordsQuery.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        {!validIco ? (
          <p className="text-sm text-muted-foreground">Zadaj IČO na zobrazenie stavu.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <StatBox label="company_registry" count={registryCount} />
            <StatBox label="company_people" count={peopleCount} />
            <StatBox label="company_history" count={historyCount} />
          </div>
        )}
        {validIco && registryCount === 0 && peopleCount === 0 && historyCount === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">Dáta zatiaľ neboli importované.</p>
        )}
      </Card>
    </div>
  );
}

function toJobState(res: ImportJobResult, finishedAt: string): JobRunState {
  if (res.ok) return { status: "ok", imported: res.imported, finishedAt };
  return { status: "error", error: res.error, imported: res.imported, finishedAt };
}

function JobRow({ name, state }: { name: string; state: JobRunState }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-secondary/30 px-4 py-3">
      <div className="flex items-center gap-3">
        <StatusIcon status={state.status} />
        <div>
          <div className="font-mono text-sm">{name}</div>
          {state.error && <div className="text-xs text-destructive">{state.error}</div>}
          {state.finishedAt && (
            <div className="text-[10px] text-muted-foreground">
              {new Date(state.finishedAt).toLocaleString("sk-SK")}
            </div>
          )}
        </div>
      </div>
      {state.status === "ok" && (
        <Badge variant="secondary" className="rounded-full">
          {state.imported} záznamov
        </Badge>
      )}
      {state.status === "error" && (
        <Badge variant="destructive" className="rounded-full">
          Chyba
        </Badge>
      )}
      {state.status === "running" && (
        <Badge variant="outline" className="rounded-full">
          Bežím…
        </Badge>
      )}
      {state.status === "idle" && (
        <Badge variant="outline" className="rounded-full">
          Neaktívne
        </Badge>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: JobRunState["status"] }) {
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-destructive" />;
  return <Download className="h-4 w-4 text-muted-foreground" />;
}

function StatBox({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/30 p-4">
      <div className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-bold">{count}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {count === 0 ? "Dáta zatiaľ neboli importované" : "záznamov v databáze"}
      </div>
    </div>
  );
}

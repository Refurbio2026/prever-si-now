import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { finstatDiagnosticFn } from "@/lib/finstat.functions";

const TEST_ICO = "31333532";
const IS_DEV = import.meta.env.DEV;

export const Route = createFileRoute("/dashboard/api-debug")({
  component: ApiDebugPage,
  head: () => ({
    meta: [
      { title: "API Debug — PreverSi.sk" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ApiDebugPage() {
  const [ico, setIco] = useState(TEST_ICO);
  const diagnosticFn = useServerFn(finstatDiagnosticFn);

  const run = useMutation({
    mutationFn: (targetIco: string) => diagnosticFn({ data: { ico: targetIco } }),
  });

  if (!IS_DEV) {
    return (
      <Card className="rounded-2xl p-8">
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          API diagnostics are only available in development mode.
        </p>
      </Card>
    );
  }

  const diagnostic = run.data?.diagnostic;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Finstat API Diagnostics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dev-only. Checks environment variables and issues a live request.
        </p>
      </div>

      <Card className="rounded-2xl p-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted-foreground">IČO to test</label>
            <input
              value={ico}
              onChange={(e) => setIco(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <Button
            onClick={() => run.mutate(ico)}
            disabled={run.isPending}
            className="rounded-xl"
          >
            {run.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Testing…
              </>
            ) : (
              "Test Finstat by IČO"
            )}
          </Button>
        </div>
      </Card>

      {run.isError && (
        <Card className="rounded-2xl border-destructive/40 bg-destructive/5 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <div className="font-semibold text-destructive">Server function failed</div>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {(run.error as Error).message}
              </pre>
            </div>
          </div>
        </Card>
      )}

      {diagnostic && (
        <>
          <Card className="rounded-2xl p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Environment variables
            </h2>
            <div className="mt-3 flex flex-col gap-2">
              <EnvRow name="FINSTAT_API_KEY" present={diagnostic.envStatus.FINSTAT_API_KEY} />
              <EnvRow
                name="FINSTAT_PRIVATE_KEY"
                present={diagnostic.envStatus.FINSTAT_PRIVATE_KEY}
              />
              <EnvRow
                name="FINSTAT_BASE_URL"
                present={diagnostic.envStatus.FINSTAT_BASE_URL}
                note={`resolved: ${diagnostic.envStatus.baseUrl}`}
              />
            </div>
          </Card>

          {diagnostic.usingMock && (
            <Card className="rounded-2xl border-amber-500/40 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-4 w-4" />
                Using mock data because Finstat API is not configured.
              </div>
            </Card>
          )}

          <Card className="rounded-2xl p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Request
            </h2>
            <dl className="mt-3 grid gap-2 text-sm">
              <Row label="Endpoint" value={diagnostic.endpoint ?? "—"} mono />
              <Row
                label="HTTP status"
                value={
                  diagnostic.httpStatus !== null ? (
                    <Badge variant={diagnostic.httpStatus < 400 ? "secondary" : "destructive"}>
                      {diagnostic.httpStatus}
                    </Badge>
                  ) : (
                    "—"
                  )
                }
              />
              <Row label="Error code" value={diagnostic.errorCode ?? "—"} mono />
            </dl>
          </Card>

          {diagnostic.errorMessage && (
            <Card className="rounded-2xl border-destructive/40 bg-destructive/5 p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-destructive">
                Error message
              </h2>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs">
                {diagnostic.errorMessage}
              </pre>
            </Card>
          )}

          <Card className="rounded-2xl p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Raw response (first 500 chars)
            </h2>
            <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-muted p-3 text-xs">
              {diagnostic.rawResponsePreview ?? "(no raw response)"}
            </pre>
          </Card>

          <Card className="rounded-2xl p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Normalized preview
            </h2>
            <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-muted p-3 text-xs">
              {diagnostic.normalizedPreview
                ? JSON.stringify(diagnostic.normalizedPreview, null, 2)
                : "(no normalized data)"}
            </pre>
          </Card>
        </>
      )}
    </div>
  );
}

function EnvRow({ name, present, note }: { name: string; present: boolean; note?: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        {present ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <XCircle className="h-4 w-4 text-destructive" />
        )}
        <span className="font-mono">{name}</span>
        {note && <span className="text-xs text-muted-foreground">— {note}</span>}
      </div>
      <Badge variant={present ? "secondary" : "destructive"}>
        {present ? "set" : "missing"}
      </Badge>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2 last:border-0 last:pb-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : "text-sm"}>{value}</dd>
    </div>
  );
}

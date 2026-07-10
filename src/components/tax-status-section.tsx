import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Loader2,
  Receipt,
  Info,
  RefreshCw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCompanyTaxStatusFn } from "@/lib/tax-status.functions";
import type { CompanyTaxPayload } from "@/lib/tax-status.types";

function formatEur(amount: number | null): string | null {
  if (amount == null) return null;
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(amount);
}
function formatDate(v: string | null): string | null {
  if (!v) return null;
  try {
    return new Date(v).toLocaleDateString("sk-SK");
  } catch {
    return v;
  }
}

function StateBadge({
  tone,
  children,
}: {
  tone: "good" | "bad" | "warn" | "muted";
  children: React.ReactNode;
}) {
  const map: Record<string, string> = {
    good: "bg-success/15 text-success",
    bad: "bg-destructive/15 text-destructive",
    warn: "bg-warning/25 text-warning-foreground",
    muted: "bg-muted text-foreground",
  };
  return (
    <Badge variant="secondary" className={`rounded-full border-0 ${map[tone]}`}>
      {children}
    </Badge>
  );
}

function IconTile({
  tone,
  children,
}: {
  tone: "good" | "bad" | "warn" | "muted";
  children: React.ReactNode;
}) {
  const cls =
    tone === "bad"
      ? "bg-destructive/15 text-destructive"
      : tone === "good"
        ? "bg-success/15 text-success"
        : tone === "warn"
          ? "bg-warning/25 text-warning-foreground"
          : "bg-muted text-foreground";
  return <div className={`rounded-lg p-2 ${cls}`}>{children}</div>;
}

function SourceLink({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
    >
      <ExternalLink className="h-3 w-3" /> Zdroj
    </a>
  );
}

/**
 * Tax debtors: reconciliation is intentionally disabled (XML has no ICO).
 * Even after a successful import, no production rows will be attached to a
 * company. Show a neutral "downloaded, matching in progress" state whenever
 * the debtor block has no positive match — never a red error.
 */
function DebtorBlock({ debtor }: { debtor: CompanyTaxPayload["debtor"] }) {
  const s = debtor.state;

  // Positive debtor match — currently impossible but supported for the future.
  if (s.kind === "debt_found") {
    return (
      <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <IconTile tone="bad">
            <ShieldAlert className="h-4 w-4" />
          </IconTile>
          <div>
            <div className="text-sm font-medium">Daňový nedoplatok</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Evidovaný daňový nedoplatok
            </div>
            <div className="mt-1 text-xs">
              {formatEur(s.amount)}
              {s.recordDate ? ` · k dátumu ${formatDate(s.recordDate)}` : ""}
            </div>
          </div>
        </div>
        <SourceLink url={debtor.sourceUrl} />
      </li>
    );
  }

  // Dataset not yet imported (no successful run recorded).
  if (s.kind === "unverified" && !debtor.lastSuccessAt) {
    return (
      <li className="flex items-start gap-3 py-3">
        <IconTile tone="muted">
          <RefreshCw className="h-4 w-4" />
        </IconTile>
        <div>
          <div className="text-sm font-medium">Daňový nedoplatok</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Dáta z tohto zdroja sa pripravujú. Import prebieha automaticky na dennej báze.
          </div>
        </div>
      </li>
    );
  }

  // Success import exists (or last run stale) — reconciliation to ICO is
  // disabled, so we always render the neutral "downloaded, matching pending"
  // state instead of the misleading "not in list".
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <IconTile tone="muted">
          <Info className="h-4 w-4" />
        </IconTile>
        <div>
          <div className="text-sm font-medium">Daňový nedoplatok</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Zoznam daňových dlžníkov je stiahnutý, priraďovanie k spoločnostiam sa pripravuje.
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Neprítomnosť v zozname nie je definitívnym potvrdením, že firma nemá nedoplatky.
          </div>
        </div>
      </div>
      <SourceLink url={debtor.sourceUrl} />
    </li>
  );
}

function VatBlock({ vat }: { vat: CompanyTaxPayload["vat"] }) {
  const s = vat.state;

  if (s.kind === "registered") {
    return (
      <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <IconTile tone="good">
            <Receipt className="h-4 w-4" />
          </IconTile>
          <div>
            <div className="text-sm font-medium">Registrácia DPH</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Platiteľ DPH</div>
            <div className="mt-1 text-xs">
              {s.icDph && <span className="font-mono">{s.icDph}</span>}
              {s.registrationDate && <> · registrácia {formatDate(s.registrationDate)}</>}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Zdroj:{" "}
              {s.source === "financial_administration"
                ? "Finančná správa SR"
                : "Finstat (nepotvrdené FS)"}
            </div>
          </div>
        </div>
        <SourceLink url={vat.sourceUrl} />
      </li>
    );
  }

  if (s.kind === "cancelled") {
    return (
      <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <IconTile tone="bad">
            <Receipt className="h-4 w-4" />
          </IconTile>
          <div>
            <div className="text-sm font-medium">Registrácia DPH</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Registrácia DPH zrušená (potvrdené FS)
            </div>
            {s.recordDate && (
              <div className="mt-1 text-xs">k dátumu {formatDate(s.recordDate)}</div>
            )}
          </div>
        </div>
        <SourceLink url={vat.sourceUrl} />
      </li>
    );
  }

  // Not yet imported.
  if (!vat.lastSuccessAt) {
    return (
      <li className="flex items-start gap-3 py-3">
        <IconTile tone="muted">
          <RefreshCw className="h-4 w-4" />
        </IconTile>
        <div>
          <div className="text-sm font-medium">Registrácia DPH</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Dáta z tohto zdroja sa pripravujú. Import prebieha automaticky na dennej báze.
          </div>
        </div>
      </li>
    );
  }

  // Imported but company not in the VAT register.
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <IconTile tone="good">
          <ShieldCheck className="h-4 w-4" />
        </IconTile>
        <div>
          <div className="text-sm font-medium">Registrácia DPH</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Spoločnosť sa nenachádza v zverejnenom zozname platiteľov DPH.
          </div>
        </div>
      </div>
      <SourceLink url={vat.sourceUrl} />
    </li>
  );
}

function ReliabilityBlock({
  reliability,
}: {
  reliability: CompanyTaxPayload["reliability"];
}) {
  const s = reliability.state;

  if (s.kind === "classified") {
    const tone: "good" | "bad" | "muted" = /nesp/i.test(s.value)
      ? "bad"
      : /vysoko/i.test(s.value)
        ? "good"
        : "muted";
    return (
      <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <IconTile tone={tone}>
            <ShieldQuestion className="h-4 w-4" />
          </IconTile>
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              Index daňovej spoľahlivosti
              <StateBadge tone={tone}>{s.value}</StateBadge>
            </div>
            {s.recordDate && (
              <div className="mt-1 text-xs text-muted-foreground">
                k dátumu {formatDate(s.recordDate)}
              </div>
            )}
          </div>
        </div>
        <SourceLink url={reliability.sourceUrl} />
      </li>
    );
  }

  if (s.kind === "not_classified") {
    return (
      <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <IconTile tone="good">
            <ShieldCheck className="h-4 w-4" />
          </IconTile>
          <div>
            <div className="text-sm font-medium">Index daňovej spoľahlivosti</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Spoločnosť sa nenachádza v zverejnenom zozname.
            </div>
          </div>
        </div>
        <SourceLink url={reliability.sourceUrl} />
      </li>
    );
  }

  // Pending / unverified — treat as "not yet imported".
  return (
    <li className="flex items-start gap-3 py-3">
      <IconTile tone="muted">
        <RefreshCw className="h-4 w-4" />
      </IconTile>
      <div>
        <div className="text-sm font-medium">Index daňovej spoľahlivosti</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          Dáta z tohto zdroja sa pripravujú. Import prebieha automaticky na dennej báze.
        </div>
      </div>
    </li>
  );
}

export function TaxStatusSection({ ico }: { ico: string }) {
  const fn = useServerFn(getCompanyTaxStatusFn);
  const q = useQuery<CompanyTaxPayload>({
    queryKey: ["tax-status", ico],
    queryFn: () => fn({ data: { ico } }),
    staleTime: 60 * 60_000,
  });

  const headerDate =
    q.data?.debtor.sourceRecordDate ??
    q.data?.vat.sourceRecordDate ??
    q.data?.reliability.sourceRecordDate ??
    q.data?.debtor.lastSuccessAt ??
    q.data?.vat.lastSuccessAt ??
    q.data?.reliability.lastSuccessAt ??
    null;

  return (
    <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">Daňové údaje</h3>
          <p className="text-xs text-muted-foreground">
            Zdroj: Finančná správa SR (financnasprava.sk, opendata.financnasprava.sk).
            Neprítomnosť v zozname dlžníkov nie je definitívnym potvrdením, že firma nemá
            žiadne nedoplatky.
          </p>
        </div>
        {headerDate && (
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">
            Údaje k: {formatDate(headerDate)}
          </span>
        )}
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Načítavam údaje z databázy…
        </div>
      ) : q.isError ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">
            Daňové údaje sa nepodarilo načítať.
          </p>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            Skúsiť znova
          </Button>
        </div>
      ) : q.data ? (
        <ul className="divide-y divide-border/60">
          <VatBlock vat={q.data.vat} />
          <DebtorBlock debtor={q.data.debtor} />
          <ReliabilityBlock reliability={q.data.reliability} />
        </ul>
      ) : null}
    </Card>
  );
}

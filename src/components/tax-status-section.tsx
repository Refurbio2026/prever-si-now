import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Loader2,
  Receipt,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
function formatDateTime(v: string | null): string | null {
  if (!v) return null;
  try {
    return new Date(v).toLocaleString("sk-SK");
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

function DebtorBlock({ debtor }: { debtor: CompanyTaxPayload["debtor"] }) {
  const s = debtor.state;
  let icon = ShieldQuestion;
  let tone: "good" | "bad" | "warn" | "muted" = "muted";
  let label = "";
  let extra: string | null = null;
  if (s.kind === "debt_found") {
    icon = ShieldAlert;
    tone = "bad";
    label = "Evidovaný daňový nedoplatok";
    const amt = formatEur(s.amount);
    const dt = formatDate(s.recordDate);
    extra = [amt, dt ? `k dátumu ${dt}` : null].filter(Boolean).join(" · ");
  } else if (s.kind === "not_in_list") {
    icon = ShieldCheck;
    tone = "good";
    label = "Firma sa nenachádza v aktuálnom zverejnenom zozname daňových dlžníkov";
    const dt = formatDate(s.recordDate);
    if (dt) extra = `k dátumu ${dt}`;
  } else if (s.kind === "unverified") {
    icon = ShieldQuestion;
    tone = "warn";
    label = "Stav sa nepodarilo overiť";
    extra = s.reason;
  } else {
    icon = Loader2;
    tone = "muted";
    label = "Pripravuje sa";
  }
  const Icon = icon;
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <div className={`rounded-lg p-2 ${
          tone === "bad" ? "bg-destructive/15 text-destructive"
          : tone === "good" ? "bg-success/15 text-success"
          : tone === "warn" ? "bg-warning/25 text-warning-foreground"
          : "bg-muted text-foreground"
        }`}>
          <Icon className={`h-4 w-4 ${s.kind === "pending" ? "animate-spin" : ""}`} />
        </div>
        <div>
          <div className="text-sm font-medium">Daňový nedoplatok</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
          {extra && <div className="mt-1 text-xs">{extra}</div>}
        </div>
      </div>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        {debtor.lastImportAt && (
          <span className="text-[11px] text-muted-foreground">
            Import: {formatDateTime(debtor.lastImportAt)}
          </span>
        )}
        {debtor.sourceUrl && (
          <a
            href={debtor.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> Zdroj
          </a>
        )}
      </div>
    </li>
  );
}

function VatBlock({ vat }: { vat: CompanyTaxPayload["vat"] }) {
  const s = vat.state;
  let tone: "good" | "bad" | "warn" | "muted" = "muted";
  let label = "";
  let extra: React.ReactNode = null;
  if (s.kind === "registered") {
    tone = "good";
    label = "Platiteľ DPH";
    extra = (
      <>
        {s.icDph && <span className="font-mono text-xs">{s.icDph}</span>}
        {s.registrationDate && (
          <>
            {" "}
            · registrácia {formatDate(s.registrationDate)}
          </>
        )}
        <div className="mt-1 text-[11px] text-muted-foreground">
          Zdroj: {s.source === "financial_administration"
            ? "Finančná správa SR"
            : "Finstat (nepotvrdené FS)"}
        </div>
      </>
    );
  } else if (s.kind === "cancelled") {
    tone = "bad";
    label = "Registrácia DPH zrušená (potvrdené FS)";
    const dt = formatDate(s.recordDate);
    if (dt) extra = `k dátumu ${dt}`;
  } else if (s.kind === "unverified") {
    tone = "warn";
    label = "Stav sa nepodarilo overiť";
    extra = s.reason;
  } else {
    tone = "muted";
    label = "Registrácia DPH nie je dostupná";
  }
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <div className={`rounded-lg p-2 ${
          tone === "bad" ? "bg-destructive/15 text-destructive"
          : tone === "good" ? "bg-success/15 text-success"
          : tone === "warn" ? "bg-warning/25 text-warning-foreground"
          : "bg-muted text-foreground"
        }`}>
          <Receipt className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-medium">Registrácia DPH</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
          {extra && <div className="mt-1 text-xs">{extra}</div>}
        </div>
      </div>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        {vat.lastImportAt && (
          <span className="text-[11px] text-muted-foreground">
            Import: {formatDateTime(vat.lastImportAt)}
          </span>
        )}
        {vat.sourceUrl && (
          <a
            href={vat.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> Zdroj
          </a>
        )}
      </div>
    </li>
  );
}

function ReliabilityBlock({
  reliability,
}: {
  reliability: CompanyTaxPayload["reliability"];
}) {
  const s = reliability.state;
  let tone: "good" | "bad" | "warn" | "muted" = "muted";
  let label = "";
  let extra: string | null = null;
  if (s.kind === "classified") {
    // Show the exact official value; do not transform to our own wording.
    tone = /nesp/i.test(s.value) ? "bad" : /vysoko/i.test(s.value) ? "good" : "muted";
    label = s.value;
    const dt = formatDate(s.recordDate);
    if (dt) extra = `k dátumu ${dt}`;
  } else if (s.kind === "unverified") {
    tone = "warn";
    label = "Stav sa nepodarilo overiť";
    extra = s.reason;
  } else if (s.kind === "not_classified") {
    tone = "muted";
    label = "Nenachádza sa v zverejnenom zozname";
  } else {
    tone = "muted";
    label = "Pripravuje sa";
  }
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <div className={`rounded-lg p-2 ${
          tone === "bad" ? "bg-destructive/15 text-destructive"
          : tone === "good" ? "bg-success/15 text-success"
          : tone === "warn" ? "bg-warning/25 text-warning-foreground"
          : "bg-muted text-foreground"
        }`}>
          <ShieldQuestion className="h-4 w-4" />
        </div>
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            Index daňovej spoľahlivosti
            <StateBadge tone={tone}>{label}</StateBadge>
          </div>
          {extra && <div className="mt-1 text-xs text-muted-foreground">{extra}</div>}
        </div>
      </div>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        {reliability.lastImportAt && (
          <span className="text-[11px] text-muted-foreground">
            Import: {formatDateTime(reliability.lastImportAt)}
          </span>
        )}
        {reliability.sourceUrl && (
          <a
            href={reliability.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> Zdroj
          </a>
        )}
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

  return (
    <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">Daňové údaje</h3>
        <p className="text-xs text-muted-foreground">
          Zdroj: Finančná správa SR (financnasprava.sk, opendata.financnasprava.sk).
          Neprítomnosť v zozname dlžníkov nie je definitívnym potvrdením, že firma
          nemá žiadne nedoplatky.
        </p>
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Načítavam údaje z databázy…
        </div>
      ) : q.isError ? (
        <p className="text-sm text-destructive">
          Daňové údaje sa nepodarilo načítať.
        </p>
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

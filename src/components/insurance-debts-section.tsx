import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  Loader2,
  Info,
  RefreshCw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getCompanyInsuranceDebtsFn,
  type CompanyInsuranceDebtsPayload,
} from "@/lib/insurance-debt.functions";
import {
  INSURANCE_PROVIDER_SHORT,
  type CompanyInsuranceRow,
  type InsuranceProviderId,
} from "@/lib/insurance-debt.types";

const HEALTH_PROVIDERS: InsuranceProviderId[] = ["vszp", "dovera", "union"];

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

/** Row-level state resolved from the payload + special-case rules. */
type RowUiState =
  | { kind: "debt_found"; amount: number | null; recordDate: string | null }
  | { kind: "not_in_list"; recordDate: string | null }
  | { kind: "pending" } // dataset not yet imported (state 2)
  | { kind: "not_available" }; // health insurance always

function resolveRowState(row: CompanyInsuranceRow): RowUiState {
  if (HEALTH_PROVIDERS.includes(row.provider)) {
    return { kind: "not_available" };
  }
  const s = row.state;
  if (s.kind === "debt_found") {
    return { kind: "debt_found", amount: s.amount, recordDate: s.recordDate };
  }
  if (s.kind === "not_in_list") {
    return { kind: "not_in_list", recordDate: row.lastSuccessAt };
  }
  // "pending" (no successful run) and "unverified" (failed) — both mean
  // the dataset hasn't produced a usable result yet. We treat them as
  // "not yet imported" per spec (state 2). A real query failure surfaces
  // above at q.isError, not here.
  return { kind: "pending" };
}

function InsuranceRow({ row }: { row: CompanyInsuranceRow }) {
  const s = resolveRowState(row);
  const providerBadge = (
    <Badge variant="secondary" className="rounded-full text-[10px]">
      {INSURANCE_PROVIDER_SHORT[row.provider]}
    </Badge>
  );

  if (s.kind === "not_available") {
    return (
      <li className="flex items-start gap-3 py-3">
        <div className="rounded-lg bg-muted p-2 text-muted-foreground">
          <Info className="h-4 w-4" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{row.label}</span>
            {providerBadge}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Údaje zdravotných poisťovní zatiaľ nie sú dostupné.
          </div>
        </div>
      </li>
    );
  }

  if (s.kind === "pending") {
    return (
      <li className="flex items-start gap-3 py-3">
        <div className="rounded-lg bg-muted p-2 text-muted-foreground">
          <RefreshCw className="h-4 w-4" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{row.label}</span>
            {providerBadge}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Dáta z tohto zdroja sa pripravujú. Import prebieha automaticky na dennej báze.
          </div>
        </div>
      </li>
    );
  }

  if (s.kind === "not_in_list") {
    return (
      <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-success/15 p-2 text-success">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{row.label}</span>
              {providerBadge}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Spoločnosť sa nenachádza v zverejnenom zozname.
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Neprítomnosť v zozname nie je definitívnym dôkazom, že firma nemá záväzky.
            </div>
          </div>
        </div>
        {s.recordDate && (
          <span className="text-[11px] text-muted-foreground">
            Údaje k: {formatDate(s.recordDate)}
          </span>
        )}
      </li>
    );
  }

  // debt_found
  const amount = formatEur(s.amount);
  const recordDate = formatDate(s.recordDate);
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-destructive/15 p-2 text-destructive">
          <ShieldAlert className="h-4 w-4" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{row.label}</span>
            {providerBadge}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">Evidovaný dlh</div>
          {(amount || recordDate) && (
            <div className="mt-1 text-xs">
              {amount && <span className="font-semibold">{amount}</span>}
              {amount && recordDate && <span> · </span>}
              {recordDate && <span>k dátumu {recordDate}</span>}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        {row.sourceUrl && (
          <a
            href={row.sourceUrl}
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

export function InsuranceDebtsSection({ ico }: { ico: string }) {
  const fn = useServerFn(getCompanyInsuranceDebtsFn);
  const q = useQuery<CompanyInsuranceDebtsPayload>({
    queryKey: ["insurance-debts", ico],
    queryFn: () => fn({ data: { ico } }),
    staleTime: 60 * 60_000,
  });

  const rows = q.data?.rows ?? [];
  const socialRow = rows.find((r) => r.provider === "social_insurance");
  const headerDate =
    socialRow &&
    (socialRow.state.kind === "debt_found"
      ? socialRow.state.recordDate
      : socialRow.state.kind === "not_in_list"
        ? socialRow.lastSuccessAt
        : null);

  return (
    <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">Záväzky voči poisťovniam</h3>
          <p className="text-xs text-muted-foreground">
            Údaje pochádzajú z verejne zverejnených zoznamov dlžníkov Sociálnej poisťovne a
            zdravotných poisťovní. Neprítomnosť v zozname nie je definitívnym dôkazom, že firma
            nemá žiadne záväzky.
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
            Údaje o poisťovniach sa nepodarilo načítať.
          </p>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            Skúsiť znova
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((row) => (
            <InsuranceRow key={row.provider} row={row} />
          ))}
        </ul>
      )}
    </Card>
  );
}

import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, ShieldAlert, ShieldCheck, ShieldQuestion, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getCompanyInsuranceDebtsFn,
  type CompanyInsuranceDebtsPayload,
} from "@/lib/insurance-debt.functions";
import {
  INSURANCE_PROVIDER_SHORT,
  type CompanyInsuranceRow,
} from "@/lib/insurance-debt.types";

function stateLabel(row: CompanyInsuranceRow): {
  label: string;
  className: string;
  icon: typeof ShieldCheck;
} {
  switch (row.state.kind) {
    case "debt_found":
      return {
        label: "Evidovaný dlh",
        className: "bg-destructive/15 text-destructive",
        icon: ShieldAlert,
      };
    case "not_in_list":
      return {
        label: "Firma sa nenachádza v zverejnenom zozname dlžníkov",
        className: "bg-success/15 text-success",
        icon: ShieldCheck,
      };
    case "unverified":
      return {
        label: "Stav sa nepodarilo overiť",
        className: "bg-warning/25 text-warning-foreground",
        icon: ShieldQuestion,
      };
    case "pending":
      return {
        label: "Pripravuje sa",
        className: "bg-muted text-foreground",
        icon: Loader2,
      };
  }
}

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

export function InsuranceDebtsSection({ ico }: { ico: string }) {
  const fn = useServerFn(getCompanyInsuranceDebtsFn);
  const q = useQuery<CompanyInsuranceDebtsPayload>({
    queryKey: ["insurance-debts", ico],
    queryFn: () => fn({ data: { ico } }),
    staleTime: 60 * 60_000,
  });

  return (
    <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">Záväzky voči poisťovniam</h3>
          <p className="text-xs text-muted-foreground">
            Údaje pochádzajú z verejne zverejnených zoznamov dlžníkov Sociálnej poisťovne a
            zdravotných poisťovní. Neprítomnosť v zozname nie je definitívnym dôkazom, že firma
            nemá žiadne záväzky.
          </p>
        </div>
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Načítavam údaje z databázy…
        </div>
      ) : q.isError ? (
        <p className="text-sm text-destructive">
          Údaje o poisťovniach sa nepodarilo načítať.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {q.data?.rows.map((row) => {
            const s = stateLabel(row);
            const Icon = s.icon;
            const amount =
              row.state.kind === "debt_found" ? formatEur(row.state.amount) : null;
            const recordDate =
              row.state.kind === "debt_found" ? formatDate(row.state.recordDate) : null;
            const importedAt = formatDateTime(row.lastImportAt);
            return (
              <li key={row.provider} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className={`rounded-lg p-2 ${s.className}`}>
                    <Icon
                      className={`h-4 w-4 ${row.state.kind === "pending" ? "animate-spin" : ""}`}
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{row.label}</span>
                      <Badge variant="secondary" className="rounded-full text-[10px]">
                        {INSURANCE_PROVIDER_SHORT[row.provider]}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
                    {(amount || recordDate) && (
                      <div className="mt-1 text-xs">
                        {amount && <span className="font-semibold">{amount}</span>}
                        {amount && recordDate && <span> · </span>}
                        {recordDate && <span>k dátumu {recordDate}</span>}
                      </div>
                    )}
                    {row.state.kind === "unverified" && row.state.reason && (
                      <div className="mt-1 text-xs text-muted-foreground">{row.state.reason}</div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-start gap-1 sm:items-end">
                  {importedAt && (
                    <span className="text-[11px] text-muted-foreground">
                      Import: {importedAt}
                    </span>
                  )}
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
          })}
        </ul>
      )}
    </Card>
  );
}

// RPO (Register právnických osôb) section for the company profile.
// Renders four-state loading pattern and a collapsible change-history timeline.

import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Users, Crown, ChevronDown, ChevronUp, AlertCircle, Clock } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getRpoDataFn,
  type RpoHistoryRecord,
  type RpoPersonRecord,
} from "@/lib/company-records.functions";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("sk-SK", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const CHANGE_LABEL: Record<RpoHistoryRecord["changeType"], string> = {
  name_changed: "Zmena obchodného mena",
  address_changed: "Zmena sídla",
  legal_form_changed: "Zmena právnej formy",
  statutory_body_changed: "Zmena štatutárneho orgánu",
  shareholder_changed: "Zmena spoločníkov",
  other: "Ostatné",
};

const CHANGE_BADGE: Record<RpoHistoryRecord["changeType"], string> = {
  name_changed: "bg-blue-100 text-blue-700",
  address_changed: "bg-amber-100 text-amber-700",
  legal_form_changed: "bg-purple-100 text-purple-700",
  statutory_body_changed: "bg-emerald-100 text-emerald-700",
  shareholder_changed: "bg-cyan-100 text-cyan-700",
  other: "bg-muted text-muted-foreground",
};

export function RpoSection({ ico }: { ico: string }) {
  const fetchRpo = useServerFn(getRpoDataFn);
  const q = useQuery({
    queryKey: ["rpo-data", ico],
    queryFn: () => fetchRpo({ data: { ico } }),
    staleTime: 5 * 60_000,
  });

  const persons = q.data?.persons ?? [];
  const history = q.data?.history ?? [];
  const fresh = q.data?.freshness;

  const currentPersons = useMemo(() => persons.filter((p) => p.isCurrent), [persons]);
  const statutory = currentPersons.filter((p) => p.personType === "statutory_body");
  const shareholders = currentPersons.filter(
    (p) => p.personType === "shareholder" || p.personType === "founder",
  );

  const datasetDate = fresh?.lastSuccessAt ? formatDate(fresh.lastSuccessAt) : null;

  // ---- state resolution ----
  if (q.isLoading) {
    return <RpoSkeleton />;
  }

  if (q.isError) {
    return (
      <Card className="rounded-2xl border-destructive/40 bg-destructive/5 p-6 shadow-soft">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
          <div className="flex-1">
            <div className="text-sm font-medium text-destructive">
              Údaje z RPO sa nepodarilo načítať.
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 rounded-xl"
              onClick={() => q.refetch()}
            >
              Skúsiť znova
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const notImported = !fresh?.lastSuccessAt;
  const notFound = fresh?.status === "not_found";

  if (notImported) {
    return (
      <Card className="rounded-2xl border-border/70 bg-muted/40 p-6 shadow-soft">
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">Údaje z RPO — Zdroj: RPO</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Dáta z registra právnických osôb sa pripravujú. Import prebieha
              automaticky.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (notFound) {
    return (
      <Card className="rounded-2xl border-border/70 bg-muted/40 p-6 shadow-soft">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">Údaje z RPO — Zdroj: RPO</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Spoločnosť sa v Registri právnických osôb nenachádza.
            </p>
            {datasetDate && (
              <p className="mt-2 text-xs text-muted-foreground">Údaje k: {datasetDate}</p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <RpoPeopleCard
        title="Štatutárny orgán"
        icon={Users}
        people={statutory}
        datasetDate={datasetDate}
      />
      <RpoPeopleCard
        title="Spoločníci"
        icon={Crown}
        people={shareholders}
        datasetDate={datasetDate}
      />
      <RpoHistoryTimeline history={history} />
    </div>
  );
}

function RpoSkeleton() {
  return (
    <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-40 rounded bg-muted" />
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-2/3 rounded bg-muted" />
      </div>
    </Card>
  );
}

function RpoPeopleCard({
  title,
  icon: Icon,
  people,
  datasetDate,
}: {
  title: string;
  icon: typeof Users;
  people: RpoPersonRecord[];
  datasetDate: string | null;
}) {
  return (
    <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <h3 className="text-base font-semibold">{title}</h3>
          <Badge variant="outline" className="rounded-full text-[10px]">
            Zdroj: RPO
          </Badge>
        </div>
        {datasetDate && (
          <span className="text-xs text-muted-foreground">Údaje k: {datasetDate}</span>
        )}
      </div>

      {people.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          V registri nie sú aktuálne evidované žiadne osoby v tejto kategórii.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {people.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-1 rounded-xl border border-border/60 bg-background/60 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="font-medium">{p.fullName}</div>
                {p.functionLabel && (
                  <div className="text-xs text-muted-foreground">{p.functionLabel}</div>
                )}
                {p.address && (
                  <div className="mt-1 text-xs text-muted-foreground">{p.address}</div>
                )}
              </div>
              <div className="text-right text-xs text-muted-foreground">
                {p.validFrom && <div>vo funkcii od {formatDate(p.validFrom)}</div>}
                {(p.shareAmount != null || p.sharePercent != null) && (
                  <div className="mt-1 font-medium text-foreground">
                    {p.shareAmount != null &&
                      `${p.shareAmount.toLocaleString("sk-SK")} ${p.shareCurrency ?? "EUR"}`}
                    {p.shareAmount != null && p.sharePercent != null && " · "}
                    {p.sharePercent != null && `${p.sharePercent}%`}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RpoHistoryTimeline({ history }: { history: RpoHistoryRecord[] }) {
  const [open, setOpen] = useState(false);
  if (history.length === 0) return null;
  return (
    <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold">História zmien</h3>
          <Badge variant="outline" className="rounded-full text-[10px]">
            {history.length}
          </Badge>
          <Badge variant="outline" className="rounded-full text-[10px]">
            Zdroj: RPO
          </Badge>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <ol className="mt-4 space-y-3 border-l border-border/60 pl-4">
          {history.map((h) => (
            <li key={h.id} className="relative">
              <span className="absolute -left-[21px] mt-1 h-2.5 w-2.5 rounded-full bg-primary" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {h.effectiveDate ? formatDate(h.effectiveDate) : "—"}
                </span>
                <Badge className={`${CHANGE_BADGE[h.changeType]} rounded-full text-[10px]`}>
                  {CHANGE_LABEL[h.changeType]}
                </Badge>
                {h.fieldLabel && (
                  <span className="text-xs text-muted-foreground">{h.fieldLabel}</span>
                )}
              </div>
              <div className="mt-1 text-sm">
                {h.oldValue && (
                  <span className="text-muted-foreground line-through">{h.oldValue}</span>
                )}
                {h.oldValue && h.newValue && <span className="mx-2 text-muted-foreground">→</span>}
                {h.newValue && <span className="font-medium">{h.newValue}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

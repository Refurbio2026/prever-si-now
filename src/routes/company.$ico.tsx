import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  MapPin,
  Calendar,
  Receipt,
  Bell,
  ArrowLeft,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  Users,
  Crown,
  ShieldCheck,
  ExternalLink,
  Clock,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { RiskBadge, formatCurrency } from "@/components/risk-badge";
import { CompanyActions } from "@/components/company-actions";
import { mockAlerts, mockHistory } from "@/lib/mock-data";
import { getCompanyIntelligenceFn } from "@/lib/company-intelligence.functions";
import type { AccountingStatement, Company, CompanyPerson, FinancialYear, RiskIndicator } from "@/lib/types";
import type { ProviderSourceStatus, ProviderDiagnostic } from "@/lib/providers/types";
import { PROVIDER_META, IMPLEMENTED_SOURCES } from "@/lib/providers/registry-labels";


export const Route = createFileRoute("/company/$ico")({
  component: CompanyProfilePage,
  head: ({ params }) => ({
    meta: [
      { title: `Firma ${params.ico} — PreverSi.sk` },
      {
        name: "description",
        content: `Kompletné preverenie firmy s IČO ${params.ico}. Finančné zdravie, riziká, konatelia a AI analýza.`,
      },
    ],
  }),
});

function CompanyProfilePage() {
  const { ico } = Route.useParams();
  const fetchCompany = useServerFn(getCompanyIntelligenceFn);
  const query = useQuery({
    queryKey: ["company-intel", ico],
    queryFn: () => fetchCompany({ data: { ico } }),
    staleTime: 5 * 60_000,
  });

  if (query.isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="mx-auto flex max-w-6xl items-center justify-center px-4 py-24">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Načítavam údaje z verejných registrov…</span>
          </div>
        </div>
        <SiteFooter />
      </div>
    );
  }

  // Network-level failure (queryFn threw) → generic retry screen.
  if (query.isError) {
    const message = (query.error as Error)?.message ?? "Nepodarilo sa spojiť so serverom.";
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="mx-auto max-w-xl px-4 py-24 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
          <h1 className="mt-3 text-2xl font-bold">Chyba pri načítaní</h1>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
          <div className="mt-6 flex justify-center gap-2">
            <Button onClick={() => query.refetch()} className="rounded-xl">
              Skúsiť znovu
            </Button>
            <Button variant="outline" asChild className="rounded-xl">
              <Link to="/search">Späť na vyhľadávanie</Link>
            </Button>
          </div>
        </div>
        <SiteFooter />
      </div>
    );
  }

  if (!query.data) return null;

  // Server returned a structured failure (e.g. Finstat aggregate crashed).
  if (!query.data.ok) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="mx-auto max-w-xl px-4 py-24 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
          <h1 className="mt-3 text-2xl font-bold">Chyba pri načítaní</h1>
          <p className="mt-2 text-sm text-muted-foreground">{query.data.error}</p>
          <div className="mt-6 flex justify-center gap-2">
            <Button onClick={() => query.refetch()} className="rounded-xl">
              Skúsiť znovu
            </Button>
            <Button variant="outline" asChild className="rounded-xl">
              <Link to="/search">Späť na vyhľadávanie</Link>
            </Button>
          </div>
        </div>
        <SiteFooter />
      </div>
    );
  }

  const intel = query.data.data;

  // Company not found (Finstat returned empty / invalid IČO).
  if (!intel.company) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="mx-auto max-w-xl px-4 py-24 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-warning-foreground" />
          <h1 className="mt-3 text-2xl font-bold">Firma sa nenašla.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pre IČO {ico} sme nenašli žiadne údaje.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="outline" asChild className="rounded-xl">
              <Link to="/search">Späť na vyhľadávanie</Link>
            </Button>
          </div>
          <ProviderStatusSection
            ico={ico}
            sources={intel.sources}
            diagnostics={intel.diagnostics}
            className="mx-auto mt-10 max-w-2xl text-left"
          />
        </div>
        <SiteFooter />
      </div>
    );
  }
  return (
    <CompanyProfileView
      ico={ico}
      company={intel.company}
      financials={intel.financials}
      statements={intel.statements}
      people={intel.people}
      risks={intel.risks}
      sources={intel.sources}
      partial={intel.partial}
      diagnostics={intel.diagnostics}
    />
  );
}


function CompanyProfileView({
  ico,
  company,
  financials,
  statements,
  people,
  risks,
  sources,
  partial,
  diagnostics,
}: {
  ico: string;
  company: Company;
  financials: FinancialYear[];
  statements: AccountingStatement[];
  people: CompanyPerson[];
  risks: RiskIndicator[];
  sources: ProviderSourceStatus[];
  partial: boolean;
  diagnostics?: ProviderDiagnostic[];
}) {


  const executives = people.filter((p) => p.role === "executive");
  const owners = people.filter((p) => p.role === "owner");
  const beneficials = people.filter((p) => p.role === "beneficial_owner");
  const criticalRisks = risks.filter((r) => r.status !== "clear");
  const hasFinancials = financials.length > 0;
  const latestFin = hasFinancials ? financials[financials.length - 1] : undefined;
  const prevFin = hasFinancials && financials.length > 1 ? financials[financials.length - 2] : latestFin;
  const okSources = sources.filter((s) => s.state === "ok").length;


  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {partial && (
        <div className="border-b border-warning/30 bg-warning/10">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 text-sm text-warning-foreground sm:px-6">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>
              Niektoré údaje sú momentálne nedostupné. Overených zdrojov:{" "}
              <strong>{okSources}</strong> / {sources.length}.
            </span>
          </div>
        </div>
      )}

      <div className="border-b border-border/60 bg-secondary/30">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <Link
            to="/search"
            className="mb-6 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Späť na výsledky
          </Link>

          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-1 items-start gap-4">
              <div className="inline-flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-[image:var(--gradient-primary)] text-primary-foreground shadow-soft">
                <Building2 className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold sm:text-3xl">{company.name}</h1>
                  <RiskBadge level={company.riskLevel} />
                  {company.vatPayer && (
                    <Badge variant="secondary" className="rounded-full">
                      Platiteľ DPH
                    </Badge>
                  )}
                </div>
                <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                  <InfoRow icon={Receipt} label="IČO" value={na(company.ico)} />
                  <InfoRow icon={Receipt} label="DIČ" value={na(company.dic)} />
                  <InfoRow icon={Receipt} label="IČ DPH" value={na(company.icDph)} />
                  <InfoRow
                    icon={MapPin}
                    label="Adresa"
                    value={na([company.address, company.city].filter((v) => v && v !== "—").join(", "))}
                  />
                  <InfoRow icon={Building2} label="Právna forma" value={na(company.legalForm)} />
                  <InfoRow
                    icon={Calendar}
                    label="Registrácia"
                    value={
                      company.registrationDate
                        ? new Date(company.registrationDate).toLocaleDateString("sk-SK")
                        : "Nedostupné"
                    }
                  />
                  {company.registrationNumberText && (
                    <InfoRow icon={Receipt} label="Reg. číslo" value={company.registrationNumberText} />
                  )}
                  {(company.skNaceCode || company.skNaceText) && (
                    <InfoRow
                      icon={Building2}
                      label="SK NACE"
                      value={[company.skNaceCode, company.skNaceText].filter(Boolean).join(" – ")}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-stretch gap-3 lg:w-80">
              <Card className="rounded-2xl border-border/70 p-5 shadow-soft">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Celkové skóre
                  </span>
                  <RiskBadge level={company.riskLevel} />
                </div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-4xl font-bold">{company.riskScore}</span>
                  <span className="text-sm text-muted-foreground">/ 100</span>
                </div>
                <Progress value={company.riskScore} className="mt-3 h-2" />
              </Card>
              <CompanyActions company={company} />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Tabs defaultValue="overview">
          <TabsList className="mb-6 flex h-auto w-full flex-wrap justify-start gap-1 rounded-2xl bg-secondary/60 p-1">
            {[
              { v: "overview", l: "Prehľad" },
              { v: "financials", l: "Financie" },
              { v: "people", l: "Osoby" },
              { v: "risks", l: "Riziká" },
              { v: "history", l: "História" },
              { v: "monitoring", l: "Monitoring" },
            ].map((t) => (
              <TabsTrigger key={t.v} value={t.v} className="rounded-xl px-4 py-2 text-sm">
                {t.l}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* OVERVIEW */}
          <TabsContent value="overview" className="space-y-6">
            {company.aiSummary && (
              <Card className="overflow-hidden rounded-2xl border-primary/20 shadow-soft">
                <div className="bg-[image:var(--gradient-primary)] px-6 py-4">
                  <div className="flex items-center gap-2 text-primary-foreground">
                    <Sparkles className="h-4 w-4" />
                    <span className="text-sm font-semibold">AI zhrnutie</span>
                  </div>
                </div>
                <div className="p-6">
                  <p className="text-sm leading-relaxed text-foreground">{company.aiSummary}</p>
                </div>
              </Card>
            )}

            {criticalRisks.length > 0 && (
              <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
                <div className="mb-4 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning-foreground" />
                  <h3 className="text-lg font-semibold">Kľúčové upozornenia</h3>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {criticalRisks.map((r) => (
                    <RiskRow key={r.key} risk={r} />
                  ))}
                </div>
              </Card>
            )}

            {(company.warnings?.length || company.paymentOrderWarnings?.length) ? (
              <Card className="rounded-2xl border-warning/40 bg-warning/5 p-6 shadow-soft">
                <div className="mb-3 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning-foreground" />
                  <h3 className="text-lg font-semibold">Upozornenia z registra</h3>
                </div>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {company.warnings?.map((w, i) => (
                    <li key={`w${i}`}>{w}</li>
                  ))}
                  {company.paymentOrderWarnings?.map((w, i) => (
                    <li key={`p${i}`}>
                      <span className="font-medium">Platobný rozkaz:</span> {w}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
              <h3 className="mb-5 text-lg font-semibold">Základné informácie</h3>
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <InfoField label="Odvetvie" value={na(company.industry)} />
                <InfoField label="Počet zamestnancov" value={na(company.employees ? String(company.employees) : undefined)} />
                <InfoField label="Web" value={na(company.website)} />
                <InfoField label="Tržby" value={company.revenue ? formatCurrency(company.revenue) : "Nedostupné"} />
                <InfoField label="Zisk" value={company.profit ? formatCurrency(company.profit) : "Nedostupné"} />
                <InfoField label="Právna forma" value={na(company.legalForm)} />
                <InfoField label="Aktíva" value={company.latestAssets ? formatCurrency(company.latestAssets) : "Nedostupné"} />
                <InfoField label="Pasíva" value={company.latestLiabilities ? formatCurrency(company.latestLiabilities) : "Nedostupné"} />
                <InfoField label="Platiteľ DPH" value={company.vatPayer ? "Áno" : "Nie"} />
                <InfoField label="Reg. číslo" value={na(company.registrationNumberText)} />
                <InfoField label="SK NACE kód" value={na(company.skNaceCode)} />
                <InfoField label="SK NACE popis" value={na(company.skNaceText)} />
              </div>
            </Card>

            <ProviderStatusSection ico={ico} sources={sources} diagnostics={diagnostics} />
          </TabsContent>


          {/* FINANCIALS */}
          <TabsContent value="financials" className="space-y-6">
            {hasFinancials && latestFin && prevFin ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <TrendCard label={`Tržby (${latestFin.year})`} value={latestFin.revenue} prev={prevFin.revenue} />
                <TrendCard label={`Zisk (${latestFin.year})`} value={latestFin.profit} prev={prevFin.profit} />
                <TrendCard label="EBITDA" value={latestFin.ebitda} prev={prevFin.ebitda} />
                <TrendCard
                  label="Aktíva / Pasíva"
                  value={latestFin.assets - latestFin.liabilities}
                  prev={prevFin.assets - prevFin.liabilities}
                  positiveOnly
                />
              </div>
            ) : (
              <Card className="rounded-2xl border-dashed p-8 text-center text-sm text-muted-foreground">
                Finančné údaje nie sú k dispozícii.
              </Card>
            )}


            <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
              <h3 className="mb-4 text-lg font-semibold">Vývoj tržieb</h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={financials} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="oklch(0.55 0.2 258)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="oklch(0.55 0.2 258)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.015 255)" vertical={false} />
                    <XAxis dataKey="year" stroke="oklch(0.5 0.03 255)" fontSize={12} axisLine={false} tickLine={false} />
                    <YAxis
                      stroke="oklch(0.5 0.03 255)"
                      fontSize={12}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}M`}
                    />
                    <RTooltip
                      contentStyle={{ borderRadius: 12, border: "1px solid oklch(0.92 0.015 255)" }}
                      formatter={(v: number) => formatCurrency(v)}
                    />
                    <Area type="monotone" dataKey="revenue" stroke="oklch(0.55 0.2 258)" strokeWidth={2} fill="url(#revGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
              <h3 className="mb-4 text-lg font-semibold">Zisk vs. EBITDA</h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={financials} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.015 255)" vertical={false} />
                    <XAxis dataKey="year" stroke="oklch(0.5 0.03 255)" fontSize={12} axisLine={false} tickLine={false} />
                    <YAxis
                      stroke="oklch(0.5 0.03 255)"
                      fontSize={12}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}M`}
                    />
                    <RTooltip
                      contentStyle={{ borderRadius: 12, border: "1px solid oklch(0.92 0.015 255)" }}
                      formatter={(v: number) => formatCurrency(v)}
                    />
                    <Bar dataKey="profit" fill="oklch(0.55 0.2 258)" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="ebitda" fill="oklch(0.72 0.16 245)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
              <h3 className="mb-4 text-lg font-semibold">Aktíva a pasíva</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-3 text-left font-medium">Rok</th>
                      <th className="py-3 text-right font-medium">Tržby</th>
                      <th className="py-3 text-right font-medium">Zisk</th>
                      <th className="py-3 text-right font-medium">EBITDA</th>
                      <th className="py-3 text-right font-medium">Aktíva</th>
                      <th className="py-3 text-right font-medium">Pasíva</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...financials].reverse().map((f) => (
                      <tr key={f.year} className="border-b border-border/50 last:border-0">
                        <td className="py-3 font-medium">{f.year}</td>
                        <td className="py-3 text-right">{formatCurrency(f.revenue)}</td>
                        <td className="py-3 text-right">{formatCurrency(f.profit)}</td>
                        <td className="py-3 text-right">{formatCurrency(f.ebitda)}</td>
                        <td className="py-3 text-right">{formatCurrency(f.assets)}</td>
                        <td className="py-3 text-right">{formatCurrency(f.liabilities)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* PEOPLE */}
          <TabsContent value="people" className="space-y-6">
            <PeopleCard title="Konatelia" icon={Users} people={executives} />
            <PeopleCard title="Spoločníci" icon={Crown} people={owners} showShare />
            <PeopleCard title="Koneční užívatelia výhod (KUV)" icon={ShieldCheck} people={beneficials} showShare />
          </TabsContent>

          {/* RISKS */}
          <TabsContent value="risks" className="space-y-3">
            {company.debtIndicators && (
              <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
                <h3 className="mb-4 text-lg font-semibold">Ukazovatele dlhov</h3>
                <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                  <InfoField
                    label="Daňový nedoplatok"
                    value={company.debtIndicators.taxDebt != null ? formatCurrency(company.debtIndicators.taxDebt) : "Nedostupné"}
                  />
                  <InfoField
                    label="Súdny dlh"
                    value={company.debtIndicators.judicialDebt != null ? formatCurrency(company.debtIndicators.judicialDebt) : "Nedostupné"}
                  />
                  <InfoField
                    label="Sociálna poisťovňa"
                    value={company.debtIndicators.socialDebt != null ? formatCurrency(company.debtIndicators.socialDebt) : "Nedostupné"}
                  />
                  <InfoField
                    label="Zdravotné poisťovne"
                    value={company.debtIndicators.healthDebt != null ? formatCurrency(company.debtIndicators.healthDebt) : "Nedostupné"}
                  />
                </div>
              </Card>
            )}
            {risks.map((r) => (
              <RiskRow key={r.key} risk={r} large />
            ))}
          </TabsContent>

          {/* HISTORY */}
          <TabsContent value="history">
            <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
              <h3 className="mb-6 text-lg font-semibold">Časová os zmien</h3>
              <ol className="relative border-l border-border pl-6">
                {mockHistory.map((h, i) => (
                  <li key={i} className="relative mb-6 last:mb-0">
                    <span
                      className={`absolute -left-[29px] flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-background ${
                        h.severity === "critical"
                          ? "bg-destructive"
                          : h.severity === "warning"
                          ? "bg-warning"
                          : h.severity === "success"
                          ? "bg-success"
                          : "bg-primary"
                      }`}
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {new Date(h.date).toLocaleDateString("sk-SK")}
                    </div>
                    <div className="mt-1 text-sm font-semibold">{h.type}</div>
                    <div className="text-sm text-muted-foreground">{h.description}</div>
                  </li>
                ))}
              </ol>
            </Card>
          </TabsContent>

          {/* MONITORING */}
          <TabsContent value="monitoring" className="space-y-6">
            <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-primary">
                    <Bell className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-semibold">Táto firma nie je sledovaná</div>
                    <div className="text-xs text-muted-foreground">
                      Zapnite monitoring a dostávajte notifikácie o zmenách e-mailom.
                    </div>
                  </div>
                </div>
                <Button className="rounded-xl shadow-soft">
                  <Bell className="mr-1.5 h-4 w-4" /> Zapnúť monitoring
                </Button>
              </div>
            </Card>

            <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
              <h3 className="mb-4 text-lg font-semibold">Najnovšie upozornenia</h3>
              <div className="space-y-3">
                {mockAlerts.map((a) => (
                  <div key={a.id} className="rounded-xl border border-border/60 bg-background p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{a.title}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{a.description}</div>
                      </div>
                      <Badge
                        variant="secondary"
                        className={`rounded-full ${
                          a.severity === "critical"
                            ? "bg-destructive/15 text-destructive"
                            : a.severity === "warning"
                            ? "bg-warning/20 text-warning-foreground"
                            : a.severity === "success"
                            ? "bg-success/15 text-success"
                            : "bg-primary/10 text-primary"
                        }`}
                      >
                        {new Date(a.date).toLocaleDateString("sk-SK")}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <SiteFooter />
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />
      <span className="text-[10px] uppercase tracking-wide">{label}:</span>
      <span className="truncate font-medium text-foreground">{value}</span>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function TrendCard({
  label,
  value,
  prev,
  positiveOnly,
}: {
  label: string;
  value: number;
  prev: number;
  positiveOnly?: boolean;
}) {
  const diff = value - prev;
  const pct = prev !== 0 ? (diff / Math.abs(prev)) * 100 : 0;
  const up = diff >= 0;
  return (
    <Card className="rounded-2xl border-border/70 p-5 shadow-soft">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-bold">{formatCurrency(value)}</div>
      <div
        className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${
          positiveOnly || up ? "text-success" : "text-destructive"
        }`}
      >
        {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
        {pct >= 0 ? "+" : ""}
        {pct.toFixed(1)}% r/r
      </div>
    </Card>
  );
}

function RiskRow({ risk, large }: { risk: RiskIndicator; large?: boolean }) {
  const cfg = {
    clear: { icon: CheckCircle2, cls: "text-success bg-success/15", label: "V poriadku" },
    warning: { icon: AlertTriangle, cls: "text-warning-foreground bg-warning/25", label: "Upozornenie" },
    critical: { icon: XCircle, cls: "text-destructive bg-destructive/15", label: "Kritické" },
  }[risk.status];
  const Icon = cfg.icon;

  return (
    <Card className={`rounded-2xl border-border/70 shadow-soft ${large ? "p-5" : "p-4"}`}>
      <div className="flex items-start gap-3">
        <div className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${cfg.cls}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-medium">{risk.label}</div>
            <Badge variant="secondary" className={`rounded-full text-[10px] ${cfg.cls}`}>
              {cfg.label}
            </Badge>
          </div>
          <div className="mt-0.5 text-sm text-muted-foreground">{risk.detail}</div>
        </div>
        {risk.amount !== undefined && risk.amount > 0 && (
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Suma</div>
            <div className="text-sm font-semibold text-destructive">{formatCurrency(risk.amount)}</div>
          </div>
        )}
      </div>
    </Card>
  );
}

function PeopleCard({
  title,
  icon: Icon,
  people,
  showShare,
}: {
  title: string;
  icon: typeof Users;
  people: CompanyPerson[];
  showShare?: boolean;
}) {
  return (
    <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
      <div className="mb-5 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-lg font-semibold">{title}</h3>
        <Badge variant="secondary" className="rounded-full">
          {people.length}
        </Badge>
      </div>
      <div className="divide-y divide-border/60">
        {people.map((p, i) => (
          <div key={i} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
            <div className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-primary">
              {initials(p.name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{p.name}</div>
              <div className="text-xs text-muted-foreground">
                od {new Date(p.since).toLocaleDateString("sk-SK")}
              </div>
            </div>
            {showShare && p.share !== undefined && (
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Podiel</div>
                <div className="text-sm font-semibold">{p.share}%</div>
              </div>
            )}
            <Button variant="ghost" size="icon" className="rounded-full">
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function na(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "Nedostupné";
  const s = String(value).trim();
  if (!s || s === "—") return "Nedostupné";
  return s;
}

function initials(name: string): string {
  return name
    .replace(/[.,]/g, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// ---------- Provider status ----------

function ProviderStatusSection({
  ico,
  sources,
  diagnostics,
  className,
}: {
  ico: string;
  sources: ProviderSourceStatus[];
  diagnostics?: ProviderDiagnostic[];
  className?: string;
}) {
  const byId = new Map<string, ProviderSourceStatus[]>();
  for (const s of sources) {
    const arr = byId.get(s.source) ?? [];
    arr.push(s);
    byId.set(s.source, arr);
  }
  const anyNotWired = PROVIDER_META.some((m) => !IMPLEMENTED_SOURCES.has(m.id));

  return (
    <div className={className ?? "space-y-4"}>
      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Zdroje verejných registrov</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Stav napojenia na jednotlivé verejné registre pre IČO {ico}.
            </p>
          </div>
        </div>

        {anyNotWired && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>Niektoré verejné registre ešte nie sú napojené.</span>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PROVIDER_META.map((meta) => {
            const implemented = IMPLEMENTED_SOURCES.has(meta.id);
            const statuses = byId.get(meta.id) ?? [];
            const state = deriveDisplayState(implemented, statuses);
            const cfg = STATE_CFG[state];
            const Icon = cfg.icon;
            return (
              <div
                key={meta.id}
                className="flex items-start gap-3 rounded-xl border border-border/60 bg-background p-3"
              >
                <div
                  className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${cfg.cls}`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium">{meta.short}</div>
                    <Badge variant="secondary" className={`rounded-full text-[10px] ${cfg.cls}`}>
                      {cfg.label}
                    </Badge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{meta.label}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {diagnostics && diagnostics.length > 0 && (
        <Card className="rounded-2xl border-dashed border-border/70 p-6 shadow-soft">
          <div className="mb-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Diagnostika (dev mode)</h3>
          </div>
          <div className="space-y-3 text-xs">
            {diagnostics.map((d, i) => (
              <div key={i} className="rounded-lg border border-border/60 bg-secondary/30 p-3">
                <div className="mb-1 grid gap-1 sm:grid-cols-2">
                  <DiagRow label="IČO" value={ico} />
                  <DiagRow label="Provider" value={d.source} />
                  <DiagRow label="Endpoint" value={d.endpoint ?? "—"} />
                  <DiagRow label="HTTP" value={d.httpStatus != null ? String(d.httpStatus) : "—"} />
                  <DiagRow label="Kód chyby" value={d.errorCode ?? "—"} />
                  <DiagRow label="Normalizovaná chyba" value={d.normalizedError ?? "—"} />
                </div>
                {d.finalUrlMasked && (
                  <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                    URL: {d.finalUrlMasked}
                  </div>
                )}
                {d.rawError && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-background p-2 font-mono text-[10px]">
                    {d.rawError}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

const STATE_CFG: Record<
  "ok" | "empty" | "pending" | "unavailable" | "error",
  { icon: typeof CheckCircle2; cls: string; label: string }
> = {
  ok: { icon: CheckCircle2, cls: "text-success bg-success/15", label: "Aktívne" },
  empty: { icon: CheckCircle2, cls: "text-muted-foreground bg-secondary", label: "Bez dát" },
  pending: { icon: Clock, cls: "text-muted-foreground bg-secondary", label: "Pripravuje sa" },
  unavailable: { icon: AlertTriangle, cls: "text-warning-foreground bg-warning/20", label: "Nedostupné" },
  error: { icon: XCircle, cls: "text-destructive bg-destructive/15", label: "Chyba" },
};

function deriveDisplayState(
  implemented: boolean,
  statuses: ProviderSourceStatus[],
): "ok" | "empty" | "pending" | "unavailable" | "error" {
  if (!implemented) return "pending";
  if (statuses.length === 0) return "pending";
  if (statuses.some((s) => s.state === "ok")) return "ok";
  if (statuses.some((s) => s.state === "error")) return "error";
  if (statuses.some((s) => s.state === "unavailable" || s.state === "not_configured"))
    return "unavailable";
  return "empty";
}

function DiagRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="min-w-[110px] text-muted-foreground">{label}:</span>
      <span className="min-w-0 flex-1 break-all font-medium">{value}</span>
    </div>
  );
}

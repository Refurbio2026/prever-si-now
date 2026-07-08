import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Building2,
  MapPin,
  ArrowRight,
  Filter,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useState } from "react";

import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RiskBadge, riskLevelFromScore } from "@/components/risk-badge";
import { searchCompaniesFn } from "@/lib/finstat.functions";

type SearchParams = { q?: string };

export const Route = createFileRoute("/search")({
  component: SearchResultsPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    q: typeof s.q === "string" ? s.q : undefined,
  }),
  head: () => ({
    meta: [{ title: "Výsledky vyhľadávania — PreverSi.sk" }],
  }),
});

function SearchResultsPage() {
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: "/search" });
  const [query, setQuery] = useState(q ?? "");
  const searchFn = useServerFn(searchCompaniesFn);

  const results = useQuery({
    queryKey: ["finstat-search-public", q],
    enabled: !!q,
    queryFn: () => searchFn({ data: { query: q as string } }),
    staleTime: 60_000,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    navigate({ search: { q: trimmed } });
  };

  const items = results.data?.ok ? results.data.results : [];
  const apiError = results.data && !results.data.ok ? results.data : null;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="border-b border-border/60 bg-secondary/30">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <form
            onSubmit={submit}
            className="flex items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-soft"
          >
            <div className="flex flex-1 items-center gap-3 px-4">
              <Search className="h-5 w-5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Hľadať firmu podľa názvu alebo IČO..."
                className="h-11 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Button type="button" variant="ghost" className="hidden rounded-xl sm:inline-flex">
              <Filter className="mr-2 h-4 w-4" /> Filtre
            </Button>
            <Button type="submit" className="rounded-xl shadow-soft">
              Hľadať
            </Button>
          </form>

          <p className="mt-4 text-sm text-muted-foreground">
            {q ? (
              <>
                {results.isFetching ? (
                  "Vyhľadávam vo Finstat…"
                ) : (
                  <>
                    Nájdených{" "}
                    <span className="font-semibold text-foreground">{items.length}</span> firiem pre
                    „{q}"
                  </>
                )}
              </>
            ) : (
              <>Zadajte názov firmy alebo IČO na vyhľadávanie.</>
            )}
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {!q ? (
          <Card className="rounded-2xl border-dashed p-12 text-center shadow-soft">
            <Search className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">Začnite vyhľadávať</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Zadajte názov firmy alebo IČO vyššie.
            </p>
          </Card>
        ) : results.isLoading ? (
          <Card className="flex items-center justify-center gap-3 rounded-2xl border-dashed p-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Vyhľadávam vo Finstat…</span>
          </Card>
        ) : apiError ? (
          <Card className="rounded-2xl border-destructive/40 bg-destructive/5 p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
              <div>
                <div className="font-semibold text-destructive">Nepodarilo sa načítať výsledky</div>
                <p className="mt-1 text-sm text-muted-foreground">{apiError.error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 rounded-xl"
                  onClick={() => results.refetch()}
                >
                  Skúsiť znovu
                </Button>
              </div>
            </div>
          </Card>
        ) : items.length === 0 ? (
          <Card className="rounded-2xl border-border/70 p-12 text-center shadow-soft">
            <Building2 className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">Nenašli sme žiadnu firmu</h2>
            <p className="mt-1 text-sm text-muted-foreground">Skúste iný názov alebo IČO.</p>
          </Card>
        ) : (
          <div className="grid gap-4">
            {items.map((c) => (
              <Card
                key={c.ico}
                className="rounded-2xl border-border/70 p-6 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-elevated"
              >
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
                  <div className="flex flex-1 items-start gap-4">
                    <div className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold">{c.name}</h3>
                        {c.riskScore > 0 && <RiskBadge level={c.riskLevel} />}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>IČO {c.ico}</span>
                        {c.legalForm && c.legalForm !== "—" && (
                          <Badge variant="secondary" className="rounded-full text-[10px]">
                            {c.legalForm}
                          </Badge>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {c.address}
                          {c.city && c.city !== "—" ? `, ${c.city}` : ""}
                        </span>
                      </div>
                    </div>
                  </div>

                  <Button asChild className="rounded-xl shadow-soft lg:ml-2">
                    <Link to="/company/$ico" params={{ ico: c.ico }}>
                      Zobraziť profil <ArrowRight className="ml-1 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <SiteFooter />
    </div>
  );
}

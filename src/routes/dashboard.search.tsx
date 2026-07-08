import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Search, Building2, Filter, Loader2, AlertCircle } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RiskBadge, riskLevelFromScore, formatCurrency } from "@/components/risk-badge";
import { searchCompaniesFn } from "@/lib/finstat.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

type SearchParams = { q?: string };

export const Route = createFileRoute("/dashboard/search")({
  component: SearchPage,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
});

function SearchPage() {
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: "/dashboard/search" });
  const { user } = useAuth();
  const [query, setQuery] = useState(q ?? "");
  const searchFn = useServerFn(searchCompaniesFn);

  const results = useQuery({
    queryKey: ["finstat-search", q],
    enabled: !!q,
    queryFn: () => searchFn({ data: { query: q as string } }),
    staleTime: 60_000,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    navigate({ search: { q: trimmed } });
  }

  const items = results.data?.ok ? results.data.results : [];
  const apiError = results.data && !results.data.ok ? results.data : null;

  // Save to recent_searches only after a successful non-empty result.
  const successKey = results.data?.ok && items.length > 0 ? `${q}|${items[0].ico}` : null;
  const savedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!successKey || !user || savedKeyRef.current === successKey) return;
    savedKeyRef.current = successKey;
    const top = items[0];
    void supabase.from("recent_searches").insert({
      user_id: user.id,
      query: q ?? "",
      ico: top?.ico ?? null,
      company_name: top?.name ?? null,
    });
  }, [successKey, user, items, q]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Vyhľadávanie firiem</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Zadajte názov firmy, IČO alebo meno konateľa
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="rounded-2xl border-border/70 p-2 shadow-soft">
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-3 px-4">
              <Search className="h-5 w-5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="napr. ESET, 31333532..."
                className="h-12 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Button type="button" variant="ghost" className="rounded-xl">
              <Filter className="mr-2 h-4 w-4" /> Filtre
            </Button>
            <Button type="submit" className="rounded-xl">
              Preveriť
            </Button>
          </div>
        </Card>
      </form>

      {q ? (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Výsledky pre „{q}"
              {results.isFetching ? " · načítavam…" : ` · ${items.length}`}
            </p>
          </div>

          {results.isLoading ? (
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
            <Card className="rounded-2xl border-dashed p-12 text-center">
              <div className="text-base font-semibold">Žiadne výsledky</div>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Skúste inú frázu alebo IČO firmy.
              </p>
            </Card>
          ) : (
            <div className="grid gap-3">
              {items.map((r) => (
                <Link
                  key={r.ico}
                  to="/company/$ico"
                  params={{ ico: r.ico }}
                  className="block"
                >
                  <Card className="group cursor-pointer rounded-2xl border-border/70 p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-elevated">
                    <div className="flex items-center gap-4">
                      <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-primary">
                        <Building2 className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{r.name}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          IČO {r.ico} · {r.city}
                        </div>
                      </div>
                      {r.riskScore > 0 && (
                        <div className="hidden text-right sm:block">
                          <div className="text-xs text-muted-foreground">Finančné skóre</div>
                          <div className="text-lg font-bold">
                            {r.riskScore}
                            <span className="text-xs text-muted-foreground">/100</span>
                          </div>
                        </div>
                      )}
                      {r.riskScore > 0 && <RiskBadge level={r.riskLevel} />}
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </>
      ) : (
        <Card className="rounded-2xl border-dashed p-12 text-center">
          <Search className="mx-auto h-8 w-8 text-muted-foreground" />
          <div className="mt-3 text-base font-semibold">Začnite vyhľadávať</div>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Zadajte názov firmy alebo IČO. Vaše nedávne vyhľadávania sa uložia
            automaticky.
          </p>
        </Card>
      )}
    </div>
  );
}

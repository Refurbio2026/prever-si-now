import { createFileRoute } from "@tanstack/react-router";
import { Search, Building2, Filter } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type SearchParams = { q?: string };

export const Route = createFileRoute("/dashboard/search")({
  component: SearchPage,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
});

const results = [
  { name: "ESET, spol. s r.o.", ico: "31333532", city: "Bratislava", score: 92, risk: "Nízke" },
  { name: "ESET Software s.r.o.", ico: "35924015", city: "Bratislava", score: 84, risk: "Nízke" },
  { name: "Eset Distribution, s.r.o.", ico: "44412132", city: "Košice", score: 71, risk: "Stredné" },
  { name: "Slovnaft, a.s.", ico: "31322832", city: "Bratislava", score: 85, risk: "Nízke" },
  { name: "Orange Slovensko, a.s.", ico: "35697270", city: "Bratislava", score: 81, risk: "Stredné" },
];

function SearchPage() {
  const { q } = Route.useSearch();
  const [query, setQuery] = useState(q ?? "");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Vyhľadávanie firiem</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Zadajte názov firmy, IČO alebo meno konateľa
        </p>
      </div>

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
          <Button variant="ghost" className="rounded-xl">
            <Filter className="mr-2 h-4 w-4" /> Filtre
          </Button>
          <Button className="rounded-xl">Preveriť</Button>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {query ? `Výsledky pre "${query}"` : "Populárne výsledky"} · {results.length} firiem
        </p>
      </div>

      <div className="grid gap-3">
        {results.map((r) => (
          <Card key={r.ico} className="group cursor-pointer rounded-2xl border-border/70 p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-elevated">
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
              <div className="hidden text-right sm:block">
                <div className="text-xs text-muted-foreground">Finančné skóre</div>
                <div className="text-lg font-bold">{r.score}<span className="text-xs text-muted-foreground">/100</span></div>
              </div>
              <Badge
                variant="secondary"
                className={`rounded-full ${
                  r.risk === "Nízke"
                    ? "bg-success/15 text-success"
                    : r.risk === "Stredné"
                    ? "bg-warning/20 text-warning-foreground"
                    : "bg-destructive/15 text-destructive"
                }`}
              >
                {r.risk} riziko
              </Badge>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

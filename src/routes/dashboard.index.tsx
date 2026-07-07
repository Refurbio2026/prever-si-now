import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Eye,
  FileText,
  TrendingUp,
  ArrowUpRight,
  Clock,
  Building2,
  MoreHorizontal,
  Bell,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/dashboard/")({
  component: DashboardHome,
});

function DashboardHome() {
  const { user } = useAuth();

  const searchesQuery = useQuery({
    queryKey: ["recent_searches", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recent_searches")
        .select("id, query, ico, company_name, created_at")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  const watchedQuery = useQuery({
    queryKey: ["watched_companies", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("watched_companies")
        .select("id, ico, company_name, risk_score, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const reportsQuery = useQuery({
    queryKey: ["reports_count", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("reports")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const searchesCount = searchesQuery.data?.length ?? 0;
  const watchedCount = watchedQuery.data?.length ?? 0;
  const reportsCount = reportsQuery.data ?? 0;
  const avgScore =
    watchedQuery.data && watchedQuery.data.length > 0
      ? Math.round(
          watchedQuery.data.reduce((sum, w) => sum + (w.risk_score ?? 0), 0) /
            watchedQuery.data.length,
        )
      : null;

  const stats = [
    { label: "Nedávne vyhľadávania", value: String(searchesCount), icon: Search },
    { label: "Sledované firmy", value: String(watchedCount), icon: Eye },
    { label: "Vygenerované reporty", value: String(reportsCount), icon: FileText },
    {
      label: "Priemerné skóre",
      value: avgScore !== null ? `${avgScore}/100` : "—",
      icon: TrendingUp,
    },
  ];

  const greeting = user?.user_metadata?.company_name || user?.email?.split("@")[0] || "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">
            Dobrý deň{greeting ? `, ${greeting}` : ""} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tu je prehľad vašej aktivity.
          </p>
        </div>
        <Button asChild className="rounded-xl shadow-soft">
          <Link to="/dashboard/search">
            <Search className="mr-2 h-4 w-4" /> Nové preverenie
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="rounded-2xl border-border/70 p-5 shadow-soft">
            <div className="flex items-start justify-between">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary">
                <s.icon className="h-4 w-4" />
              </div>
              <Badge variant="secondary" className="rounded-full bg-success/15 text-success">
                <ArrowUpRight className="mr-1 h-3 w-3" />
                aktívne
              </Badge>
            </div>
            <div className="mt-4 text-2xl font-bold">{s.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Recent searches */}
        <Card className="rounded-2xl border-border/70 p-6 shadow-soft lg:col-span-3">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Nedávne vyhľadávania</h2>
              <p className="text-xs text-muted-foreground">Firmy, ktoré ste si preverili nedávno</p>
            </div>
            <Button asChild variant="ghost" size="sm" className="rounded-full text-xs">
              <Link to="/dashboard/search">Nové hľadanie</Link>
            </Button>
          </div>
          {searchesQuery.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Načítavam…</div>
          ) : searchesQuery.isError ? (
            <div className="py-10 text-center text-sm text-destructive">
              Nepodarilo sa načítať dáta.
            </div>
          ) : searchesCount === 0 ? (
            <EmptyState
              title="Žiadne nedávne vyhľadávania"
              description="Spustite prvé preverenie firmy a jej názov sa tu objaví."
              actionLabel="Preveriť firmu"
              actionTo="/dashboard/search"
            />
          ) : (
            <div className="space-y-2">
              {searchesQuery.data!.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 rounded-xl border border-transparent p-3 transition-colors hover:border-border hover:bg-secondary/50"
                >
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {r.company_name ?? r.query}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.ico ? `IČO ${r.ico}` : `„${r.query}"`}
                    </div>
                  </div>
                  {r.ico && (
                    <Button asChild size="sm" variant="ghost" className="rounded-full">
                      <Link to="/company/$ico" params={{ ico: r.ico }}>
                        Otvoriť
                      </Link>
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="rounded-full">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Watched companies */}
        <Card className="rounded-2xl border-border/70 p-6 shadow-soft lg:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Sledované firmy</h2>
              <p className="text-xs text-muted-foreground">Firmy s aktívnym monitoringom</p>
            </div>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </div>
          {watchedQuery.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Načítavam…</div>
          ) : watchedQuery.isError ? (
            <div className="py-10 text-center text-sm text-destructive">
              Nepodarilo sa načítať dáta.
            </div>
          ) : watchedCount === 0 ? (
            <EmptyState
              title="Žiadne sledované firmy"
              description="Pridajte firmy do sledovania a uvidíte ich tu."
              actionLabel="Nájsť firmu"
              actionTo="/dashboard/search"
            />
          ) : (
            <div className="space-y-3">
              {watchedQuery.data!.map((w) => (
                <Link
                  key={w.id}
                  to="/company/$ico"
                  params={{ ico: w.ico }}
                  className="block rounded-xl border border-border/60 bg-background p-4 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{w.company_name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">IČO {w.ico}</div>
                    </div>
                    {w.risk_score !== null && (
                      <Badge variant="secondary" className="rounded-full">
                        {w.risk_score}/100
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" /> pridané{" "}
                    {new Date(w.created_at).toLocaleDateString("sk-SK")}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
  actionLabel,
  actionTo,
}: {
  title: string;
  description: string;
  actionLabel: string;
  actionTo: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 py-10 text-center">
      <div className="text-sm font-medium">{title}</div>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">{description}</p>
      <Button asChild size="sm" variant="secondary" className="mt-4 rounded-full">
        <Link to={actionTo}>{actionLabel}</Link>
      </Button>
    </div>
  );
}

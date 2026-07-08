import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Plus, Building2, Trash2, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/severity-badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  detectCompanyChangesFn,
  getWatchedWithChangesFn,
} from "@/lib/monitoring.functions";

export const Route = createFileRoute("/dashboard/monitoring")({
  component: MonitoringPage,
});

function MonitoringPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fetchWatched = useServerFn(getWatchedWithChangesFn);
  const detectFn = useServerFn(detectCompanyChangesFn);

  const query = useQuery({
    queryKey: ["watched_with_changes", user?.id],
    enabled: !!user,
    queryFn: () => fetchWatched(),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("watched_companies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watched_with_changes", user?.id] });
      toast.success("Firma odstránená zo sledovaných");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const detectMutation = useMutation({
    mutationFn: async (ico: string) => detectFn({ data: { ico } }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["watched_with_changes", user?.id] });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.source === "initial") toast.success("Prvotný snapshot uložený");
      else if (res.created === 0) toast.success("Žiadne nové zmeny");
      else toast.success(`Zaznamenaných ${res.created} zmien`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Monitoring firiem</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sledujte zmeny v profile firmy — názov, sídlo, rizikové skóre, konečných užívateľov, verejné zmluvy.
          </p>
        </div>
        <Button asChild className="rounded-xl shadow-soft">
          <Link to="/dashboard/search">
            <Plus className="mr-2 h-4 w-4" /> Pridať firmu
          </Link>
        </Button>
      </div>

      {query.isLoading ? (
        <Card className="rounded-2xl p-10 text-center text-sm text-muted-foreground">
          Načítavam sledované firmy…
        </Card>
      ) : query.isError ? (
        <Card className="rounded-2xl p-10 text-center text-sm text-destructive">
          Nepodarilo sa načítať dáta.
        </Card>
      ) : (query.data?.length ?? 0) === 0 ? (
        <Card className="rounded-2xl border-dashed p-12 text-center">
          <Bell className="mx-auto h-8 w-8 text-muted-foreground" />
          <div className="mt-3 text-base font-semibold">Zatiaľ nesledujete žiadnu firmu</div>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Nájdite firmu a kliknite na „Sledovať" v jej profile. Zobrazí sa tu.
          </p>
          <Button asChild className="mt-5 rounded-xl">
            <Link to="/dashboard/search">Prejsť na vyhľadávanie</Link>
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3">
          {query.data!.map((it) => {
            const isChecking = detectMutation.isPending && detectMutation.variables === it.ico;
            return (
              <Card key={it.id} className="rounded-2xl border-border/70 p-5 shadow-soft">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-primary">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/company/$ico"
                      params={{ ico: it.ico }}
                      className="truncate font-semibold hover:underline"
                    >
                      {it.companyName}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      IČO {it.ico} • {it.changeCount} zaznamenaných zmien
                    </div>
                  </div>
                  {it.riskScore !== null && (
                    <Badge variant="secondary" className="rounded-full">
                      Skóre {it.riskScore}
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    disabled={isChecking}
                    onClick={() => detectMutation.mutate(it.ico)}
                  >
                    {isChecking ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Skontrolovať
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="rounded-full text-muted-foreground hover:text-destructive"
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(it.id)}
                    aria-label="Odstrániť zo sledovaných"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {it.latestChange ? (
                  <div className="mt-4 rounded-xl border border-border/60 bg-background p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium">{it.latestChange.title}</div>
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={it.latestChange.severity} />
                        <span className="text-xs text-muted-foreground">
                          {new Date(it.latestChange.detectedAt).toLocaleString("sk-SK")}
                        </span>
                      </div>
                    </div>
                    {it.latestChange.description && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {it.latestChange.description}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 text-xs text-muted-foreground">
                    Zatiaľ neboli detegované žiadne zmeny.
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

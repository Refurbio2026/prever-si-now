import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Plus, Building2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/dashboard/monitoring")({
  component: MonitoringPage,
});

function MonitoringPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
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

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("watched_companies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watched_companies", user?.id] });
      toast.success("Firma odstránená zo sledovaných");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Monitoring firiem</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sledujte zmeny a dostávajte notifikácie e-mailom.
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
          {query.data!.map((it) => (
            <Card key={it.id} className="rounded-2xl border-border/70 p-5 shadow-soft">
              <div className="flex items-center gap-4">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-primary">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    to="/company/$ico"
                    params={{ ico: it.ico }}
                    className="truncate font-semibold hover:underline"
                  >
                    {it.company_name}
                  </Link>
                  <div className="mt-0.5 text-xs text-muted-foreground">IČO {it.ico}</div>
                </div>
                {it.risk_score !== null && (
                  <Badge variant="secondary" className="rounded-full">
                    Skóre {it.risk_score}
                  </Badge>
                )}
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
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/dashboard/reports")({
  component: ReportsPage,
});

const REPORT_TYPE_LABELS: Record<string, string> = {
  company_profile: "Kompletný profil",
  financial: "Finančný",
  risk: "Rizikový",
};

function ReportsPage() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["reports", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("id, ico, company_name, report_type, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Reporty</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            PDF reporty pripravené na stiahnutie a zdieľanie.
          </p>
        </div>
        <Button asChild className="rounded-xl shadow-soft">
          <Link to="/dashboard/search">
            <Plus className="mr-2 h-4 w-4" /> Nový report
          </Link>
        </Button>
      </div>

      {query.isLoading ? (
        <Card className="rounded-2xl p-10 text-center text-sm text-muted-foreground">
          Načítavam reporty…
        </Card>
      ) : query.isError ? (
        <Card className="rounded-2xl p-10 text-center text-sm text-destructive">
          Nepodarilo sa načítať dáta.
        </Card>
      ) : (query.data?.length ?? 0) === 0 ? (
        <Card className="rounded-2xl border-dashed p-12 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
          <div className="mt-3 text-base font-semibold">Zatiaľ žiadne reporty</div>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Vygenerujte prvý report z profilu firmy.
          </p>
          <Button asChild className="mt-5 rounded-xl">
            <Link to="/dashboard/search">Prejsť na vyhľadávanie</Link>
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3">
          {query.data!.map((r) => (
            <Card key={r.id} className="rounded-2xl border-border/70 p-5 shadow-soft">
              <div className="flex items-center gap-4">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    to="/company/$ico"
                    params={{ ico: r.ico }}
                    className="truncate font-semibold hover:underline"
                  >
                    {r.company_name}
                  </Link>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {REPORT_TYPE_LABELS[r.report_type] ?? r.report_type} ·{" "}
                    {new Date(r.created_at).toLocaleDateString("sk-SK")}
                  </div>
                </div>
                <Badge variant="secondary" className="rounded-full bg-success/15 text-success">
                  Hotové
                </Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

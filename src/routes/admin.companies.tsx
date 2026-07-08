import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/companies")({
  component: AdminCompanies,
});

function AdminCompanies() {
  const q = useQuery({
    queryKey: ["admin", "companies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("watched_companies")
        .select("id, company_name, ico, risk_score, created_at, user_id")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Firmy</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sledované firmy naprieč účtami.</p>
      </div>
      <Card className="rounded-2xl border-border/70 p-0 shadow-soft overflow-hidden">
        {q.isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Načítavam…</div>
        ) : q.isError ? (
          <div className="p-6 text-sm text-destructive">Nepodarilo sa načítať zoznam.</div>
        ) : (q.data ?? []).length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">Zatiaľ žiadne sledované firmy.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Firma</th>
                  <th className="px-4 py-3 text-left">IČO</th>
                  <th className="px-4 py-3 text-left">Risk skóre</th>
                  <th className="px-4 py-3 text-left">Pridané</th>
                </tr>
              </thead>
              <tbody>
                {(q.data ?? []).map((c) => (
                  <tr key={c.id} className="border-t border-border/60">
                    <td className="px-4 py-3">{c.company_name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{c.ico}</td>
                    <td className="px-4 py-3">{c.risk_score ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString("sk-SK")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

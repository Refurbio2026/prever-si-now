import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/users")({
  component: AdminUsers,
});

function AdminUsers() {
  const q = useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const [profilesRes, rolesRes] = await Promise.all([
        supabase.from("profiles").select("id, email, company_name, plan, created_at"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      if (rolesRes.error) throw rolesRes.error;
      const roleMap = new Map<string, string[]>();
      for (const r of rolesRes.data ?? []) {
        const arr = roleMap.get(r.user_id) ?? [];
        arr.push(r.role);
        roleMap.set(r.user_id, arr);
      }
      return (profilesRes.data ?? []).map((p) => ({
        ...p,
        roles: roleMap.get(p.id) ?? ["user"],
      }));
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Používatelia</h1>
        <p className="mt-1 text-sm text-muted-foreground">Zoznam všetkých účtov v systéme.</p>
      </div>
      <Card className="rounded-2xl border-border/70 p-0 shadow-soft overflow-hidden">
        {q.isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Načítavam…</div>
        ) : q.isError ? (
          <div className="p-6 text-sm text-destructive">Nepodarilo sa načítať zoznam.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">E-mail</th>
                  <th className="px-4 py-3 text-left">Firma</th>
                  <th className="px-4 py-3 text-left">Plán</th>
                  <th className="px-4 py-3 text-left">Rola</th>
                </tr>
              </thead>
              <tbody>
                {(q.data ?? []).map((u) => (
                  <tr key={u.id} className="border-t border-border/60">
                    <td className="px-4 py-3">{u.email ?? "—"}</td>
                    <td className="px-4 py-3">{u.company_name ?? "—"}</td>
                    <td className="px-4 py-3 capitalize">{u.plan}</td>
                    <td className="px-4 py-3">
                      {u.roles.map((r) => (
                        <Badge
                          key={r}
                          className={
                            r === "admin"
                              ? "mr-1 rounded-full bg-primary/15 text-primary"
                              : "mr-1 rounded-full bg-muted text-foreground"
                          }
                        >
                          {r}
                        </Badge>
                      ))}
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

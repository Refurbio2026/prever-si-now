import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/dashboard/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, company_name, email, plan")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (profileQuery.data) {
      setCompanyName(profileQuery.data.company_name ?? "");
      setEmail(profileQuery.data.email ?? user?.email ?? "");
    }
  }, [profileQuery.data, user?.email]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Nie ste prihlásený");
      const { error } = await supabase
        .from("profiles")
        .update({ company_name: companyName, email })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Zmeny uložené");
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const plan = profileQuery.data?.plan ?? "free";
  const initials = (companyName || email || "??")
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Môj profil</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Spravujte svoj účet a fakturačné údaje.
        </p>
      </div>

      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 border border-border">
            <AvatarFallback className="bg-primary text-lg font-semibold text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="text-lg font-semibold">{companyName || "—"}</div>
            <div className="text-sm text-muted-foreground">{email}</div>
          </div>
          <Badge className="rounded-full bg-primary/10 text-primary capitalize">{plan} plán</Badge>
        </div>
      </Card>

      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <h2 className="text-lg font-semibold">Údaje účtu</h2>
        {profileQuery.isLoading ? (
          <div className="mt-5 text-sm text-muted-foreground">Načítavam…</div>
        ) : profileQuery.isError ? (
          <div className="mt-5 text-sm text-destructive">Nepodarilo sa načítať profil.</div>
        ) : (
          <>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="company">Názov firmy</Label>
                <Input
                  id="company"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="rounded-xl shadow-soft"
              >
                {saveMutation.isPending ? "Ukladám…" : "Uložiť zmeny"}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

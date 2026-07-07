import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "./login";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/register")({
  component: RegisterPage,
  head: () => ({
    meta: [
      { title: "Registrácia — PreverSi.sk" },
      { name: "description", content: "Vytvorte si účet zdarma na PreverSi.sk." },
    ],
  }),
});

function RegisterPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) navigate({ to: "/dashboard" });
  }, [user, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { company_name: companyName },
      },
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data.session) {
      toast.success("Účet vytvorený");
      navigate({ to: "/dashboard" });
    } else {
      toast.success("Skontrolujte e-mail pre potvrdenie účtu");
    }
  }

  return (
    <AuthShell>
      <div className="text-center">
        <h1 className="text-2xl font-bold">Vytvorte si účet</h1>
        <p className="mt-1 text-sm text-muted-foreground">Začnite preverovať firmy zdarma</p>
      </div>

      <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="company">Názov firmy</Label>
          <Input
            id="company"
            type="text"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Moja Firma s.r.o."
            className="h-11 rounded-xl"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vas@email.sk"
            className="h-11 rounded-xl"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Heslo</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Aspoň 8 znakov"
            className="h-11 rounded-xl"
          />
        </div>
        <Button type="submit" disabled={submitting} className="h-11 w-full rounded-xl shadow-soft">
          {submitting ? "Vytváram účet…" : "Vytvoriť účet"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Registráciou súhlasíte s{" "}
          <a href="#" className="underline hover:text-foreground">podmienkami</a> a{" "}
          <a href="#" className="underline hover:text-foreground">ochranou súkromia</a>.
        </p>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Už máte účet?{" "}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Prihláste sa
        </Link>
      </p>
    </AuthShell>
  );
}

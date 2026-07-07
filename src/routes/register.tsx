import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "./login";

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
  return (
    <AuthShell>
      <div className="text-center">
        <h1 className="text-2xl font-bold">Vytvorte si účet</h1>
        <p className="mt-1 text-sm text-muted-foreground">Začnite preverovať firmy zdarma</p>
      </div>

      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          // Supabase integration placeholder:
          // await supabase.auth.signUp({ email, password, options: { data: { company_name } } })
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="company">Názov firmy</Label>
          <Input id="company" type="text" placeholder="Moja Firma s.r.o." required className="h-11 rounded-xl" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" type="email" placeholder="vas@email.sk" required className="h-11 rounded-xl" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Heslo</Label>
          <Input id="password" type="password" placeholder="Aspoň 8 znakov" required className="h-11 rounded-xl" />
        </div>
        <Button type="submit" className="h-11 w-full rounded-xl shadow-soft">
          Vytvoriť účet
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

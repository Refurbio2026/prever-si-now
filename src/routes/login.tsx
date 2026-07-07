import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Prihlásenie — PreverSi.sk" },
      { name: "description", content: "Prihláste sa do svojho účtu PreverSi.sk." },
    ],
  }),
});

function LoginPage() {
  return (
    <AuthShell>
      <div className="text-center">
        <h1 className="text-2xl font-bold">Vitajte späť</h1>
        <p className="mt-1 text-sm text-muted-foreground">Prihláste sa do svojho účtu</p>
      </div>

      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          // Supabase integration placeholder:
          // await supabase.auth.signInWithPassword({ email, password })
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" type="email" placeholder="vas@email.sk" required className="h-11 rounded-xl" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Heslo</Label>
            <a href="#" className="text-xs text-primary hover:underline">
              Zabudli ste heslo?
            </a>
          </div>
          <Input id="password" type="password" placeholder="••••••••" required className="h-11 rounded-xl" />
        </div>
        <Button type="submit" className="h-11 w-full rounded-xl shadow-soft">
          Prihlásiť sa
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Nemáte účet?{" "}
        <Link to="/register" className="font-medium text-primary hover:underline">
          Zaregistrujte sa
        </Link>
      </p>
    </AuthShell>
  );
}

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-background">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "var(--gradient-hero)" }}
        aria-hidden
      />
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-10">
        <div className="mb-8">
          <Logo />
        </div>
        <Card className="w-full rounded-2xl border-border/70 p-8 shadow-elevated">{children}</Card>
        <Link to="/" className="mt-6 text-xs text-muted-foreground hover:text-foreground">
          ← Späť na úvod
        </Link>
      </div>
    </div>
  );
}

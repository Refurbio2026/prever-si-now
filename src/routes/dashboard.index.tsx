import { createFileRoute, Link } from "@tanstack/react-router";
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

export const Route = createFileRoute("/dashboard/")({
  component: DashboardHome,
});

const stats = [
  { label: "Preverenia (mesiac)", value: "247", delta: "+12%", icon: Search },
  { label: "Sledované firmy", value: "18", delta: "+3", icon: Eye },
  { label: "Vygenerované reporty", value: "42", delta: "+8", icon: FileText },
  { label: "Priemerné skóre", value: "78/100", delta: "+2.4", icon: TrendingUp },
];

const recentSearches = [
  { name: "ESET, spol. s r.o.", ico: "31333532", score: 92, risk: "Nízke" },
  { name: "Slovnaft, a.s.", ico: "31322832", score: 85, risk: "Nízke" },
  { name: "Kaufland Slovensko v.o.s.", ico: "35790164", score: 88, risk: "Nízke" },
  { name: "Orange Slovensko, a.s.", ico: "35697270", score: 81, risk: "Stredné" },
  { name: "Tatra banka, a.s.", ico: "00686930", score: 94, risk: "Nízke" },
];

const watched = [
  { name: "Alza.sk s.r.o.", change: "Zmena konateľa", when: "pred 2 h", severity: "warning" as const },
  { name: "Martinus, s.r.o.", change: "Nová účtovná závierka", when: "pred 6 h", severity: "info" as const },
  { name: "Websupport s.r.o.", change: "Dlh voči SP splatený", when: "včera", severity: "success" as const },
  { name: "Pixel Federation, s.r.o.", change: "Nové exekučné konanie", when: "pred 3 dňami", severity: "destructive" as const },
];

function DashboardHome() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Dobrý deň, Ján 👋</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tu je prehľad vašej aktivity za posledných 30 dní.
          </p>
        </div>
        <Button asChild className="rounded-xl shadow-soft">
          <Link to="/dashboard/search">
            <Search className="mr-2 h-4 w-4" /> Nové preverenie
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="rounded-2xl border-border/70 p-5 shadow-soft">
            <div className="flex items-start justify-between">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary">
                <s.icon className="h-4 w-4" />
              </div>
              <Badge variant="secondary" className="rounded-full bg-success/15 text-success">
                <ArrowUpRight className="mr-1 h-3 w-3" />
                {s.delta}
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
            <Button variant="ghost" size="sm" className="rounded-full text-xs">
              Zobraziť všetky
            </Button>
          </div>
          <div className="space-y-2">
            {recentSearches.map((r) => (
              <div
                key={r.ico}
                className="flex items-center gap-3 rounded-xl border border-transparent p-3 transition-colors hover:border-border hover:bg-secondary/50"
              >
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                  <Building2 className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">IČO {r.ico}</div>
                </div>
                <div className="hidden text-right sm:block">
                  <div className="text-xs text-muted-foreground">Skóre</div>
                  <div className="text-sm font-semibold text-foreground">{r.score}</div>
                </div>
                <RiskBadge risk={r.risk} />
                <Button size="icon" variant="ghost" className="rounded-full">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </Card>

        {/* Watched companies */}
        <Card className="rounded-2xl border-border/70 p-6 shadow-soft lg:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Sledované firmy</h2>
              <p className="text-xs text-muted-foreground">Nedávne zmeny a upozornenia</p>
            </div>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-3">
            {watched.map((w) => (
              <div key={w.name} className="rounded-xl border border-border/60 bg-background p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{w.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{w.change}</div>
                  </div>
                  <SeverityDot severity={w.severity} />
                </div>
                <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" /> {w.when}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function RiskBadge({ risk }: { risk: string }) {
  const map: Record<string, string> = {
    Nízke: "bg-success/15 text-success",
    Stredné: "bg-warning/20 text-warning-foreground",
    Vysoké: "bg-destructive/15 text-destructive",
  };
  return (
    <Badge variant="secondary" className={`rounded-full ${map[risk] ?? ""}`}>
      {risk} riziko
    </Badge>
  );
}

function SeverityDot({ severity }: { severity: "success" | "info" | "warning" | "destructive" }) {
  const map = {
    success: "bg-success",
    info: "bg-primary",
    warning: "bg-warning",
    destructive: "bg-destructive",
  };
  return <span className={`mt-1 inline-block h-2 w-2 flex-shrink-0 rounded-full ${map[severity]}`} />;
}

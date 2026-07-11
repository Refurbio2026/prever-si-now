import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Search,
  TrendingUp,
  ShieldAlert,
  Users,
  Bell,
  Sparkles,
  FileText,
  Check,
  ArrowRight,
} from "lucide-react";
import { useEffect, useState } from "react";

import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

const FALLBACK_COMPANIES_LABEL = "600 000+";
const FALLBACK_SOURCES_LABEL = "12 zdrojov";

/** Round a count DOWN to the nearest 100k and format Slovak-style with
 *  non-breaking spaces as thousands separator, appending "+". */
function formatSubjectsRounded(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return FALLBACK_COMPANIES_LABEL;
  const rounded = Math.floor(n / 100_000) * 100_000;
  if (rounded <= 0) return FALLBACK_COMPANIES_LABEL;
  return `${rounded.toLocaleString("sk-SK").replace(/\s/g, "\u00A0")}+`;
}

function formatExact(n: number): string {
  return n.toLocaleString("sk-SK").replace(/\s/g, "\u00A0");
}

export const Route = createFileRoute("/")({
  component: Landing,
});

const features = [
  {
    icon: TrendingUp,
    title: "Finančné zdravie",
    desc: "Skóring, tržby, zisk, likvidita a vývoj kľúčových ukazovateľov v čase.",
  },
  {
    icon: ShieldAlert,
    title: "Riziká a dlhy",
    desc: "Exekúcie, konkurzy, daňové nedoplatky a záväzky voči Sociálnej poisťovni.",
  },
  {
    icon: Users,
    title: "Konatelia a majitelia",
    desc: "Prepojenia osôb a firiem, konečný užívateľ výhod (KUV) a historické väzby.",
  },
  {
    icon: Bell,
    title: "Monitoring",
    desc: "Sledujte zmeny vo firmách. Notifikácie e-mailom pri akejkoľvek zmene.",
  },
  {
    icon: Sparkles,
    title: "AI analýza",
    desc: "Zrozumiteľné zhrnutie rizík a odporúčania na spoluprácu od nášho AI modelu.",
  },
  {
    icon: FileText,
    title: "PDF reporty",
    desc: "Kompletné reporty pripravené pre klientov, právnikov a bankový sektor.",
  },
] as const;

const plans = [
  {
    name: "Free",
    price: "0 €",
    per: "navždy",
    desc: "Ideálne na vyskúšanie základných funkcií.",
    features: ["5 preverení mesačne", "Základné firemné údaje", "1 sledovaná firma"],
    cta: "Začať zdarma",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "29 €",
    per: "/ mesačne",
    desc: "Pre podnikateľov a menšie firmy.",
    features: [
      "Neobmedzené preverenia",
      "Finančná analýza a skóring",
      "50 sledovaných firiem",
      "PDF reporty",
      "E-mailové notifikácie",
    ],
    cta: "Vyskúšať Pro",
    highlighted: true,
  },
  {
    name: "Business",
    price: "89 €",
    per: "/ mesačne",
    desc: "Pre tímy, banky a právnické kancelárie.",
    features: [
      "Všetko z Pro",
      "AI analýza a odporúčania",
      "Neobmedzený monitoring",
      "API prístup",
      "Dedikovaná podpora",
    ],
    cta: "Kontaktovať predaj",
    highlighted: false,
  },
];

function Landing() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [companiesLabel, setCompaniesLabel] = useState(FALLBACK_COMPANIES_LABEL);
  const [companiesExact, setCompaniesExact] = useState<string | null>(null);
  const [sourcesLabel, setSourcesLabel] = useState(FALLBACK_SOURCES_LABEL);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_public_stats");
        if (cancelled || error || !data) return;
        const stats = data as { companies_count?: number; sources_count?: number };
        if (typeof stats.companies_count === "number" && stats.companies_count > 0) {
          setCompaniesLabel(formatSubjectsRounded(stats.companies_count));
          setCompaniesExact(formatExact(stats.companies_count));
        }
        if (typeof stats.sources_count === "number" && stats.sources_count > 0) {
          setSourcesLabel(`${stats.sources_count} zdrojov`);
        }
      } catch {
        // Fallback values already set — never show 0.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate({ to: "/search", search: { q: query } });
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: "var(--gradient-hero)" }}
          aria-hidden
        />
        <div className="mx-auto max-w-5xl px-4 pt-20 pb-16 text-center sm:px-6 sm:pt-28 sm:pb-24">
          <Badge variant="secondary" className="mb-6 rounded-full border border-border/60 bg-background/60 px-4 py-1.5 text-xs font-medium text-primary">
            <Sparkles className="mr-1.5 h-3 w-3" /> Nová AI analýza je tu
          </Badge>
          <h1 className="text-balance text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-6xl">
            Preverte si každú slovenskú firmu{" "}
            <span className="bg-[image:var(--gradient-primary)] bg-clip-text text-transparent">
              za pár sekúnd
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground">
            Finančné zdravie, riziká, dlhy, konatelia, monitoring a AI analýza — všetko na jednom
            mieste.
          </p>

          <form
            onSubmit={submit}
            className="mx-auto mt-10 flex max-w-2xl items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-elevated"
          >
            <div className="flex flex-1 items-center gap-3 px-4">
              <Search className="h-5 w-5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                type="text"
                placeholder="Zadajte názov firmy alebo IČO..."
                className="h-12 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Button type="submit" size="lg" className="h-12 rounded-xl px-6 shadow-soft">
              Preveriť
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </form>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span>Skúste:</span>
            {["ESET, spol. s r.o.", "Slovnaft, a.s.", "Orange Slovensko"].map((s) => (
              <button
                key={s}
                onClick={() => setQuery(s)}
                className="rounded-full border border-border/60 bg-background px-3 py-1 transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-sm text-muted-foreground">
            <Stat
              value={companiesLabel}
              label="subjektov v databáze"
              title={companiesExact ? `Presne: ${companiesExact} aktívnych subjektov` : undefined}
            />
            <Stat value={sourcesLabel} label="verejných registrov" />
            <Stat value="99.9%" label="dostupnosť služby" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">Všetko, čo potrebujete vedieť</h2>
          <p className="mt-4 text-muted-foreground">
            Kompletný obraz o firme na jednej obrazovke. Bez zdĺhavého kombinovania desiatok registrov.
          </p>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <Card
              key={f.title}
              className="group rounded-2xl border-border/70 bg-card p-6 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-elevated"
            >
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="bg-secondary/40 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">Jednoduchý cenník</h2>
            <p className="mt-4 text-muted-foreground">
              Vyberte si plán podľa toho, koľko firiem chcete preverovať.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {plans.map((p) => (
              <Card
                key={p.name}
                className={`relative flex flex-col rounded-2xl p-8 ${
                  p.highlighted
                    ? "border-primary/60 shadow-elevated ring-1 ring-primary/20"
                    : "border-border/70 shadow-soft"
                }`}
              >
                {p.highlighted && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs">
                    Najpopulárnejšie
                  </Badge>
                )}
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{p.desc}</p>
                <div className="mt-5 flex items-baseline gap-1">
                  <span className="text-4xl font-bold">{p.price}</span>
                  <span className="text-sm text-muted-foreground">{p.per}</span>
                </div>
                <ul className="mt-6 flex-1 space-y-3 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  className="mt-8 w-full rounded-xl"
                  variant={p.highlighted ? "default" : "outline"}
                >
                  <Link to="/register">{p.cta}</Link>
                </Button>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-4 py-20 sm:px-6">
        <Card className="overflow-hidden rounded-3xl border-0 bg-[image:var(--gradient-primary)] p-10 text-center text-primary-foreground shadow-elevated sm:p-16">
          <h2 className="text-3xl font-bold sm:text-4xl">Pripravení začať preverovať?</h2>
          <p className="mx-auto mt-3 max-w-xl text-primary-foreground/80">
            Vytvorte si účet zdarma za 30 sekúnd. Bez kreditnej karty.
          </p>
          <Button
            asChild
            size="lg"
            variant="secondary"
            className="mt-8 rounded-full bg-background text-foreground shadow-soft hover:bg-background/90"
          >
            <Link to="/register">
              Vytvoriť účet zdarma <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </Card>
      </section>

      <SiteFooter />
    </div>
  );
}

function Stat({ value, label, title }: { value: string; label: string; title?: string }) {
  return (
    <div className="text-left" title={title}>
      <div className="text-lg font-semibold text-foreground">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

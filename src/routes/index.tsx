import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Search,
  ArrowRight,
  Database,
  RefreshCw,
  Sparkles,
  Check,
  Building2,
  Eye,
  BrainCircuit,
} from "lucide-react";
import { useEffect, useState } from "react";

import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const FALLBACK_COUNT = "2 100 000+";

/** Round DOWN to nearest 100k, Slovak formatting with non-breaking spaces. */
function formatSubjectsRounded(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return FALLBACK_COUNT;
  const rounded = Math.floor(n / 100_000) * 100_000;
  if (rounded <= 0) return FALLBACK_COUNT;
  return `${rounded.toLocaleString("sk-SK").replace(/\s/g, "\u00A0")}+`;
}

function formatExact(n: number): string {
  return n.toLocaleString("sk-SK").replace(/\s/g, "\u00A0");
}

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [countLabel, setCountLabel] = useState(FALLBACK_COUNT);
  const [countExact, setCountExact] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_public_stats");
        if (cancelled || error || !data) return;
        const stats = data as { companies_count?: number };
        if (typeof stats.companies_count === "number" && stats.companies_count > 0) {
          setCountLabel(formatSubjectsRounded(stats.companies_count));
          setCountExact(formatExact(stats.companies_count));
        }
      } catch {
        /* keep fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    navigate({ to: "/search", search: { q: query } });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />

      <Hero
        query={query}
        setQuery={setQuery}
        submit={submit}
        countLabel={countLabel}
        countExact={countExact}
      />
      <HowItWorks />
      <UseCases />
      <Pricing />
      <SiteFooter />
    </div>
  );
}

/* ---------------- Hero ---------------- */

function Hero({
  query,
  setQuery,
  submit,
  countLabel,
  countExact,
}: {
  query: string;
  setQuery: (v: string) => void;
  submit: (e: React.FormEvent) => void;
  countLabel: string;
  countExact: string | null;
}) {
  return (
    <section className="border-b border-hairline">
      <div className="mx-auto grid max-w-7xl gap-16 px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:gap-12 lg:pt-20 lg:pb-28">
        {/* Left column */}
        <div className="flex flex-col justify-center">
          <div
            className="inline-flex items-center gap-2 font-mono-data text-[11.5px] text-ink-secondary"
            title={countExact ? `Presne: ${countExact} subjektov` : undefined}
          >
            <span className="relative inline-flex h-2 w-2">
              <span
                className="absolute inset-0 rounded-full bg-signal-green pulse-dot"
                aria-hidden
              />
              <span className="relative inline-block h-2 w-2 rounded-full bg-signal-green" />
            </span>
            {countLabel} subjektov · aktualizované dnes 05:00
          </div>

          <h1 className="mt-7 font-serif text-[44px] font-medium leading-[1.08] tracking-[-0.02em] text-foreground sm:text-[56px] lg:text-[62px]">
            Poznajte firmu skôr,
            <br />
            než jej pošlete faktúru.
          </h1>

          <p className="mt-6 max-w-xl text-[16.5px] leading-relaxed text-ink-secondary">
            Dlhy, riziká, konatelia a finančné zdravie z 12 verejných registrov. Jedno vyhľadanie,
            celý obraz.
          </p>

          <form
            onSubmit={submit}
            className="mt-8 flex max-w-xl items-center gap-2 rounded-[8px] border border-[#D9D6CC] bg-card p-1.5 shadow-none transition-[box-shadow] focus-within:shadow-glow focus-within:border-primary/30"
          >
            <div className="flex flex-1 items-center gap-2.5 pl-3">
              <Search className="h-[18px] w-[18px] text-ink-muted" strokeWidth={2} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                type="text"
                placeholder="Názov firmy alebo IČO"
                className="h-11 w-full bg-transparent text-[15px] text-foreground outline-none placeholder:text-ink-muted"
              />
            </div>
            <Button
              type="submit"
              className="h-11 rounded-[7px] bg-primary px-5 text-[14px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              Preveriť
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </form>

          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-ink-secondary">
            <InlineFeature icon={Database} label="12 registrov" />
            <InlineFeature icon={RefreshCw} label="denná aktualizácia" />
            <InlineFeature icon={Sparkles} label="AI analýza rizika" />
          </div>
        </div>

        {/* Right column — live company preview */}
        <div className="flex flex-col justify-center">
          <CompanyPreviewCard />
          <p className="mt-5 font-mono-data text-[11px] leading-relaxed text-ink-muted">
            Finančná správa · Sociálna poisťovňa · RPO · ORSR · RPVS · CRZ
          </p>
        </div>
      </div>
    </section>
  );
}

function InlineFeature({
  icon: Icon,
  label,
}: {
  icon: typeof Database;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-[15px] w-[15px] text-ink-muted" strokeWidth={1.75} />
      {label}
    </span>
  );
}

/* ---------------- Company preview card ---------------- */

type CardData = {
  name: string;
  ico: string;
  city: string;
  hasSocialDebt: boolean;
  hasTaxDebt: boolean;
  vatPayer: boolean;
  revenue: string | null;
};

const ESET_FALLBACK: CardData = {
  name: "ESET, spol. s r.o.",
  ico: "31333532",
  city: "Bratislava",
  hasSocialDebt: false,
  hasTaxDebt: false,
  vatPayer: true,
  revenue: "412,8 mil. €",
};

function CompanyPreviewCard() {
  const [data, setData] = useState<CardData>(ESET_FALLBACK);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [regRes, socRes, taxRes] = await Promise.all([
          supabase
            .from("company_registry")
            .select("name, obec")
            .eq("ico", "31333532")
            .eq("is_current", true)
            .limit(1)
            .maybeSingle(),
          supabase
            .from("company_insurance_debts")
            .select("ico", { count: "exact", head: true })
            .eq("ico", "31333532"),
          supabase
            .from("company_tax_debts")
            .select("ico", { count: "exact", head: true })
            .eq("ico", "31333532"),
        ]);
        if (cancelled) return;
        setData((prev) => ({
          ...prev,
          name: regRes.data?.name ?? prev.name,
          city: regRes.data?.obec ?? prev.city,
          hasSocialDebt: (socRes.count ?? 0) > 0,
          hasTaxDebt: (taxRes.count ?? 0) > 0,
        }));
      } catch {
        /* keep fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grade: "A" | "C" | "?" =
    data.hasSocialDebt || data.hasTaxDebt ? "C" : "A";
  const gradeColor =
    grade === "A" ? "text-signal-green border-signal-green" : "text-signal-amber border-signal-amber";

  return (
    <article className="rounded-[12px] border border-hairline bg-card p-6 sm:p-7">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-5">
        <div className="min-w-0">
          <h3 className="truncate font-serif text-[22px] font-medium leading-tight text-foreground">
            {data.name}
          </h3>
          <div className="mt-1.5 font-mono-data text-[12px] text-ink-secondary">
            IČO {data.ico} · {data.city}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center">
          <div
            className={`grid h-11 w-11 place-items-center rounded-full border-[3px] bg-card font-serif text-[18px] font-medium ${
              grade === "?" ? "text-ink-muted border-hairline" : gradeColor
            }`}
          >
            {grade}
          </div>
          <div className="mt-1.5 font-mono-data text-[10px] uppercase tracking-[0.08em] text-ink-muted">
            Riziko
          </div>
        </div>
      </header>

      <ul className="mt-6 space-y-3">
        <PreviewRow
          label="Sociálna poisťovňa"
          state={
            data.hasSocialDebt
              ? { tone: "red", text: "Nedoplatok" }
              : { tone: "green", text: "Bez dlhu" }
          }
        />
        <PreviewRow
          label="Daňové nedoplatky"
          state={
            data.hasTaxDebt
              ? { tone: "red", text: "Evidované" }
              : { tone: "green", text: "Bez dlhu" }
          }
        />
        <PreviewRow
          label="Platca DPH"
          state={
            data.vatPayer
              ? { tone: "blue", text: "Aktívny" }
              : { tone: "amber", text: "Neplatca" }
          }
        />
        {data.revenue && (
          <PreviewRow
            label="Tržby (2024)"
            state={{ tone: "neutral", text: data.revenue }}
          />
        )}
      </ul>

      <div className="mt-6 border-t border-hairline pt-4">
        <Link
          to="/company/$ico"
          params={{ ico: data.ico }}
          className="inline-flex items-center gap-1.5 text-[13px] text-primary transition-colors hover:text-primary/70"
        >
          Kompletný profil · 12 sekcií
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}

function PreviewRow({
  label,
  state,
}: {
  label: string;
  state: { tone: "green" | "red" | "amber" | "blue" | "neutral"; text: string };
}) {
  const styles: Record<typeof state.tone, string> = {
    green: "bg-signal-green-bg text-signal-green",
    red: "bg-signal-red-bg text-signal-red",
    amber: "bg-signal-amber-bg text-signal-amber",
    blue: "bg-signal-blue-bg text-signal-blue",
    neutral: "bg-secondary text-foreground",
  };
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
      <span className="truncate text-[13.5px] text-ink-secondary">{label}</span>
      <span
        className={`shrink-0 rounded-[6px] px-2 py-0.5 font-mono-data text-[11.5px] ${styles[state.tone]}`}
      >
        {state.text}
      </span>
    </li>
  );
}

/* ---------------- How it works ---------------- */

const STEPS = [
  {
    n: "01",
    title: "Vyhľadajte",
    body: "Zadajte názov firmy alebo IČO. Nájdeme subjekt v RPO, ORSR a živnostenskom registri.",
  },
  {
    n: "02",
    title: "Preverte",
    body: "Zobrazíme dlhy, exekúcie, konateľov, finančné výsledky a AI zhodnotenie rizika.",
  },
  {
    n: "03",
    title: "Sledujte",
    body: "Pridajte firmu do monitoringu. E-mail vás upozorní na každú zmenu v registroch.",
  },
];

function HowItWorks() {
  return (
    <section className="border-b border-hairline">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="mb-14 max-w-2xl">
          <p className="font-mono-data text-[11px] uppercase tracking-[0.1em] text-ink-muted">
            Ako to funguje
          </p>
          <h2 className="mt-3 font-serif text-[34px] font-medium leading-tight tracking-[-0.015em] sm:text-[40px]">
            Tri kroky k celému obrazu o firme.
          </h2>
        </div>
        <div className="grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((s, i) => (
            <div key={s.n} className="relative">
              {i < STEPS.length - 1 && (
                <div
                  className="absolute top-3 left-8 hidden h-px w-[calc(100%-2rem)] bg-hairline md:block"
                  aria-hidden
                />
              )}
              <div className="font-mono-data text-[11.5px] text-signal-green">{s.n}</div>
              <h3 className="mt-3 font-serif text-[22px] font-medium leading-snug text-foreground">
                {s.title}
              </h3>
              <p className="mt-2 max-w-sm text-[14.5px] leading-relaxed text-ink-secondary">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Use cases ---------------- */

const USE_CASES = [
  {
    icon: Building2,
    title: "Preverenie obchodného partnera",
    body: "Overte si nového klienta alebo dodávateľa skôr, než podpíšete zmluvu.",
    data: "priemer 4,2 s / firma",
  },
  {
    icon: Eye,
    title: "Monitoring portfólia",
    body: "Sledujte zmeny u desiatok existujúcich odberateľov. Notifikácie e-mailom.",
    data: "24/7 · denné aktualizácie",
  },
  {
    icon: BrainCircuit,
    title: "AI rizikový report",
    body: "Zrozumiteľné zhrnutie rizík a odporúčania k spolupráci s podpisom PDF.",
    data: "GPT-4 · exportovateľné",
  },
];

function UseCases() {
  return (
    <section id="registre" className="border-b border-hairline bg-secondary/40">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="mb-14 max-w-2xl">
          <p className="font-mono-data text-[11px] uppercase tracking-[0.1em] text-ink-muted">
            Pre koho
          </p>
          <h2 className="mt-3 font-serif text-[34px] font-medium leading-tight tracking-[-0.015em] sm:text-[40px]">
            Používajú nás účtovníci, advokáti, banky a obchodníci.
          </h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {USE_CASES.map((c) => (
            <div
              key={c.title}
              className="rounded-[12px] border border-hairline bg-card p-6 sm:p-7"
            >
              <c.icon className="h-6 w-6 text-primary" strokeWidth={1.75} />
              <h3 className="mt-5 font-serif text-[20px] font-medium leading-snug text-foreground">
                {c.title}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-secondary">{c.body}</p>
              <div className="mt-5 border-t border-hairline pt-3 font-mono-data text-[11.5px] text-ink-muted">
                {c.data}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Pricing ---------------- */

const PLANS = [
  {
    name: "Free",
    price: "0 €",
    per: "navždy",
    desc: "Na vyskúšanie základných funkcií.",
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
] as const;

function Pricing() {
  return (
    <section id="pricing">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="mb-14 max-w-2xl">
          <p className="font-mono-data text-[11px] uppercase tracking-[0.1em] text-ink-muted">
            Cenník
          </p>
          <h2 className="mt-3 font-serif text-[34px] font-medium leading-tight tracking-[-0.015em] sm:text-[40px]">
            Bez záväzku, bez kreditnej karty.
          </h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={`relative flex flex-col rounded-[14px] border bg-card p-7 ${
                p.highlighted ? "border-primary" : "border-hairline"
              }`}
            >
              {p.highlighted && (
                <span className="absolute -top-2.5 left-6 rounded-[6px] bg-primary px-2.5 py-0.5 font-mono-data text-[10.5px] uppercase tracking-[0.08em] text-primary-foreground">
                  Odporúčané
                </span>
              )}
              <h3 className="font-serif text-[22px] font-medium text-foreground">{p.name}</h3>
              <p className="mt-1 text-[13.5px] text-ink-secondary">{p.desc}</p>
              <div className="mt-6 flex items-baseline gap-1.5">
                <span className="font-serif text-[38px] font-medium leading-none text-foreground">
                  {p.price}
                </span>
                <span className="font-mono-data text-[12px] text-ink-muted">{p.per}</span>
              </div>
              <ul className="mt-7 flex-1 space-y-2.5 text-[14px] text-ink-secondary">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check
                      className="mt-0.5 h-4 w-4 shrink-0 text-signal-green"
                      strokeWidth={2.5}
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                className={`mt-8 h-11 w-full rounded-[7px] text-[14px] font-medium ${
                  p.highlighted
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border border-hairline bg-card text-foreground hover:bg-secondary"
                }`}
                variant={p.highlighted ? "default" : "outline"}
              >
                <Link to="/register">{p.cta}</Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

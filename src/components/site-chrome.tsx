import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Logo } from "./logo";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 w-full bg-background/85 backdrop-blur-md transition-colors ${
        scrolled ? "border-b border-hairline" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-8 md:flex">
          <a
            href="#registre"
            className="text-[13.5px] text-ink-secondary transition-colors hover:text-foreground"
          >
            Registre
          </a>
          <a
            href="#monitoring"
            className="text-[13.5px] text-ink-secondary transition-colors hover:text-foreground"
          >
            Monitoring
          </a>
          <a
            href="#pricing"
            className="text-[13.5px] text-ink-secondary transition-colors hover:text-foreground"
          >
            Cenník
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="rounded-[7px] text-[13.5px] text-ink-secondary hover:bg-transparent hover:text-foreground"
          >
            <Link to="/login">Účet</Link>
          </Button>
          <Button
            asChild
            size="sm"
            className="rounded-[7px] bg-primary px-4 text-[13.5px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Link to="/login">Prihlásiť sa</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

const REGISTERS = [
  "Finančná správa",
  "Sociálna poisťovňa",
  "RPO",
  "ORSR",
  "RPVS",
  "CRZ",
  "ÚVO",
  "RÚZ",
  "VšZP",
  "Dôvera",
  "Union",
  "Finstat",
];

export function SiteFooter() {
  return (
    <footer className="mt-20 bg-primary text-cream">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="space-y-5">
          <Logo tone="light" />
          <p className="max-w-xs text-[14px] leading-relaxed text-cream/70">
            Preveríme každý slovenský subjekt z verejných registrov. Dlhy, riziká, konatelia,
            finančné zdravie.
          </p>
          <p className="font-mono-data text-[11px] uppercase tracking-[0.08em] text-cream/50">
            Zdroje dát
          </p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono-data text-[11.5px] text-cream/70">
            {REGISTERS.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        <FooterCol title="Produkt" links={["Registre", "Monitoring", "AI report", "API"]} />
        <FooterCol title="Firma" links={["O nás", "Blog", "Kariéra", "Kontakt"]} />
        <FooterCol title="Právne" links={["Súkromie", "Podmienky", "Cookies", "GDPR"]} />
      </div>
      <div className="border-t border-cream/10">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-4 py-5 text-[12px] text-cream/60 sm:flex-row sm:items-center sm:px-6">
          <p>© {new Date().getFullYear()} preversi.sk — všetky práva vyhradené.</p>
          <p className="font-mono-data text-[11px] uppercase tracking-[0.08em]">
            Vyrobené na Slovensku
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <h4 className="mb-4 font-mono-data text-[11px] font-medium uppercase tracking-[0.08em] text-cream/50">
        {title}
      </h4>
      <ul className="space-y-2.5 text-[14px] text-cream/85">
        {links.map((l) => (
          <li key={l}>
            <a href="#" className="transition-colors hover:text-cream">
              {l}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

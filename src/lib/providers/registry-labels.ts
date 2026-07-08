// Client-safe registry metadata. Server-only fetchers live in
// registry.server.ts / finstat.provider.server.ts. This file only exports
// labels + which sources are actually implemented so the UI can render
// honest provider status cards without importing server modules.

import type { ProviderSourceId } from "./types";

export interface ProviderMeta {
  id: ProviderSourceId;
  label: string;
  short: string;
  description: string;
}

export const PROVIDER_META: ProviderMeta[] = [
  { id: "finstat", short: "Finstat", label: "Finstat Premium API", description: "Profil firmy, financie, riziká" },
  { id: "orsr", short: "ORSR", label: "Obchodný register (ORSR)", description: "Právna forma, štatutári, adresa" },
  { id: "ruz", short: "RÚZ", label: "Register účtovných závierok", description: "Účtovné závierky, výkazy" },
  { id: "rpvs", short: "RPVS", label: "Register partnerov verejného sektora", description: "Koneční užívatelia výhod" },
  { id: "crz", short: "CRZ", label: "Centrálny register zmlúv", description: "Zmluvy s verejnou správou" },
  { id: "uvo", short: "ÚVO", label: "Úrad pre verejné obstarávanie", description: "Verejné obstarávania" },
  { id: "financial_admin", short: "Finančná správa", label: "Finančná správa SR", description: "Daňové nedoplatky" },
  { id: "social_insurance", short: "Sociálna poisťovňa", label: "Sociálna poisťovňa", description: "Dlžníci SP" },
  { id: "health_insurance", short: "Zdravotné poisťovne", label: "Zdravotné poisťovne", description: "Dlžníci ZP" },
  { id: "justice", short: "Justice", label: "Justičný portál", description: "Súdne konania" },
  { id: "enforcement", short: "Exekúcie", label: "Centrálny register exekúcií", description: "Aktívne exekúcie" },
  { id: "cadastre", short: "Kataster", label: "Kataster nehnuteľností", description: "Nehnuteľnosti firmy" },
  { id: "ai", short: "AI", label: "Interná AI analýza", description: "AI zhrnutie a odporúčania" },
  { id: "internal", short: "Monitoring", label: "Interný monitoring", description: "Sledovanie zmien" },
];

/** Sources that are actually wired up to real data. All others are placeholders. */
export const IMPLEMENTED_SOURCES: ReadonlySet<ProviderSourceId> = new Set<ProviderSourceId>([
  "finstat",
  "orsr",
  "ruz",
  "rpvs",
  "internal",
]);


export function providerMeta(id: ProviderSourceId): ProviderMeta {
  return (
    PROVIDER_META.find((p) => p.id === id) ?? {
      id,
      short: id,
      label: id,
      description: "",
    }
  );
}

// Všeobecná zdravotná poisťovňa (VšZP) — public debtor list.
//
// The VšZP debtor list at
// https://www.vszp.sk/platitelia/platenie-poistneho/zoznam-dlznikov.html
// is a JSP-based search form (fields: `nazov`, `typ`, `vyhl`) protected by
// WebJET's `spamprotectiondisable.jsp`. It does not expose a stable
// downloadable dataset (CSV / XML / JSON / ZIP) — every request requires
// a per-session anti-bot token and returns paginated HTML.
//
// Per project rules ("if a stable machine-readable endpoint is not
// available, mark that provider as not_implemented rather than scraping
// guessed HTML selectors") this importer records the provider as
// `not_implemented` so the UI shows "Pripravuje sa" and no risk signal
// is ever derived from absence of data.

import type { ImporterOutcome } from "@/lib/insurance-debt.types";

const LANDING_URL =
  "https://www.vszp.sk/platitelia/platenie-poistneho/zoznam-dlznikov.html";

export async function importVszpDebtors(): Promise<ImporterOutcome> {
  return {
    provider: "vszp",
    status: "not_implemented",
    sourceUrl: LANDING_URL,
    recordsDownloaded: 0,
    recordsNormalized: 0,
    recordsWithIco: 0,
    contentHash: null,
    errorMessage:
      "VšZP nezverejňuje stiahnuteľný dataset dlžníkov. Import bude aktivovaný, keď bude dostupné oficiálne rozhranie.",
    records: [],
    sourceRecordDate: null,
  };
}

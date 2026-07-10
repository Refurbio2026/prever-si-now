// Dôvera zdravotná poisťovňa — public debtor list.
//
// The Dôvera debtor list at
// https://www.dovera.sk/overenia/dlznici/zoznam-dlznikov is a per-record
// search page. Inspection of the page shows only a GET form scoped to
// interactive search; there is no CSV / XML / JSON / ZIP dataset and no
// documented public API endpoint.
//
// Per project rules ("if a stable machine-readable endpoint is not
// available, mark that provider as not_implemented rather than scraping
// guessed HTML selectors") this importer records the provider as
// `not_implemented`.

import type { ImporterOutcome } from "@/lib/insurance-debt.types";

const LANDING_URL = "https://www.dovera.sk/overenia/dlznici/zoznam-dlznikov";

export async function importDoveraDebtors(): Promise<ImporterOutcome> {
  return {
    provider: "dovera",
    status: "not_implemented",
    sourceUrl: LANDING_URL,
    recordsDownloaded: 0,
    recordsNormalized: 0,
    recordsWithIco: 0,
    contentHash: null,
    errorMessage:
      "Dôvera nezverejňuje stiahnuteľný dataset dlžníkov. Import bude aktivovaný, keď bude dostupné oficiálne rozhranie.",
    records: [],
    sourceRecordDate: null,
  };
}

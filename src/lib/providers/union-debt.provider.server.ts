// Union zdravotná poisťovňa — public debtor list.
//
// Union publishes the debtor list only via the online-portal SPA at
// https://portal.unionzp.sk/pub/dlznici. The underlying REST endpoint
// (`POST /ehip-server/rest/debtors`) requires session authentication
// (returns HTTP 401 without a portal token) and is not documented for
// bulk download.
//
// Per project rules ("if a stable machine-readable endpoint is not
// available, mark that provider as not_implemented rather than scraping
// guessed HTML selectors") this importer records the provider as
// `not_implemented`.

import type { ImporterOutcome } from "@/lib/insurance-debt.types";

const LANDING_URL = "https://www.union.sk/zoznam-dlznikov/";

export async function importUnionDebtors(): Promise<ImporterOutcome> {
  return {
    provider: "union",
    status: "not_implemented",
    sourceUrl: LANDING_URL,
    recordsDownloaded: 0,
    recordsNormalized: 0,
    recordsWithIco: 0,
    contentHash: null,
    errorMessage:
      "Union nezverejňuje verejne prístupný stiahnuteľný dataset dlžníkov. Import bude aktivovaný, keď bude dostupné oficiálne rozhranie.",
    records: [],
    sourceRecordDate: null,
  };
}

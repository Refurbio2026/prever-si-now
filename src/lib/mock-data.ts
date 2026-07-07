import type {
  Company,
  CompanyChange,
  CompanyPerson,
  FinancialYear,
  MonitoringAlert,
  RiskIndicator,
} from "./types";

export const mockCompanies: Company[] = [
  {
    ico: "31333532",
    dic: "2020317068",
    icDph: "SK2020317068",
    name: "ESET, spol. s r.o.",
    legalForm: "Spoločnosť s ručením obmedzeným",
    address: "Einsteinova 24",
    city: "851 01 Bratislava",
    registrationDate: "1992-06-05",
    vatPayer: true,
    revenue: 245_800_000,
    profit: 58_200_000,
    riskScore: 92,
    riskLevel: "low",
    employees: 1850,
    industry: "Vývoj softvéru",
    website: "eset.sk",
    aiSummary:
      "ESET vykazuje výnimočnú finančnú stabilitu s dlhodobo rastúcimi tržbami a vysokou likviditou. Neevidujeme žiadne dlhy voči štátu ani exekučné konania. Spoločnosť je dôveryhodným obchodným partnerom.",
  },
  {
    ico: "31322832",
    dic: "2020445619",
    icDph: "SK2020445619",
    name: "Slovnaft, a.s.",
    legalForm: "Akciová spoločnosť",
    address: "Vlčie hrdlo 1",
    city: "824 12 Bratislava",
    registrationDate: "1949-04-01",
    vatPayer: true,
    revenue: 4_120_000_000,
    profit: 182_000_000,
    riskScore: 85,
    riskLevel: "low",
    employees: 3450,
    industry: "Petrochémia",
    website: "slovnaft.sk",
    aiSummary:
      "Slovnaft patrí medzi najväčšie priemyselné podniky na Slovensku. Finančné ukazovatele sú stabilné, s miernym poklesom marže spôsobeným volatilitou cien ropy. Nízke kreditné riziko.",
  },
  {
    ico: "35697270",
    dic: "2020310578",
    icDph: "SK2020310578",
    name: "Orange Slovensko, a.s.",
    legalForm: "Akciová spoločnosť",
    address: "Metodova 8",
    city: "821 08 Bratislava",
    registrationDate: "1996-01-16",
    vatPayer: true,
    revenue: 612_000_000,
    profit: 71_400_000,
    riskScore: 81,
    riskLevel: "medium",
    employees: 1120,
    industry: "Telekomunikácie",
    aiSummary:
      "Orange Slovensko si zachováva silnú trhovú pozíciu. Zaznamenali sme mierny pokles marže a jednu drobnú administratívnu zmenu. Odporúčame štandardnú obchodnú spoluprácu.",
  },
  {
    ico: "36562939",
    dic: "2021804304",
    name: "Alza.sk s.r.o.",
    legalForm: "Spoločnosť s ručením obmedzeným",
    address: "Bottova 7",
    city: "811 09 Bratislava",
    registrationDate: "2005-11-14",
    vatPayer: true,
    revenue: 198_400_000,
    profit: 6_200_000,
    riskScore: 74,
    riskLevel: "medium",
    employees: 320,
    industry: "Maloobchod / e-commerce",
    aiSummary:
      "Alza.sk vykazuje silný rast tržieb, avšak s nižšou maržou typickou pre e-commerce. Nedávno zaznamenaná zmena konateľa. Odporúčame monitorovanie.",
  },
  {
    ico: "35924015",
    name: "Krachujúca stavba s.r.o.",
    legalForm: "Spoločnosť s ručením obmedzeným",
    address: "Priemyselná 12",
    city: "040 01 Košice",
    registrationDate: "2014-03-22",
    vatPayer: false,
    revenue: 1_200_000,
    profit: -480_000,
    riskScore: 32,
    riskLevel: "high",
    employees: 14,
    industry: "Stavebníctvo",
    aiSummary:
      "Spoločnosť vykazuje stratu tretí rok po sebe, evidujeme daňový nedoplatok a viacero exekučných konaní. Odporúčame vysokú opatrnosť pri obchodovaní.",
  },
];

export function getCompanyByIco(ico: string): Company | undefined {
  return mockCompanies.find((c) => c.ico === ico);
}

export function searchCompanies(query: string): Company[] {
  if (!query.trim()) return mockCompanies;
  const q = query.toLowerCase();
  return mockCompanies.filter(
    (c) => c.name.toLowerCase().includes(q) || c.ico.includes(q),
  );
}

export const mockFinancials: Record<string, FinancialYear[]> = {
  default: [
    { year: 2020, revenue: 180_000_000, profit: 32_000_000, ebitda: 48_000_000, assets: 320_000_000, liabilities: 120_000_000 },
    { year: 2021, revenue: 205_000_000, profit: 41_000_000, ebitda: 58_000_000, assets: 355_000_000, liabilities: 128_000_000 },
    { year: 2022, revenue: 224_000_000, profit: 49_000_000, ebitda: 67_000_000, assets: 392_000_000, liabilities: 134_000_000 },
    { year: 2023, revenue: 238_000_000, profit: 53_000_000, ebitda: 72_000_000, assets: 421_000_000, liabilities: 141_000_000 },
    { year: 2024, revenue: 245_800_000, profit: 58_200_000, ebitda: 79_400_000, assets: 448_000_000, liabilities: 145_000_000 },
  ],
};

export const mockPeople: CompanyPerson[] = [
  { name: "Ing. Peter Kováč", role: "executive", since: "2015-04-01" },
  { name: "Mgr. Andrea Horváthová", role: "executive", since: "2018-09-12" },
  { name: "Holding Invest SK, a.s.", role: "owner", since: "2010-01-01", share: 65 },
  { name: "Ing. Peter Kováč", role: "owner", since: "2015-04-01", share: 20 },
  { name: "Mgr. Andrea Horváthová", role: "owner", since: "2018-09-12", share: 15 },
  { name: "Ing. Peter Kováč", role: "beneficial_owner", since: "2015-04-01", share: 25 },
  { name: "JUDr. Martin Bielik", role: "beneficial_owner", since: "2010-01-01", share: 40 },
];

export function mockRisks(company: Company): RiskIndicator[] {
  if (company.riskLevel === "high") {
    return [
      { key: "tax_debt", label: "Daňový nedoplatok", status: "critical", detail: "Nedoplatok evidovaný od 03/2025", amount: 24_500 },
      { key: "social_debt", label: "Sociálna poisťovňa", status: "warning", detail: "Nedoplatok 4 210 €", amount: 4210 },
      { key: "health_debt", label: "Zdravotné poisťovne", status: "clear", detail: "Bez nedoplatkov" },
      { key: "insolvency", label: "Konkurz / reštrukturalizácia", status: "clear", detail: "Neevidované" },
      { key: "executions", label: "Exekučné konania", status: "critical", detail: "3 aktívne konania" },
      { key: "vat_reliability", label: "Spoľahlivosť platiteľa DPH", status: "warning", detail: "Nie je platiteľom DPH" },
    ];
  }
  if (company.riskLevel === "medium") {
    return [
      { key: "tax_debt", label: "Daňový nedoplatok", status: "clear", detail: "Bez nedoplatkov" },
      { key: "social_debt", label: "Sociálna poisťovňa", status: "clear", detail: "Bez nedoplatkov" },
      { key: "health_debt", label: "Zdravotné poisťovne", status: "clear", detail: "Bez nedoplatkov" },
      { key: "insolvency", label: "Konkurz / reštrukturalizácia", status: "clear", detail: "Neevidované" },
      { key: "executions", label: "Exekučné konania", status: "warning", detail: "1 ukončené konanie v 2023" },
      { key: "vat_reliability", label: "Spoľahlivosť platiteľa DPH", status: "clear", detail: "Spoľahlivý platiteľ" },
    ];
  }
  return [
    { key: "tax_debt", label: "Daňový nedoplatok", status: "clear", detail: "Bez nedoplatkov" },
    { key: "social_debt", label: "Sociálna poisťovňa", status: "clear", detail: "Bez nedoplatkov" },
    { key: "health_debt", label: "Zdravotné poisťovne", status: "clear", detail: "Bez nedoplatkov" },
    { key: "insolvency", label: "Konkurz / reštrukturalizácia", status: "clear", detail: "Neevidované" },
    { key: "executions", label: "Exekučné konania", status: "clear", detail: "Bez konaní" },
    { key: "vat_reliability", label: "Spoľahlivosť platiteľa DPH", status: "clear", detail: "Spoľahlivý platiteľ" },
  ];
}

export const mockHistory: CompanyChange[] = [
  { date: "2025-01-12", type: "Účtovná závierka", description: "Zverejnená účtovná závierka za rok 2024.", severity: "info" },
  { date: "2024-09-03", type: "Zmena sídla", description: "Zmena adresy sídla spoločnosti.", severity: "info" },
  { date: "2024-06-18", type: "Nový konateľ", description: "Vymenovaný nový konateľ: Mgr. Andrea Horváthová.", severity: "warning" },
  { date: "2023-11-02", type: "Základné imanie", description: "Zvýšenie základného imania na 250 000 €.", severity: "success" },
  { date: "2022-07-25", type: "Predmet podnikania", description: "Rozšírenie predmetu podnikania o vývoj softvéru.", severity: "info" },
  { date: "2020-03-15", type: "Založenie záznamu", description: "Prvý zápis v obchodnom registri.", severity: "success" },
];

export const mockAlerts: MonitoringAlert[] = [
  { id: "a1", date: "2025-03-12", title: "Zverejnená účtovná závierka", description: "Za rok 2024 boli publikované aktuálne finančné výkazy.", severity: "info" },
  { id: "a2", date: "2025-02-28", title: "Zmena v štatutárnych orgánoch", description: "Vymenovaný nový konateľ spoločnosti.", severity: "warning" },
  { id: "a3", date: "2025-01-05", title: "Nový záznam v ORSR", description: "Zaznamenaná zmena v obchodnom registri.", severity: "info" },
];

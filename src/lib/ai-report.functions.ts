// AI Business Intelligence report.
// Cached per-IČO in public.company_ai_reports for 30 days.
// Never called on every page load: reads cache first, only calls Lovable AI
// when the cached row is missing or older than the TTL.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const REPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const icoSchema = z.object({ ico: z.string().regex(/^\d{6,8}$/, "Neplatné IČO") });

export type Recommendation = "LOW RISK" | "MEDIUM RISK" | "HIGH RISK";

export interface AiCompanyReport {
  ico: string;
  summary: string;
  overallScore: number;
  financialScore: number;
  growthScore: number;
  publicScore: number;
  recommendation: Recommendation;
  warnings: string[];
  strengths: string[];
  weaknesses: string[];
  generatedAt: string;
}

export type AiReportResponse =
  | { ok: true; data: AiCompanyReport; source: "cache" | "generated" }
  | { ok: false; error: string; code: string };

function normalizeRecommendation(v: string): Recommendation {
  const s = v.trim().toUpperCase();
  if (s.includes("HIGH")) return "HIGH RISK";
  if (s.includes("MEDIUM")) return "MEDIUM RISK";
  return "LOW RISK";
}

function clampScore(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return 50;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((s) => s.length > 0)
    .slice(0, 8);
}

export const getAiReportFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<AiReportResponse> => {
    const ico = data.ico;

    // 1. Try cache.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: cached } = await supabaseAdmin
        .from("company_ai_reports")
        .select("*")
        .eq("ico", ico)
        .maybeSingle();
      if (cached) {
        const age = Date.now() - new Date(cached.generated_at).getTime();
        if (age < REPORT_TTL_MS) {
          return {
            ok: true,
            source: "cache",
            data: {
              ico: cached.ico,
              summary: cached.summary,
              overallScore: cached.overall_score,
              financialScore: cached.financial_score,
              growthScore: cached.growth_score,
              publicScore: cached.public_score,
              recommendation: normalizeRecommendation(cached.recommendation),
              warnings: toStringArray(cached.warnings),
              strengths: toStringArray(cached.strengths),
              weaknesses: toStringArray(cached.weaknesses),
              generatedAt: cached.generated_at,
            },
          };
        }
      }
    } catch {
      // fall through to generation
    }

    // 2. Load company intelligence to feed the model.
    const { getCompanyIntelligenceFn } = await import("./company-intelligence.functions");
    const intelRes = await getCompanyIntelligenceFn({ data: { ico } });
    if (!intelRes.ok) {
      return { ok: false, error: intelRes.error, code: "intel_failed" };
    }
    const intel = intelRes.data;
    if (!intel.company) {
      return { ok: false, error: "Firma sa nenašla.", code: "company_not_found" };
    }

    // 3. Deterministic scores from aggregated data.
    const c = intel.company;
    const fins = [...intel.financials].sort((a, b) => a.year - b.year);
    const last = fins.at(-1);
    const prev = fins.at(-2);

    // Financial health: base 50 + profit/asset signals, minus debts/warnings.
    let financial = 50;
    if (last) {
      if (last.profit > 0) financial += 20;
      else if (last.profit < 0) financial -= 20;
      if (last.assets > last.liabilities) financial += 10;
      else if (last.liabilities > last.assets * 1.5) financial -= 15;
    }
    const debt =
      (c.debtIndicators?.taxDebt ?? 0) +
      (c.debtIndicators?.socialDebt ?? 0) +
      (c.debtIndicators?.healthDebt ?? 0) +
      (c.debtIndicators?.judicialDebt ?? 0);
    if (debt > 0) financial -= Math.min(30, Math.ceil(debt / 1000));
    if ((c.warnings?.length ?? 0) > 0) financial -= 5 * c.warnings!.length;
    financial = clampScore(financial);

    // Growth: YoY revenue + profit change.
    let growth = 50;
    if (last && prev) {
      if (prev.revenue > 0) {
        const rGrowth = (last.revenue - prev.revenue) / prev.revenue;
        growth += Math.max(-30, Math.min(30, Math.round(rGrowth * 60)));
      }
      if (prev.profit !== 0) {
        const pGrowth = (last.profit - prev.profit) / Math.abs(prev.profit);
        growth += Math.max(-15, Math.min(15, Math.round(pGrowth * 30)));
      }
    } else if (last && last.profit > 0) {
      growth += 5;
    }
    growth = clampScore(growth);

    // Public sector activity: contract count + volume.
    const contractCount = intel.contracts.length;
    const contractValue = intel.contracts.reduce((s, ct) => s + (ct.value ?? 0), 0);
    let publicScore = 20;
    publicScore += Math.min(50, contractCount * 3);
    if (contractValue > 100_000) publicScore += 10;
    if (contractValue > 1_000_000) publicScore += 10;
    if (intel.rpvsStatus === "aktívny") publicScore += 10;
    publicScore = clampScore(publicScore);

    // Overall: 100 - risk. Base on Finstat riskScore if available, blended with computed signals.
    const finstatHealth = typeof c.riskScore === "number" ? clampScore(c.riskScore) : 50;
    const overall = clampScore(
      Math.round(finstatHealth * 0.5 + financial * 0.35 + growth * 0.15),
    );

    // 4. Prompt AI for narrative + labeled arrays + recommendation.
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "LOVABLE_API_KEY nie je nakonfigurovaný.", code: "no_api_key" };
    }

    const yearsSummary = fins
      .slice(-4)
      .map(
        (f) =>
          `${f.year}: tržby ${Math.round(f.revenue)} €, zisk ${Math.round(f.profit)} €, aktíva ${Math.round(f.assets)} €`,
      )
      .join("; ");

    const contractSample = intel.contracts
      .slice(0, 5)
      .map((ct) => `• ${ct.title} (${ct.counterparty}, ${ct.value ?? "?"} ${ct.currency ?? ""})`)
      .join("\n");

    const facts = [
      `Názov: ${c.name}`,
      `IČO: ${c.ico}`,
      `Právna forma: ${c.legalForm}`,
      `Sídlo: ${c.address}`,
      `Dátum vzniku: ${c.registrationDate}`,
      c.industry ? `Odvetvie: ${c.industry}` : null,
      typeof c.employees === "number" ? `Zamestnanci: ${c.employees}` : null,
      c.vatPayerConfidence === "confirmed" && c.vatPayer === true
        ? "Platca DPH: áno (potvrdené)"
        : "Platca DPH: Stav DPH nie je možné jednoznačne potvrdiť z dostupných údajov.",
      fins.length >= 2
        ? `Finančné roky — ${yearsSummary}`
        : "Finančný časový rad: Detailný časový rad finančných údajov nie je dostupný.",
      contractCount > 0
        ? `Verejné zmluvy (CRZ): ${contractCount}, spolu ${Math.round(contractValue)} €`
        : "Verejné zmluvy: žiadne",
      contractSample ? `Vzorka zmlúv:\n${contractSample}` : null,
      intel.rpvsStatus ? `RPVS: ${intel.rpvsStatus}` : null,
      c.warnings?.length ? `Upozornenia: ${c.warnings.join(", ")}` : null,
      debt > 0 ? `Evidované dlhy spolu: ${debt} €` : "Bez evidovaných dlhov",
    ]
      .filter(Boolean)
      .join("\n");

    const system = `Si expert na hodnotenie slovenských firiem. Odpovedaj IBA validným JSON objektom v tomto tvare:
{"summary": string (5-6 viet v slovenčine), "recommendation": "LOW RISK" | "MEDIUM RISK" | "HIGH RISK", "warnings": string[], "strengths": string[], "weaknesses": string[]}
Bez markdownu, bez kódových blokov. Zhrnutie píš prirodzenou slovenčinou pre biznis publikum.
Pravidlá pre DPH: Netvrď, že firma je "neplatca DPH", pokiaľ to nie je vo faktoch výslovne potvrdené. Ak je stav DPH nedostupný, uveď doslovne "Stav DPH nie je možné jednoznačne potvrdiť z dostupných údajov." a neodvodzuj ho z iných polí.`;

    const user = `Vytvor exekutívne zhrnutie pre nasledovnú firmu.
Vypočítané skóre (0-100, vyššie = lepšie): finančné zdravie ${financial}, rast ${growth}, verejný sektor ${publicScore}, celkové ${overall}.

Fakty:
${facts}`;

    let aiJson: {
      summary?: string;
      recommendation?: string;
      warnings?: unknown;
      strengths?: unknown;
      weaknesses?: unknown;
    } = {};
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (res.status === 429) {
        return { ok: false, error: "AI je momentálne preťažená. Skúste to znova o chvíľu.", code: "rate_limited" };
      }
      if (res.status === 402) {
        return { ok: false, error: "AI kredit vyčerpaný. Doplňte kredity vo workspace nastaveniach.", code: "no_credits" };
      }
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `AI gateway zlyhalo: ${res.status} ${body.slice(0, 200)}`, code: "ai_failed" };
      }
      const payload = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content ?? "{}";
      try {
        aiJson = JSON.parse(content) as typeof aiJson;
      } catch {
        aiJson = { summary: content };
      }
    } catch (err) {
      const e = err as Error;
      return { ok: false, error: e.message ?? "AI volanie zlyhalo.", code: "ai_exception" };
    }

    const report: AiCompanyReport = {
      ico,
      summary:
        typeof aiJson.summary === "string" && aiJson.summary.trim().length > 0
          ? aiJson.summary.trim()
          : `Firma ${c.name} pôsobí na trhu od ${c.registrationDate}. Dostupné údaje z verejných registrov sú obmedzené na základné informácie.`,
      overallScore: overall,
      financialScore: financial,
      growthScore: growth,
      publicScore,
      recommendation: normalizeRecommendation(aiJson.recommendation ?? (overall >= 70 ? "LOW RISK" : overall >= 45 ? "MEDIUM RISK" : "HIGH RISK")),
      warnings: toStringArray(aiJson.warnings),
      strengths: toStringArray(aiJson.strengths),
      weaknesses: toStringArray(aiJson.weaknesses),
      generatedAt: new Date().toISOString(),
    };

    // 5. Persist.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("company_ai_reports").upsert(
        {
          ico,
          summary: report.summary,
          overall_score: report.overallScore,
          financial_score: report.financialScore,
          growth_score: report.growthScore,
          public_score: report.publicScore,
          recommendation: report.recommendation,
          warnings: report.warnings,
          strengths: report.strengths,
          weaknesses: report.weaknesses,
          generated_at: report.generatedAt,
          updated_at: report.generatedAt,
        },
        { onConflict: "ico" },
      );
    } catch {
      // best-effort persistence
    }

    return { ok: true, source: "generated", data: report };
  });

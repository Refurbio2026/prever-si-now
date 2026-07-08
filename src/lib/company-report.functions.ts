// Server-side PDF report generation for company profiles.
// Uses pdf-lib + @pdf-lib/fontkit with an embedded Unicode TTF (Noto Sans)
// so Slovak diacritics render correctly.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const icoSchema = z.object({ ico: z.string().regex(/^\d{6,8}$/, "Neplatné IČO") });

export interface CompanyReportPdfResponse {
  ok: boolean;
  filename?: string;
  base64?: string;
  error?: string;
}

const MISSING = "Údaj nebol dostupný v čase generovania reportu.";

const FONT_REGULAR_URL =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Regular.ttf";
const FONT_BOLD_URL =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Bold.ttf";

let cachedRegular: Uint8Array | null = null;
let cachedBold: Uint8Array | null = null;

async function loadFont(url: string, cached: Uint8Array | null): Promise<Uint8Array> {
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font fetch failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function safe(input: string | number | null | undefined): string {
  if (input == null) return MISSING;
  return typeof input === "number" ? String(input) : input;
}


function fmtEur(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return MISSING;
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return MISSING;
  try {
    return new Date(iso).toLocaleDateString("sk-SK");
  } catch {
    return iso;
  }
}

interface IntelSnapshot {
  company?: {
    name?: string;
    ico?: string;
    dic?: string;
    icDph?: string;
    legalForm?: string;
    address?: string;
    registrationDate?: string;
    revenue?: number;
    profit?: number;
    latestAssets?: number;
    latestLiabilities?: number;
    latestFinancialsYear?: number;
    riskScore?: number;
    riskLevel?: string;
  };
  financials?: Array<{ year: number; revenue: number; profit: number; assets: number; liabilities: number }>;
  statements?: Array<{ year: number; type?: string; documentUrl?: string }>;
  contracts?: Array<{ title?: string; value?: number; signedDate?: string; supplier?: string; contractingAuthority?: string }>;
  risks?: Array<{ key: string; title?: string; status?: string; details?: string }>;
  sources?: Array<{ id: string; label?: string; state: string }>;
  unified?: {
    contracts?: { data?: Array<Record<string, unknown>> };
    procurement?: { data?: Array<Record<string, unknown>> };
  };
}

export const generateCompanyReportPdfFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data, context }): Promise<CompanyReportPdfResponse> => {
    const ico = data.ico;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { PDFDocument, rgb } = await import("pdf-lib");
    const fontkit = (await import("@pdf-lib/fontkit")).default;


    // Fetch everything in parallel.
    const [
      cacheRes,
      registryRes,
      peopleRes,
      historyRes,
      aiRes,
      changesRes,
    ] = await Promise.all([
      supabaseAdmin.from("company_cache").select("data").eq("ico", ico).maybeSingle(),
      supabaseAdmin.from("company_registry").select("*").eq("ico", ico).order("imported_at", { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from("company_people").select("*").eq("ico", ico),
      supabaseAdmin.from("company_history").select("*").eq("ico", ico).order("event_date", { ascending: false, nullsFirst: false }).limit(50),
      supabaseAdmin.from("company_ai_reports").select("*").eq("ico", ico).order("generated_at", { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from("company_changes").select("*").eq("ico", ico).order("detected_at", { ascending: false }).limit(20),
    ]);

    const intel = (cacheRes.data?.data ?? undefined) as IntelSnapshot | undefined;
    const registryDb = registryRes.data ?? null;
    const people = peopleRes.data ?? [];
    const history = historyRes.data ?? [];
    const ai = aiRes.data ?? null;
    const changes = changesRes.data ?? [];

    const company = intel?.company;
    const displayName =
      company?.name ??
      registryDb?.name ??
      undefined;
    const displayAddress = company?.address ?? registryDb?.address ?? undefined;
    const displayLegalForm = company?.legalForm ?? registryDb?.legal_form ?? undefined;
    const displayRegDate = company?.registrationDate ?? registryDb?.registration_date ?? undefined;

    // Build PDF.
    const pdf = await PDFDocument.create();
    pdf.setTitle(`PreverSi report ${displayName ?? ico}`);
    pdf.setAuthor("PreverSi.sk");
    pdf.setProducer("PreverSi.sk");
    pdf.setCreator("PreverSi.sk");

    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const marginX = 48;
    const marginTop = 56;
    const marginBottom = 56;
    const contentWidth = pageWidth - marginX * 2;

    let page = pdf.addPage([pageWidth, pageHeight]);
    let cursorY = pageHeight - marginTop;

    const brand = rgb(0.08, 0.11, 0.24);
    const brandAccent = rgb(0.18, 0.35, 0.85);
    const muted = rgb(0.42, 0.45, 0.52);
    const border = rgb(0.85, 0.87, 0.9);
    const text = rgb(0.11, 0.12, 0.16);
    const danger = rgb(0.78, 0.14, 0.14);
    const ok = rgb(0.13, 0.55, 0.29);

    function ensureSpace(needed: number): void {
      if (cursorY - needed < marginBottom) {
        page = pdf.addPage([pageWidth, pageHeight]);
        cursorY = pageHeight - marginTop;
      }
    }

    function drawText(
      s: string,
      opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; indent?: number } = {},
    ): void {
      const size = opts.size ?? 10;
      const font = opts.bold ? helvBold : helv;
      const color = opts.color ?? text;
      const startX = opts.x ?? marginX + (opts.indent ?? 0);
      const maxWidth = pageWidth - marginX - startX;
      const lines = wrapText(safe(s), font, size, maxWidth);
      for (const line of lines) {
        ensureSpace(size + 4);
        page.drawText(line, { x: startX, y: cursorY - size, size, font, color });
        cursorY -= size + 4;
      }
    }

    function wrapText(
      s: string,
      font: import("pdf-lib").PDFFont,
      size: number,
      maxWidth: number,
    ): string[] {
      const out: string[] = [];
      for (const paragraph of s.split(/\n/)) {
        const words = paragraph.split(/\s+/);
        let line = "";
        for (const w of words) {
          const attempt = line ? `${line} ${w}` : w;
          if (font.widthOfTextAtSize(attempt, size) > maxWidth && line) {
            out.push(line);
            line = w;
          } else {
            line = attempt;
          }
        }
        if (line) out.push(line);
        if (paragraph === "") out.push("");
      }
      return out;
    }

    function drawDivider(): void {
      ensureSpace(12);
      cursorY -= 6;
      page.drawLine({
        start: { x: marginX, y: cursorY },
        end: { x: pageWidth - marginX, y: cursorY },
        thickness: 0.6,
        color: border,
      });
      cursorY -= 10;
    }

    function drawSectionTitle(title: string): void {
      ensureSpace(28);
      cursorY -= 4;
      page.drawRectangle({
        x: marginX,
        y: cursorY - 18,
        width: 4,
        height: 16,
        color: brandAccent,
      });
      page.drawText(safe(title), {
        x: marginX + 10,
        y: cursorY - 14,
        size: 13,
        font: helvBold,
        color: brand,
      });
      cursorY -= 24;
    }

    function drawKeyValueGrid(rows: Array<[string, string]>, cols = 2): void {
      const colWidth = contentWidth / cols;
      const rowHeight = 28;
      let col = 0;
      let rowTopY = cursorY;
      for (const [k, v] of rows) {
        if (col === 0) {
          ensureSpace(rowHeight);
          rowTopY = cursorY;
        }
        const x = marginX + col * colWidth;
        page.drawText(safe(k), {
          x,
          y: rowTopY - 10,
          size: 8,
          font: helvBold,
          color: muted,
        });
        const valueLines = wrapText(safe(v), helv, 10, colWidth - 8);
        page.drawText(valueLines[0] ?? "", {
          x,
          y: rowTopY - 22,
          size: 10,
          font: helv,
          color: text,
        });
        col += 1;
        if (col >= cols) {
          col = 0;
          cursorY = rowTopY - rowHeight;
        }
      }
      if (col !== 0) cursorY = rowTopY - rowHeight;
    }

    function drawBulletList(items: string[]): void {
      if (items.length === 0) {
        drawText(MISSING, { color: muted });
        return;
      }
      for (const item of items) {
        ensureSpace(14);
        page.drawText("•", { x: marginX, y: cursorY - 10, size: 10, font: helvBold, color: brandAccent });
        const lines = wrapText(safe(item), helv, 10, contentWidth - 14);
        for (let i = 0; i < lines.length; i += 1) {
          ensureSpace(14);
          page.drawText(lines[i]!, { x: marginX + 14, y: cursorY - 10, size: 10, font: helv, color: text });
          cursorY -= 14;
        }
      }
    }

    // ── HEADER ────────────────────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: pageHeight - 90, width: pageWidth, height: 90, color: brand });
    page.drawText("PreverSi.sk", {
      x: marginX, y: pageHeight - 46,
      size: 22, font: helvBold, color: rgb(1, 1, 1),
    });
    page.drawText(safe("Report o spoločnosti"), {
      x: marginX, y: pageHeight - 66,
      size: 11, font: helv, color: rgb(0.83, 0.86, 0.95),
    });
    const genOn = `Vygenerované: ${new Date().toLocaleString("sk-SK")}`;
    const genOnAscii = safe(genOn);
    const genWidth = helv.widthOfTextAtSize(genOnAscii, 9);
    page.drawText(genOnAscii, {
      x: pageWidth - marginX - genWidth,
      y: pageHeight - 46,
      size: 9,
      font: helv,
      color: rgb(0.83, 0.86, 0.95),
    });
    cursorY = pageHeight - 100;

    // ── IDENTITY ─────────────────────────────────────────────────────────
    drawText(displayName ?? MISSING, { size: 18, bold: true, color: brand });
    cursorY -= 2;
    drawText(displayAddress ?? MISSING, { size: 10, color: muted });
    drawDivider();
    drawKeyValueGrid([
      ["IČO", ico],
      ["DIČ", company?.dic ?? MISSING],
      ["IČ DPH", company?.icDph ?? MISSING],
      ["Právna forma", displayLegalForm ?? MISSING],
      ["Dátum vzniku", fmtDate(displayRegDate)],
      ["Zdroj dát", registryDb?.source ?? "cache"],
    ]);

    // ── TRUST / RISK SCORE ───────────────────────────────────────────────
    drawSectionTitle("Trust Score / Rizikové skóre");
    const overall = ai?.overall_score ?? company?.riskScore;
    const scoreLine = overall != null
      ? `Celkové skóre: ${overall}/100${company?.riskLevel ? `  (úroveň rizika: ${company.riskLevel})` : ""}`
      : MISSING;
    drawText(scoreLine, { size: 12, bold: true });
    if (ai) {
      drawKeyValueGrid([
        ["Finančné skóre", `${ai.financial_score}/100`],
        ["Rastové skóre", `${ai.growth_score}/100`],
        ["Verejný sektor", `${ai.public_score}/100`],
        ["Odporúčanie", ai.recommendation ?? MISSING],
      ]);
    }

    // ── AI SUMMARY ───────────────────────────────────────────────────────
    drawSectionTitle("AI zhodnotenie");
    drawText(ai?.summary ?? MISSING);
    const strengths = Array.isArray(ai?.strengths) ? (ai!.strengths as unknown[]).map(String) : [];
    const weaknesses = Array.isArray(ai?.weaknesses) ? (ai!.weaknesses as unknown[]).map(String) : [];
    const warnings = Array.isArray(ai?.warnings) ? (ai!.warnings as unknown[]).map(String) : [];
    if (strengths.length) {
      cursorY -= 4;
      drawText("Silné stránky", { bold: true, color: ok });
      drawBulletList(strengths);
    }
    if (weaknesses.length) {
      cursorY -= 4;
      drawText("Slabé stránky", { bold: true });
      drawBulletList(weaknesses);
    }
    if (warnings.length) {
      cursorY -= 4;
      drawText("Varovania", { bold: true, color: danger });
      drawBulletList(warnings);
    }

    // ── FINANCIAL KPIs ───────────────────────────────────────────────────
    drawSectionTitle("Finančné ukazovatele");
    const yearLabel = company?.latestFinancialsYear ? `za rok ${company.latestFinancialsYear}` : "";
    drawText(`Najnovšie hodnoty ${yearLabel}`.trim(), { color: muted, size: 9 });
    drawKeyValueGrid([
      ["Tržby", fmtEur(company?.revenue)],
      ["Zisk", fmtEur(company?.profit)],
      ["Aktíva", fmtEur(company?.latestAssets)],
      ["Pasíva", fmtEur(company?.latestLiabilities)],
    ]);

    // ── ACCOUNTING STATEMENTS ────────────────────────────────────────────
    drawSectionTitle("Účtovné závierky");
    const statements = intel?.statements ?? [];
    if (statements.length === 0) {
      drawText(MISSING, { color: muted });
    } else {
      drawBulletList(
        statements.slice(0, 10).map((s) => {
          const parts = [
            s.year != null ? `Rok ${s.year}` : null,
            s.type ?? null,
          ].filter(Boolean);
          return parts.join(" · ") || MISSING;
        }),
      );
    }

    // ── PEOPLE ───────────────────────────────────────────────────────────
    drawSectionTitle("Osoby a koneční užívatelia výhod");
    if (people.length === 0) {
      drawText(MISSING, { color: muted });
    } else {
      const grouped = new Map<string, string[]>();
      for (const p of people) {
        const role = p.role || "štatutárny orgán";
        const list = grouped.get(role) ?? [];
        const range = [fmtDate(p.valid_from), p.valid_to ? `do ${fmtDate(p.valid_to)}` : null]
          .filter(Boolean)
          .join(" – ");
        list.push(`${p.person_name}${range ? ` (${range})` : ""}`);
        grouped.set(role, list);
      }
      for (const [role, names] of grouped) {
        cursorY -= 2;
        drawText(role, { bold: true });
        drawBulletList(names);
      }
    }

    // ── CONTRACTS ────────────────────────────────────────────────────────
    drawSectionTitle("Verejné zákazky a zmluvy");
    const contracts = intel?.contracts ?? [];
    if (contracts.length === 0) {
      drawText(MISSING, { color: muted });
    } else {
      drawText(`Celkovo ${contracts.length} záznamov. Ukážka najnovších:`, { color: muted, size: 9 });
      drawBulletList(
        contracts.slice(0, 8).map((c) => {
          const parts = [
            c.title ?? MISSING,
            c.value != null ? fmtEur(c.value) : null,
            c.signedDate ? fmtDate(c.signedDate) : null,
            c.contractingAuthority ?? null,
          ].filter(Boolean) as string[];
          return parts.join(" · ");
        }),
      );
    }

    // ── RISKS ────────────────────────────────────────────────────────────
    drawSectionTitle("Riziká a varovania");
    const risks = (intel?.risks ?? []).filter((r) => r.status && r.status !== "clear");
    if (risks.length === 0) {
      drawText("Neboli identifikované žiadne kritické riziká.", { color: ok });
    } else {
      drawBulletList(
        risks.map((r) => {
          const t = r.title ?? r.key;
          return `${t}${r.details ? ` — ${r.details}` : ""}${r.status ? ` [${r.status}]` : ""}`;
        }),
      );
    }

    // ── MONITORING ───────────────────────────────────────────────────────
    drawSectionTitle("Zmeny a monitoring");
    if (changes.length === 0 && history.length === 0) {
      drawText(MISSING, { color: muted });
    } else {
      if (changes.length > 0) {
        drawText("Nedávno detegované zmeny:", { bold: true });
        drawBulletList(
          changes.slice(0, 10).map((c) =>
            `${fmtDate(c.detected_at)} · ${c.title}${c.description ? ` — ${c.description}` : ""}`,
          ),
        );
      }
      if (history.length > 0) {
        cursorY -= 4;
        drawText("História z registrov:", { bold: true });
        drawBulletList(
          history.slice(0, 12).map((h) =>
            `${fmtDate(h.event_date)} · ${h.title}${h.description ? ` — ${h.description}` : ""}`,
          ),
        );
      }
    }

    // ── DATA SOURCES ─────────────────────────────────────────────────────
    drawSectionTitle("Zdroje dát");
    const sources = intel?.sources ?? [];
    if (sources.length === 0) {
      drawText(MISSING, { color: muted });
    } else {
      drawBulletList(
        sources.map((s) => `${s.label ?? s.id} — stav: ${s.state}`),
      );
    }

    // ── FOOTER on every page ─────────────────────────────────────────────
    const pages = pdf.getPages();
    const footer = safe(`PreverSi.sk · Report o spoločnosti ${displayName ?? ico} · ${new Date().toLocaleDateString("sk-SK")}`);
    pages.forEach((p, i) => {
      p.drawText(footer, { x: marginX, y: 24, size: 8, font: helv, color: muted });
      const num = `Strana ${i + 1} / ${pages.length}`;
      const w = helv.widthOfTextAtSize(num, 8);
      p.drawText(num, { x: pageWidth - marginX - w, y: 24, size: 8, font: helv, color: muted });
    });

    const bytes = await pdf.save();

    // Save metadata to `reports`.
    try {
      await supabaseAdmin.from("reports").insert({
        ico,
        company_name: displayName ?? ico,
        user_id: context.userId,
        report_type: "pdf",
      });
    } catch {
      // metadata insert failures should not block download
    }

    // Encode to base64 (chunked to avoid stack overflow on large PDFs).
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);
    const safeName = (displayName ?? ico).replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 60);
    const filename = `preversi-report-${safeName}-${ico}.pdf`;

    return { ok: true, filename, base64 };
  });

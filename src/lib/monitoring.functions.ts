// Company monitoring: snapshot + change detection.
// Client-safe module — server-only imports live inside handlers.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const icoInput = z.object({ ico: z.string().regex(/^\d{6,8}$/, "Neplatné IČO") });

export type ChangeSeverity = "info" | "warning" | "critical";

export interface CompanyChangeRow {
  id: string;
  ico: string;
  changeType: string;
  title: string;
  description: string | null;
  severity: ChangeSeverity;
  detectedAt: string;
}

export type DetectResponse =
  | { ok: true; changes: CompanyChangeRow[]; created: number; snapshotSaved: boolean; source: "initial" | "compared" }
  | { ok: false; error: string; code: string };

interface SnapshotShape {
  name: string;
  address: string;
  legalForm: string;
  vatPayer: boolean;
  riskScore: number;
  aiRecommendation: string | null;
  beneficialOwners: string[];
  statementsCount: number;
  contractsCount: number;
  capturedAt: string;
}

function normalizeSeverity(v: string): ChangeSeverity {
  if (v === "warning" || v === "critical") return v;
  return "info";
}

async function buildSnapshotFromIntel(ico: string): Promise<SnapshotShape | null> {
  const { getCompanyIntelligenceFn } = await import("./company-intelligence.functions");
  const res = await getCompanyIntelligenceFn({ data: { ico } });
  if (!res.ok || !res.data.company) return null;
  const intel = res.data;
  const c = intel.company!;

  // Try to include AI recommendation if a cached AI report exists (do NOT force generation).
  let aiRecommendation: string | null = null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: aiRow } = await supabaseAdmin
      .from("company_ai_reports")
      .select("recommendation")
      .eq("ico", ico)
      .maybeSingle();
    if (aiRow?.recommendation) aiRecommendation = aiRow.recommendation;
  } catch {
    // ignore
  }

  return {
    name: c.name,
    address: c.address,
    legalForm: c.legalForm,
    vatPayer: !!c.vatPayer,
    riskScore: typeof c.riskScore === "number" ? c.riskScore : 0,
    aiRecommendation,
    beneficialOwners: [...intel.beneficialOwners].map((p) => p.name).sort(),
    statementsCount: intel.statements.length,
    contractsCount: intel.contracts.length,
    capturedAt: new Date().toISOString(),
  };
}

interface DetectedChange {
  changeType: string;
  title: string;
  description: string | null;
  severity: ChangeSeverity;
}

function diffSnapshots(prev: SnapshotShape, curr: SnapshotShape): DetectedChange[] {
  const changes: DetectedChange[] = [];

  if (prev.name !== curr.name) {
    changes.push({
      changeType: "company_name",
      title: "Zmena názvu firmy",
      description: `"${prev.name}" → "${curr.name}"`,
      severity: "warning",
    });
  }
  if (prev.address !== curr.address) {
    changes.push({
      changeType: "address",
      title: "Zmena sídla",
      description: `${prev.address} → ${curr.address}`,
      severity: "warning",
    });
  }
  if (prev.legalForm !== curr.legalForm) {
    changes.push({
      changeType: "legal_form",
      title: "Zmena právnej formy",
      description: `${prev.legalForm} → ${curr.legalForm}`,
      severity: "warning",
    });
  }
  if (prev.vatPayer !== curr.vatPayer) {
    changes.push({
      changeType: "vat_status",
      title: curr.vatPayer ? "Firma sa stala platcom DPH" : "Firma prestala byť platcom DPH",
      description: `${prev.vatPayer ? "áno" : "nie"} → ${curr.vatPayer ? "áno" : "nie"}`,
      severity: "warning",
    });
  }

  const riskDelta = curr.riskScore - prev.riskScore;
  if (Math.abs(riskDelta) >= 10) {
    changes.push({
      changeType: "risk_score",
      title: riskDelta < 0 ? "Zhoršenie rizikového skóre" : "Zlepšenie rizikového skóre",
      description: `Skóre ${prev.riskScore} → ${curr.riskScore} (${riskDelta > 0 ? "+" : ""}${riskDelta})`,
      severity: riskDelta <= -20 ? "critical" : riskDelta < 0 ? "warning" : "info",
    });
  }

  if ((prev.aiRecommendation ?? "") !== (curr.aiRecommendation ?? "") && curr.aiRecommendation) {
    changes.push({
      changeType: "ai_recommendation",
      title: "Zmena AI odporúčania",
      description: `${prev.aiRecommendation ?? "—"} → ${curr.aiRecommendation}`,
      severity: curr.aiRecommendation === "HIGH RISK" ? "critical" : "info",
    });
  }

  const prevOwners = new Set(prev.beneficialOwners);
  const currOwners = new Set(curr.beneficialOwners);
  const added = [...currOwners].filter((o) => !prevOwners.has(o));
  const removed = [...prevOwners].filter((o) => !currOwners.has(o));
  if (added.length > 0 || removed.length > 0) {
    const parts: string[] = [];
    if (added.length > 0) parts.push(`pridaní: ${added.join(", ")}`);
    if (removed.length > 0) parts.push(`odstránení: ${removed.join(", ")}`);
    changes.push({
      changeType: "beneficial_owners",
      title: "Zmena konečných užívateľov výhod",
      description: parts.join(" • "),
      severity: "warning",
    });
  }

  if (prev.statementsCount !== curr.statementsCount) {
    const delta = curr.statementsCount - prev.statementsCount;
    changes.push({
      changeType: "accounting_statements",
      title: delta > 0 ? "Nové účtovné závierky" : "Ubudli účtovné závierky",
      description: `${prev.statementsCount} → ${curr.statementsCount}`,
      severity: "info",
    });
  }

  if (prev.contractsCount !== curr.contractsCount) {
    const delta = curr.contractsCount - prev.contractsCount;
    changes.push({
      changeType: "crz_contracts",
      title: delta > 0 ? "Nové verejné zmluvy (CRZ)" : "Ubudli verejné zmluvy (CRZ)",
      description: `${prev.contractsCount} → ${curr.contractsCount}`,
      severity: delta > 0 ? "info" : "warning",
    });
  }

  return changes;
}

/** Start watching a company. Adds to watched_companies and writes an initial snapshot. */
export const watchCompanyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ico: z.string().regex(/^\d{6,8}$/),
        companyName: z.string().min(1),
        riskScore: z.number().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Idempotent insert into watched_companies (unique per user + ico is enforced upstream by UI checks).
    const { data: existing } = await supabase
      .from("watched_companies")
      .select("id")
      .eq("user_id", userId)
      .eq("ico", data.ico)
      .maybeSingle();
    if (!existing) {
      const { error } = await supabase.from("watched_companies").insert({
        user_id: userId,
        ico: data.ico,
        company_name: data.companyName,
        risk_score: data.riskScore ?? null,
      });
      if (error) throw new Error(error.message);
    }

    const snapshot = await buildSnapshotFromIntel(data.ico);
    if (snapshot) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("company_snapshots").insert({
        ico: data.ico,
        data: snapshot as unknown as never,
      });
    }
    return { ok: true as const };
  });

/** Compare the current unified data to the latest stored snapshot, emit changes, save new snapshot. */
export const detectCompanyChangesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => icoInput.parse(input))
  .handler(async ({ data }): Promise<DetectResponse> => {
    const ico = data.ico;

    const current = await buildSnapshotFromIntel(ico);
    if (!current) {
      return { ok: false, error: "Nepodarilo sa načítať aktuálne údaje firmy.", code: "intel_failed" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: latest } = await supabaseAdmin
      .from("company_snapshots")
      .select("data, created_at")
      .eq("ico", ico)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // First snapshot — nothing to compare to.
    if (!latest) {
      await supabaseAdmin
        .from("company_snapshots")
        .insert({ ico, data: current as unknown as never });
      return { ok: true, source: "initial", changes: [], created: 0, snapshotSaved: true };
    }

    const prev = latest.data as unknown as SnapshotShape;
    const diffs = diffSnapshots(prev, current);

    let inserted: CompanyChangeRow[] = [];
    if (diffs.length > 0) {
      const rows = diffs.map((d) => ({
        ico,
        change_type: d.changeType,
        title: d.title,
        description: d.description,
        severity: d.severity,
      }));
      const { data: insertedRows, error } = await supabaseAdmin
        .from("company_changes")
        .insert(rows)
        .select("id, ico, change_type, title, description, severity, detected_at");
      if (error) return { ok: false, error: error.message, code: "insert_failed" };
      inserted = (insertedRows ?? []).map((r) => ({
        id: r.id,
        ico: r.ico,
        changeType: r.change_type,
        title: r.title,
        description: r.description,
        severity: normalizeSeverity(r.severity),
        detectedAt: r.detected_at,
      }));
    }

    // Always save a fresh snapshot so future comparisons chain forward.
    await supabaseAdmin
      .from("company_snapshots")
      .insert({ ico, data: current as unknown as never });

    return { ok: true, source: "compared", changes: inserted, created: inserted.length, snapshotSaved: true };
  });

/** Fetch stored change records for one IČO (used by the profile monitoring tab). */
export const getCompanyChangesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ico: z.string().regex(/^\d{6,8}$/), limit: z.number().int().min(1).max(100).optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<CompanyChangeRow[]> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("company_changes")
      .select("id, ico, change_type, title, description, severity, detected_at")
      .eq("ico", data.ico)
      .order("detected_at", { ascending: false })
      .limit(data.limit ?? 20);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id,
      ico: r.ico,
      changeType: r.change_type,
      title: r.title,
      description: r.description,
      severity: normalizeSeverity(r.severity),
      detectedAt: r.detected_at,
    }));
  });

export interface WatchedWithChanges {
  id: string;
  ico: string;
  companyName: string;
  riskScore: number | null;
  createdAt: string;
  latestChange: CompanyChangeRow | null;
  changeCount: number;
}

/** For the monitoring dashboard: watched companies + latest detected change per IČO. */
export const getWatchedWithChangesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WatchedWithChanges[]> => {
    const { supabase, userId } = context;
    const { data: watched, error } = await supabase
      .from("watched_companies")
      .select("id, ico, company_name, risk_score, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = watched ?? [];
    if (rows.length === 0) return [];

    const icos = [...new Set(rows.map((r) => r.ico))];
    const { data: changes } = await supabase
      .from("company_changes")
      .select("id, ico, change_type, title, description, severity, detected_at")
      .in("ico", icos)
      .order("detected_at", { ascending: false });

    const byIco = new Map<string, CompanyChangeRow[]>();
    for (const c of changes ?? []) {
      const list = byIco.get(c.ico) ?? [];
      list.push({
        id: c.id,
        ico: c.ico,
        changeType: c.change_type,
        title: c.title,
        description: c.description,
        severity: normalizeSeverity(c.severity),
        detectedAt: c.detected_at,
      });
      byIco.set(c.ico, list);
    }

    return rows.map((r) => {
      const list = byIco.get(r.ico) ?? [];
      return {
        id: r.id,
        ico: r.ico,
        companyName: r.company_name,
        riskScore: r.risk_score,
        createdAt: r.created_at,
        latestChange: list[0] ?? null,
        changeCount: list.length,
      };
    });
  });

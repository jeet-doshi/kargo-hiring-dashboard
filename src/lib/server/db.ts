import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors";
import { env } from "./env";
import type { CandidateRow, Role, RubricCriterion } from "@/lib/types";

let client: SupabaseClient | null = null;

/** Server-only Supabase client using the service-role key. Never imported by client components. */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export function dbError(context: string, error: { message: string; code?: string } | null): AppError {
  console.error(`[db] ${context}:`, error);
  return new AppError("DB_ERROR", `Database error while ${context}. Please try again.`, 500);
}

export async function loadRubric(): Promise<Record<Role, RubricCriterion[]>> {
  const { data, error } = await db()
    .from("rubric_criteria")
    .select("id, role, criterion_number, criterion_name, description, weight")
    .order("criterion_number");
  if (error) throw dbError("loading the rubric", error);
  const rows = (data ?? []).map((r) => ({ ...r, weight: Number(r.weight) })) as RubricCriterion[];
  const byRole = { PM: rows.filter((r) => r.role === "PM"), SPM: rows.filter((r) => r.role === "SPM") };
  if (!byRole.PM.length || !byRole.SPM.length) {
    throw new AppError(
      "RUBRIC_MISSING",
      "The scoring rubric has not been loaded into the database yet. Run `npm run seed` first.",
      500,
    );
  }
  return byRole;
}

/** Columns safe to send to the list view (no CV content). */
export const LIST_COLUMNS =
  "id, applied_role, original_filename, personal_name, personal_email, pm_score, spm_score, interview_brief, email_type, email_sent, email_subject, created_at";

export async function getCandidate(id: string): Promise<CandidateRow> {
  const { data, error } = await db().from("candidates").select("*").eq("id", id).maybeSingle();
  if (error) throw dbError("loading the candidate", error);
  if (!data) throw new AppError("NOT_FOUND", "Candidate not found.", 404);
  return normalizeCandidate(data);
}

export function normalizeCandidate<T extends Record<string, unknown>>(row: T): T & CandidateRow {
  return {
    ...row,
    pm_score: row.pm_score == null ? null : Number(row.pm_score),
    spm_score: row.spm_score == null ? null : Number(row.spm_score),
  } as T & CandidateRow;
}

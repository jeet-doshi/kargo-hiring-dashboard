import "server-only";
import { db, dbError, getCandidate, loadRubric } from "./db";
import { scoreCandidate } from "./ai/score";
import { draftEmail, refreshTopBriefs } from "./pipeline";
import type { RubricCriterion, Role } from "@/lib/types";

/**
 * Re-score a stored candidate from its anonymised CV (no PII involved), e.g.
 * after the rubric or scoring prompt changes, so that every candidate is
 * assessed under identical rules. Clears the brief and, if the email has not
 * been sent, regenerates the draft (the type may change with the new score).
 */
export async function rescoreCandidate(id: string, rubric?: Record<Role, RubricCriterion[]>): Promise<void> {
  const r = rubric ?? (await loadRubric());
  const c = await getCandidate(id);
  const [pm, spm] = await Promise.all([
    scoreCandidate(c.anonymized_cv_content, "PM", r.PM),
    scoreCandidate(c.anonymized_cv_content, "SPM", r.SPM),
  ]);
  const { error } = await db()
    .from("candidates")
    .update({
      pm_score: pm.total,
      spm_score: spm.total,
      pm_score_breakdown: pm.breakdown,
      spm_score_breakdown: spm.breakdown,
      interview_brief: null,
      interview_brief_role: null,
    })
    .eq("id", id);
  if (error) throw dbError("saving re-scored results", error);
  if (!c.email_sent) await draftEmail(await getCandidate(id));
}

export { refreshTopBriefs };

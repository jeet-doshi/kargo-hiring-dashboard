import "server-only";
import { createHash } from "crypto";
import { AppError } from "@/lib/errors";
import { parseCv } from "@/lib/cv/parse";
import { anonymize, assertNoPii, extractPersonalInfo, nameFromFilename } from "@/lib/cv/pii";
import { rankForRole, shortlistRole } from "@/lib/ranking";
import type { CandidateRow, EmailType, Role } from "@/lib/types";
import { db, dbError, getCandidate, loadRubric, normalizeCandidate } from "./db";
import { env } from "./env";
import { extractCandidate } from "./ai/extract";
import { scoreCandidate } from "./ai/score";
import { generateBrief } from "./ai/brief";
import { generateEmail } from "./ai/email";

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

export type ProcessResult = { id: string; name: string | null; warnings: string[] };

/**
 * Full upload pipeline: parse -> split PII -> anonymise -> (extract + score PM + score SPM)
 * -> save -> email draft -> refresh top-N interview briefs.
 *
 * Scores are saved as soon as they exist; the email draft and briefs are
 * best-effort and can be regenerated from the candidate page if they fail.
 */
export async function processUpload(file: { name: string; bytes: Uint8Array }, role: Role): Promise<ProcessResult> {
  const text = await parseCv(file.name, file.bytes);
  const fileHash = sha256(file.bytes);
  const contentHash = sha256(text.toLowerCase().replace(/\s+/g, " "));

  // Duplicate check (also enforced by unique constraints in the database).
  const { data: dupes, error: dupErr } = await db()
    .from("candidates")
    .select("id, personal_name, applied_role")
    .or(`file_hash.eq.${fileHash},content_hash.eq.${contentHash}`)
    .limit(1);
  if (dupErr) throw dbError("checking for duplicates", dupErr);
  if (dupes?.length) {
    const d = dupes[0];
    throw new AppError(
      "DUPLICATE",
      `This CV has already been uploaded${d.personal_name ? ` (${d.personal_name}, ${d.applied_role})` : ""}.`,
      409,
    );
  }

  // Personal details are found locally and kept out of everything sent to the AI.
  const pii = extractPersonalInfo(text, file.name);
  const anonymized = anonymize(text, pii, [nameFromFilename(file.name)]);
  try {
    assertNoPii(anonymized, pii);
  } catch (err) {
    console.error("[pipeline] PII guard tripped", (err as Error).message);
    throw new AppError(
      "ANONYMISATION_FAILED",
      "We couldn't safely remove personal details from this CV, so it was not sent for analysis.",
      422,
    );
  }

  const rubric = await loadRubric();
  const [extraction, pm, spm] = await Promise.all([
    extractCandidate(anonymized),
    scoreCandidate(anonymized, "PM", rubric.PM),
    scoreCandidate(anonymized, "SPM", rubric.SPM),
  ]);

  const { data: inserted, error: insErr } = await db()
    .from("candidates")
    .insert({
      applied_role: role,
      original_filename: file.name,
      file_hash: fileHash,
      content_hash: contentHash,
      personal_name: pii.name,
      personal_email: pii.email,
      personal_phone: pii.phone,
      name_source: pii.nameSource,
      anonymized_cv_content: anonymized,
      extraction_json: extraction,
      pm_score: pm.total,
      spm_score: spm.total,
      pm_score_breakdown: pm.breakdown,
      spm_score_breakdown: spm.breakdown,
    })
    .select("*")
    .single();
  if (insErr) {
    if (insErr.code === "23505") throw new AppError("DUPLICATE", "This CV has already been uploaded.", 409);
    throw dbError("saving the candidate", insErr);
  }
  const candidate = normalizeCandidate(inserted) as CandidateRow;

  const warnings: string[] = [];
  if (!pii.email) warnings.push("No email address was found in the CV. Add one on the candidate page before sending.");
  if (!pii.name) warnings.push("No name could be detected. Add it on the candidate page.");

  try {
    await draftEmail(candidate);
  } catch (err) {
    console.error("[pipeline] email draft failed", err);
    warnings.push("The email draft could not be generated. Use 'Regenerate draft' on the candidate page.");
  }
  try {
    await refreshTopBriefs(role);
  } catch (err) {
    console.error("[pipeline] brief refresh failed", err);
    warnings.push("Interview briefs could not be refreshed. Use 'Generate brief' on the candidate page.");
  }

  return { id: candidate.id, name: pii.name, warnings };
}

/**
 * (Re)generate the email draft. By default the type follows the system
 * recommendation (see shortlistRole); the founder can override it.
 */
export async function draftEmail(c: CandidateRow, override?: EmailType): Promise<void> {
  if (c.email_sent) throw new AppError("ALREADY_SENT", "This email has already been sent.", 409);
  const recommendedInvite = shortlistRole(c, env.shortlistThreshold());
  const type: EmailType = override ?? (recommendedInvite ? "interview_invitation" : "rejection");
  const inviteRole = type === "interview_invitation" ? (recommendedInvite ?? c.applied_role) : null;
  const draft = await generateEmail({
    type,
    role: c.applied_role,
    inviteRole,
    extraction: c.extraction_json,
    breakdown: c.applied_role === "PM" ? c.pm_score_breakdown : c.spm_score_breakdown,
    signOff: env.founderName(),
  });
  const { error } = await db()
    .from("candidates")
    .update({ email_subject: draft.subject, email_body: draft.body, email_type: type })
    .eq("id", c.id)
    .eq("email_sent", false);
  if (error) throw dbError("saving the email draft", error);
}

export async function writeBrief(c: CandidateRow, role: Role): Promise<string> {
  const breakdown = role === "PM" ? c.pm_score_breakdown : c.spm_score_breakdown;
  const score = role === "PM" ? c.pm_score : c.spm_score;
  if (!breakdown || score == null) throw new AppError("NOT_SCORED", "This candidate has not been scored yet.", 400);
  const brief = await generateBrief({ role, score, breakdown, extraction: c.extraction_json });
  const { error } = await db()
    .from("candidates")
    .update({ interview_brief: brief, interview_brief_role: role })
    .eq("id", c.id);
  if (error) throw dbError("saving the interview brief", error);
  return brief;
}

/** Ensure the top-N applicants for a role each have a brief for that role. */
export async function refreshTopBriefs(role: Role): Promise<void> {
  const { data, error } = await db()
    .from("candidates")
    .select("id, applied_role, pm_score, spm_score, created_at, interview_brief, interview_brief_role")
    .eq("applied_role", role);
  if (error) throw dbError("loading rankings", error);
  const top = rankForRole((data ?? []).map(normalizeCandidate), role).slice(0, env.briefTopN());
  const missing = top.filter((c) => !c.interview_brief || c.interview_brief_role !== role);
  for (const m of missing) {
    await writeBrief(await getCandidate(m.id), role);
  }
}

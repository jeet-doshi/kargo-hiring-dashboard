import type { EmailType, Role } from "@/lib/types";

type Scored = {
  id: string;
  applied_role: Role;
  pm_score: number | null;
  spm_score: number | null;
  created_at: string;
};

export function roleScore(c: Pick<Scored, "pm_score" | "spm_score">, role: Role): number {
  return (role === "PM" ? c.pm_score : c.spm_score) ?? 0;
}

/**
 * Candidates are ranked within the role they applied for, by their score on
 * that role's rubric (ties: earlier application first).
 */
export function rankForRole<T extends Scored>(candidates: T[], role: Role): (T & { rank: number })[] {
  return candidates
    .filter((c) => c.applied_role === role)
    .sort((a, b) => roleScore(b, role) - roleScore(a, role) || a.created_at.localeCompare(b.created_at))
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

type ShortlistInput = Pick<Scored, "applied_role" | "pm_score" | "spm_score">;

/**
 * The role a candidate should be invited to interview for, or null for a rejection.
 * - Clears the line on the applied role's rubric -> invite for the applied role.
 * - SPM applicant who misses the SPM line but clears the PM line -> invite for PM.
 */
export function shortlistRole(c: ShortlistInput, threshold: number): Role | null {
  if (roleScore(c, c.applied_role) >= threshold) return c.applied_role;
  if (c.applied_role === "SPM" && roleScore(c, "PM") >= threshold) return "PM";
  return null;
}

export function isShortlisted(c: ShortlistInput, threshold: number): boolean {
  return shortlistRole(c, threshold) !== null;
}

export function emailTypeFor(c: ShortlistInput, threshold: number): EmailType {
  return isShortlisted(c, threshold) ? "interview_invitation" : "rejection";
}

/** Senior role is recommended only when the candidate clears the bar on the SPM rubric. */
export function recommendedRole(c: Pick<Scored, "pm_score" | "spm_score">, threshold: number): Role {
  return (c.spm_score ?? 0) >= threshold ? "SPM" : "PM";
}

export function scoreBand(score: number, threshold: number): "strong" | "borderline" | "weak" {
  if (score >= threshold) return "strong";
  if (score >= threshold - 15) return "borderline";
  return "weak";
}

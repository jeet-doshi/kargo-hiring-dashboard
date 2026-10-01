import { isShortlisted } from "@/lib/ranking";
import type { EmailType, Role } from "@/lib/types";

type DecisionInput = {
  applied_role: Role;
  pm_score: number | null;
  spm_score: number | null;
  email_type: EmailType | null;
  email_sent: boolean;
};

/**
 * The founder's decision, as distinct from the system recommendation.
 * Only an email the founder explicitly sent counts as a decision.
 */
export function decisionText(c: DecisionInput, threshold: number): string {
  const kind = c.email_type === "interview_invitation" ? "invitation" : "rejection";
  if (c.email_sent) return `Decided: you sent the ${kind}`;
  if (!c.email_type) return "Awaiting your decision (no draft yet)";
  const recommended: EmailType = isShortlisted(c, threshold) ? "interview_invitation" : "rejection";
  if (c.email_type !== recommended) return `Awaiting your decision (you switched the draft to ${kind})`;
  return `Awaiting your decision (${kind} draft ready, not sent)`;
}

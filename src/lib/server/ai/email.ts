import "server-only";
import { z } from "zod";
import { generateJson } from "../gemini";
import { NAME_PLACEHOLDER } from "@/lib/email-format";
import { ROLE_LABELS, type CandidateExtraction, type CriterionScore, type EmailType, type Role } from "@/lib/types";


const EmailSchema = z.object({
  subject: z.string().min(5).max(120),
  body: z.string().min(80).max(2500),
});

const SYSTEM = `You draft candidate emails for the founder of Kargo, a logistics SaaS startup.
Rules:
- Start the body with "Hi ${NAME_PLACEHOLDER}," on its own line. Use ${NAME_PLACEHOLDER} wherever the name is needed; never invent a name.
- Plain text only (no markdown, no HTML). Short paragraphs. 90-180 words.
- Personalise with one or two specific, genuine details from the candidate's background provided below. Do not invent facts.
- Never mention scores, rubrics, rankings, AI, or internal evaluation criteria.
- Do not promise dates, salaries, or outcomes, and do not invent interview times or links.
- The candidate has only submitted a CV. There has been no call, interview or conversation; do not imply one.
- End with the sign-off provided.`;

const TYPE_INSTRUCTIONS: Record<EmailType, string> = {
  interview_invitation:
    "Write an interview invitation: thank them, say what about their background caught our attention, invite them to a 45-minute conversation with the founder, and ask them to reply with a few times that suit them over the next week.",
  rejection:
    "Write a warm, respectful rejection: thank them sincerely for their time, acknowledge one genuine strength from their background, clearly say we will not be moving forward for this role, and wish them well. Do not give false hope or detailed feedback.",
};

export async function generateEmail(input: {
  type: EmailType;
  role: Role;
  /** For invitations: the role we want to interview them for (may differ from the applied role). */
  inviteRole?: Role | null;
  extraction: CandidateExtraction | null;
  breakdown: CriterionScore[] | null;
  signOff: string;
}): Promise<{ subject: string; body: string }> {
  const background = input.extraction
    ? [
        `Headline: ${input.extraction.headline}`,
        `Summary: ${input.extraction.summary}`,
        ...input.extraction.roles.slice(0, 3).map((r) => `Role: ${r.title} at ${r.organisation} (${r.organisation_type})`),
      ].join("\n")
    : "No structured background available; keep personalisation general.";
  const crossRole =
    input.type === "interview_invitation" && input.inviteRole && input.inviteRole !== input.role
      ? `
Important: they applied for ${ROLE_LABELS[input.role]}, but we would like to interview them for the ${ROLE_LABELS[input.inviteRole]} role instead. Say this plainly and positively (their background is a strong fit for ${ROLE_LABELS[input.inviteRole]}), without implying they failed. The subject should name the ${ROLE_LABELS[input.inviteRole]} role.`
      : "";
  const strengths =
    input.breakdown
      ?.filter((c) => c.evidence_found && c.score >= 5)
      .map((c) => `- ${c.reason}`)
      .join("\n") || "- (none recorded)";

  return generateJson({
    task: "email drafting",
    system: SYSTEM,
    prompt: `Email type: ${input.type === "interview_invitation" ? "Interview invitation" : "Rejection"}
Role applied for: ${ROLE_LABELS[input.role]} at Kargo
${TYPE_INSTRUCTIONS[input.type]}${crossRole}

Candidate background (anonymised):
${background}

Strengths noted from the CV (for personalisation only; do not reveal that an assessment exists):
${strengths}

Sign-off:
${input.signOff}
Kargo`,
    schema: EmailSchema,
    check: (e) => {
      if (!e.body.includes(NAME_PLACEHOLDER)) return `the body must greet the candidate using ${NAME_PLACEHOLDER}`;
      if (/\[(CANDIDATE|EMAIL|PHONE|LINK)\]/.test(e.body + e.subject)) return "remove anonymisation placeholders such as [CANDIDATE]";
      if (/\bscore|rubric|\/100\b/i.test(e.body)) return "do not mention scores or rubrics";
      return null;
    },
  });
}


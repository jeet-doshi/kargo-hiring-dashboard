import "server-only";
import { z } from "zod";
import { generateJson } from "../gemini";
import { ROLE_LABELS, type CriterionScore, type Role, type RubricCriterion } from "@/lib/types";

export const SCORE_SCALE = `0-10 scale, applied identically to every candidate and criterion:
- 0: No evidence for this criterion in the CV.
- 1-3: Something related is present, but it fails most of the stated requirements of the bar.
- 4-6: Partially meets the bar: some required elements are present, at least one required element is missing.
- 7-8: Meets the bar: every required element is explicitly present in the CV.
- 9-10: Clearly exceeds the bar: every required element is present, with multiple strong, specific instances.
"Required elements" are the AND-conditions written in the criterion. Anything the criterion says "does not count" or "does not qualify" earns no credit.`;

const ScoreSchema = z.object({
  criteria: z.array(
    z.object({
      criterion_number: z.number().int(),
      evidence_found: z.boolean().describe("false if the CV contains no relevant evidence"),
      evidence_quote: z
        .string()
        .describe("Short verbatim quote copied exactly from the CV supporting the score; empty string if none"),
      reason: z
        .string()
        .min(5)
        .max(400)
        .describe("One sentence explaining the score against the bar; if no evidence, start with 'Evidence not found:'"),
      score: z.number().int().min(0).max(10),
    }),
  ),
});

const SYSTEM = `You are a strict, consistent hiring assessor for Kargo, a logistics SaaS company.
You score an anonymised CV against a fixed rubric. The rubric is the ONLY source of criteria: do not add, drop or reinterpret criteria, and do not use generic job-description requirements.

Evidence rules:
- Base every score solely on what the CV text explicitly states. Never assume, infer from job titles alone, or fill gaps.
- evidence_quote must be copied verbatim from the CV (a phrase or bullet, max ~40 words). Do not paraphrase inside the quote.
- If no supporting evidence exists, set evidence_found=false, evidence_quote="", score=0, and begin the reason with "Evidence not found:" followed by what was missing.
- Read each bar exactly as written. Where the bar gives examples of acceptable evidence (e.g. "adopted by 2 other regional teams", "12 key accounts"), a CV statement of that form satisfies that element: do not demand stronger proof or more explicit wording than the bar itself asks for.
- Equally, give no credit for anything the bar explicitly excludes, and do not relax any required element.
- The reason must be one sentence naming which required elements are present and which are missing.
- Placeholders such as [CANDIDATE], [EMAIL], [PHONE], [LINK] are anonymisation markers; ignore them.

${SCORE_SCALE}`;

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9%+$]+/g, " ")
    .trim();
}

/** True if every fragment of the quote (split on ellipses) appears in the CV. */
export function quoteInCv(quote: string, cv: string): boolean {
  const haystack = normalise(cv);
  const fragments = quote
    .split(/\.\.\.|…/)
    .map(normalise)
    .filter((f) => f.length > 0);
  return fragments.length > 0 && fragments.every((f) => haystack.includes(f));
}

export type RoleScore = { total: number; breakdown: CriterionScore[] };

export function weightedTotal(breakdown: Pick<CriterionScore, "weighted_score">[]): number {
  return Math.round(breakdown.reduce((s, c) => s + c.weighted_score, 0) * 10) / 10;
}

export async function scoreCandidate(
  anonymizedCv: string,
  role: Role,
  rubric: RubricCriterion[],
): Promise<RoleScore> {
  const expected = rubric.map((c) => c.criterion_number).sort((a, b) => a - b);
  // Weights are deliberately not shown to the model: it scores each criterion
  // on its own merits; weighting happens deterministically below.
  const rubricText = rubric
    .map((c) => `Criterion ${c.criterion_number}: ${c.criterion_name}\nBar: ${c.description}`)
    .join("\n\n");

  const result = await generateJson({
    task: `${ROLE_LABELS[role]} scoring`,
    system: SYSTEM,
    prompt: `Role being assessed: ${ROLE_LABELS[role]}

<rubric>
${rubricText}
</rubric>

<cv>
${anonymizedCv}
</cv>

Score the CV on each of the ${rubric.length} criteria above. Return exactly one entry per criterion_number (${expected.join(", ")}).`,
    schema: ScoreSchema,
    check: (r) => {
      const got = r.criteria.map((c) => c.criterion_number).sort((a, b) => a - b);
      if (got.join(",") !== expected.join(",")) {
        return `expected criterion_numbers [${expected.join(", ")}] exactly once each, got [${got.join(", ")}]`;
      }
      return null;
    },
    softCheck: (r) => {
      const unverified = r.criteria.filter(
        (c) => c.evidence_found && c.score > 0 && !quoteInCv(c.evidence_quote, anonymizedCv),
      );
      return unverified.length
        ? `evidence_quote for criterion ${unverified.map((c) => c.criterion_number).join(", ")} is not a verbatim quote from the CV; copy the exact text, or set evidence_found=false and score=0 if no such text exists`
        : null;
    },
    attempts: 3,
  });

  const breakdown: CriterionScore[] = rubric.map((c) => {
    const r = result.criteria.find((x) => x.criterion_number === c.criterion_number)!;
    // Enforce the "no evidence => 0" rule regardless of what the model returned.
    const evidenceFound = r.evidence_found && r.evidence_quote.trim().length > 0;
    const score = evidenceFound ? r.score : 0;
    const quote = evidenceFound ? r.evidence_quote.trim() : null;
    let reason = r.reason.trim();
    if (!evidenceFound && !/^evidence not found/i.test(reason)) reason = `Evidence not found: ${reason}`;
    return {
      criterion_number: c.criterion_number,
      criterion_name: c.criterion_name,
      weight: c.weight,
      score,
      weighted_score: Math.round(((score * c.weight) / 10) * 100) / 100,
      reason,
      evidence_quote: quote,
      evidence_found: evidenceFound,
      quote_verified: quote ? quoteInCv(quote, anonymizedCv) : false,
    };
  });

  return { total: weightedTotal(breakdown), breakdown };
}

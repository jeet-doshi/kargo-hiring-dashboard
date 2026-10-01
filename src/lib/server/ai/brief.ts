import "server-only";
import { z } from "zod";
import { generateJson } from "../gemini";
import { ROLE_LABELS, type CandidateExtraction, type CriterionScore, type Role } from "@/lib/types";

const BriefSchema = z.object({
  why_stands_out: z.string().describe("Sentence 1: why this candidate stands out for the role"),
  strongest_evidence: z.string().describe("Sentence 2: the strongest CV evidence behind the score"),
  what_to_probe: z.string().describe("Sentence 3: what the founder should probe in the interview"),
});

const SYSTEM = `You write interview briefs for a busy startup founder.
A brief is exactly three sentences, each a single sentence of at most 40 words:
1. Why this candidate stands out for the role.
2. The strongest evidence behind their rubric score (cite concrete facts from the evidence provided).
3. What the founder should probe in the interview: target the weakest or unverified rubric criteria.
Use only the scores, reasons and quotes provided. Do not invent facts. Refer to the person as "the candidate" (never use a name).`;

function isOneSentence(s: string): boolean {
  const trimmed = s.trim();
  if (!/[.!?]$/.test(trimmed)) return false;
  // No sentence break in the middle (allow decimals and abbreviations like "e.g.").
  return !/[a-z0-9)\]][.!?]\s+[A-Z]/.test(trimmed.slice(0, -1).replace(/\b(e\.g|i\.e|vs|approx|etc)\./gi, "$1"));
}

export async function generateBrief(input: {
  role: Role;
  score: number;
  breakdown: CriterionScore[];
  extraction: CandidateExtraction | null;
}): Promise<string> {
  const evidence = input.breakdown
    .map(
      (c) =>
        `- ${c.criterion_name} (weight ${c.weight}%): ${c.score}/10. ${c.reason}${c.evidence_quote ? ` Quote: "${c.evidence_quote}"` : ""}`,
    )
    .join("\n");
  const profile = input.extraction
    ? `${input.extraction.headline}. ${input.extraction.summary}`
    : "No structured profile available.";

  const brief = await generateJson({
    task: "interview brief",
    system: SYSTEM,
    prompt: `Role: ${ROLE_LABELS[input.role]}
Rubric score: ${input.score}/100

Profile (anonymised): ${profile}

Rubric evidence:
${evidence}

Write the three-sentence brief.`,
    schema: BriefSchema,
    check: (b) => {
      const bad = Object.entries(b).filter(([, v]) => !isOneSentence(v)).map(([k]) => k);
      return bad.length ? `${bad.join(", ")} must each be exactly one sentence ending with a full stop` : null;
    },
  });
  return [brief.why_stands_out, brief.strongest_evidence, brief.what_to_probe].map((s) => s.trim()).join(" ");
}

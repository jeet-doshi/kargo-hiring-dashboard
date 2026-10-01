import "server-only";
import { z } from "zod";
import { generateJson } from "../gemini";
import type { CandidateExtraction } from "@/lib/types";

const ExtractionSchema = z.object({
  headline: z.string().describe("One-line professional headline based only on the CV"),
  total_years_experience: z.number().min(0).max(60).nullable(),
  current_title: z.string().nullable(),
  summary: z.string().describe("2-3 sentence neutral summary of the career, no evaluation"),
  roles: z
    .array(
      z.object({
        title: z.string(),
        organisation: z.string(),
        organisation_type: z.string().describe("e.g. 'Freight SaaS', '3PL', 'Port operator', 'FMCG'"),
        start: z.string().nullable(),
        end: z.string().nullable(),
        highlights: z.array(z.string()).max(6).describe("Key bullets, paraphrased faithfully"),
      }),
    )
    .max(15),
  logistics_operations_roles: z
    .array(z.string())
    .describe("Titles of roles where the candidate personally did logistics/shipment operations work; empty if none"),
  education: z.array(z.string()).max(8),
  skills: z.array(z.string()).max(25),
});

const SYSTEM = `You extract structured facts from an anonymised CV for an internal hiring tool.
Rules:
- Use only information explicitly present in the CV text. Never infer or invent employers, dates, numbers or skills.
- Use null or an empty list when information is missing.
- The CV has been anonymised: placeholders like [CANDIDATE], [EMAIL], [PHONE], [LINK] replace personal details. Do not try to recover them.
- Do not evaluate or score the candidate.`;

export async function extractCandidate(anonymizedCv: string): Promise<CandidateExtraction> {
  return generateJson({
    task: "CV extraction",
    system: SYSTEM,
    prompt: `Extract the structured profile from this anonymised CV.\n\n<cv>\n${anonymizedCv}\n</cv>`,
    schema: ExtractionSchema,
  });
}

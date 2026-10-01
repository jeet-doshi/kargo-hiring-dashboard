import "server-only";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { env } from "./env";

let client: GoogleGenAI | null = null;
function gemini(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: env.geminiApiKey() });
  return client;
}

function toResponseSchema(schema: z.ZodType): unknown {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

type GenerateOptions<T extends z.ZodType> = {
  task: string; // used in logs and error messages, e.g. "scoring"
  system: string;
  prompt: string;
  schema: T;
  /** Extra semantic validation; return an error string to trigger a retry. */
  check?: (value: z.infer<T>) => string | null;
  /** Like check, but on the final attempt the value is accepted anyway (caller flags it). */
  softCheck?: (value: z.infer<T>) => string | null;
  attempts?: number;
};

/**
 * Calls Gemini with structured JSON output and validates the result with zod.
 * Malformed or invalid responses are retried (with the validation error fed
 * back); after the final attempt a founder-safe AppError is thrown.
 */
export async function generateJson<T extends z.ZodType>(opts: GenerateOptions<T>): Promise<z.infer<T>> {
  const attempts = opts.attempts ?? 3;
  let feedback = "";
  let lastProblem = "";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let raw: string | undefined;
    try {
      const res = await gemini().models.generateContent({
        model: env.geminiModel(),
        contents: opts.prompt + feedback,
        config: {
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          responseJsonSchema: toResponseSchema(opts.schema),
          seed: 7,
        },
      });
      raw = res.text;
    } catch (err) {
      const status = (err as { status?: number }).status;
      console.error(`[gemini] ${opts.task} attempt ${attempt} API error`, status, (err as Error).message);
      lastProblem = "api";
      if (status === 400 || status === 401 || status === 403 || status === 404) {
        throw new AppError(
          "AI_UNAVAILABLE",
          `The AI service rejected the request during ${opts.task} (check the Gemini API key and model name).`,
          502,
        );
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw ?? "");
    } catch {
      console.warn(`[gemini] ${opts.task} attempt ${attempt}: response was not valid JSON`);
      lastProblem = "malformed";
      feedback = "\n\nYour previous response was not valid JSON. Respond with JSON only, matching the schema.";
      continue;
    }

    const result = opts.schema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      console.warn(`[gemini] ${opts.task} attempt ${attempt}: schema validation failed: ${issues}`);
      lastProblem = "malformed";
      feedback = `\n\nYour previous response failed validation (${issues}). Fix these problems and respond again.`;
      continue;
    }

    const problem = opts.check?.(result.data) ?? null;
    if (problem) {
      console.warn(`[gemini] ${opts.task} attempt ${attempt}: check failed: ${problem}`);
      lastProblem = "malformed";
      feedback = `\n\nYour previous response had a problem: ${problem}. Fix it and respond again.`;
      continue;
    }
    const softProblem = opts.softCheck?.(result.data) ?? null;
    if (softProblem && attempt < attempts) {
      console.warn(`[gemini] ${opts.task} attempt ${attempt}: soft check failed: ${softProblem}`);
      feedback = `\n\nYour previous response had a problem: ${softProblem}. Fix it and respond again.`;
      continue;
    }
    return result.data;
  }

  if (lastProblem === "api") {
    throw new AppError("AI_UNAVAILABLE", `The AI service is unavailable right now (${opts.task}). Please try again in a minute.`, 502);
  }
  throw new AppError("AI_MALFORMED", `The AI returned an unusable response during ${opts.task}. Please try again.`, 502);
}

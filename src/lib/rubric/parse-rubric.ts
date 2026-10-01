import type { Role } from "@/lib/types";

export type ParsedCriterion = {
  role: Role;
  criterion_number: number;
  criterion_name: string;
  description: string;
  weight: number;
};

const SECTION_HEADERS: Record<string, Role> = {
  "PRODUCT MANAGER RUBRIC": "PM",
  "SENIOR PRODUCT MANAGER RUBRIC": "SPM",
};

/**
 * Parses rubric.txt. Expected shape per role section:
 *
 *   <ROLE> RUBRIC
 *   Criterion N: <name>
 *   What a strong candidate looks like: <description>
 *   Weight: NN%
 *   ...
 *   Total Weight: 100%
 *
 * Throws if the structure is unexpected or a role's weights don't sum to 100.
 */
export function parseRubric(text: string): ParsedCriterion[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim());
  const out: ParsedCriterion[] = [];
  let role: Role | null = null;
  let current: Partial<ParsedCriterion> | null = null;

  const flush = () => {
    if (!current) return;
    if (!current.role || !current.criterion_name || !current.description || !current.weight) {
      throw new Error(`Incomplete rubric criterion: ${JSON.stringify(current)}`);
    }
    out.push(current as ParsedCriterion);
    current = null;
  };

  for (const line of lines) {
    if (!line) continue;
    if (SECTION_HEADERS[line.toUpperCase()]) {
      flush();
      role = SECTION_HEADERS[line.toUpperCase()];
      continue;
    }
    const crit = line.match(/^Criterion\s+(\d+)\s*:\s*(.+)$/i);
    if (crit) {
      flush();
      if (!role) throw new Error("Criterion found before a role section header");
      current = { role, criterion_number: Number(crit[1]), criterion_name: crit[2].trim() };
      continue;
    }
    const desc = line.match(/^What a strong candidate looks like\s*:\s*(.+)$/i);
    if (desc && current) {
      current.description = desc[1].trim();
      continue;
    }
    const weight = line.match(/^Weight\s*:\s*([\d.]+)\s*%$/i);
    if (weight && current) {
      current.weight = Number(weight[1]);
      continue;
    }
    if (/^Total Weight/i.test(line)) {
      flush();
      continue;
    }
    // Continuation of a multi-line description.
    if (current?.description) current.description += " " + line;
  }
  flush();

  for (const r of ["PM", "SPM"] as Role[]) {
    const crits = out.filter((c) => c.role === r);
    if (crits.length === 0) throw new Error(`No criteria found for ${r}`);
    const total = crits.reduce((s, c) => s + c.weight, 0);
    if (Math.abs(total - 100) > 0.01) throw new Error(`${r} weights sum to ${total}, expected 100`);
  }
  return out;
}

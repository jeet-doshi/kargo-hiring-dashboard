/**
 * Loads rubric.txt into the rubric_criteria table.
 *
 *   npm run seed            -> writes supabase/seed.sql AND upserts into Supabase
 *   npm run seed -- --sql   -> only writes supabase/seed.sql
 *
 * rubric.txt is the single source of truth for criteria and weights.
 */
import { readFileSync, writeFileSync } from "fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { parseRubric } from "@/lib/rubric/parse-rubric";

config({ path: ".env.local" });

const sqlEscape = (s: string) => s.replace(/'/g, "''");

async function main() {
  const criteria = parseRubric(readFileSync("rubric.txt", "utf8"));
  for (const c of criteria) console.log(`${c.role} #${c.criterion_number} ${c.criterion_name} (${c.weight}%)`);

  const sql =
    "-- Generated from rubric.txt by scripts/seed-rubric.ts. Do not edit by hand.\n" +
    "delete from public.rubric_criteria;\n" +
    "insert into public.rubric_criteria (role, criterion_number, criterion_name, description, weight) values\n" +
    criteria
      .map(
        (c) =>
          `  ('${c.role}', ${c.criterion_number}, '${sqlEscape(c.criterion_name)}', '${sqlEscape(c.description)}', ${c.weight})`,
      )
      .join(",\n") +
    ";\n";
  writeFileSync("supabase/seed.sql", sql);
  console.log("Wrote supabase/seed.sql");

  if (process.argv.includes("--sql")) return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.log("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY not set: skipped database upsert.");
    return;
  }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { error: delErr } = await db.from("rubric_criteria").delete().gte("criterion_number", 0);
  if (delErr) throw new Error(`Failed to clear rubric_criteria: ${delErr.message}`);
  const { error } = await db.from("rubric_criteria").insert(criteria);
  if (error) throw new Error(`Failed to insert rubric_criteria: ${error.message}`);
  console.log(`Inserted ${criteria.length} criteria into Supabase.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

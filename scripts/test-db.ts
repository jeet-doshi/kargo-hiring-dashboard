/**
 * Supabase connection test:  npm run test:db
 *
 * 1. Connects with the server-side secret key and queries both tables.
 * 2. Confirms the browser-safe publishable key CANNOT read candidate data (RLS).
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function main() {
  if (!url || !secret) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local");
  console.log(`Project: ${new URL(url).host}`);

  const server = createClient(url, secret, { auth: { persistSession: false } });
  let ok = true;
  for (const table of ["rubric_criteria", "candidates"]) {
    const { count, error } = await server.from(table).select("id", { count: "exact" }).limit(1);
    if (error) {
      ok = false;
      const hint = error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message)
        ? " (table missing: run supabase/schema.sql in the SQL Editor)"
        : "";
      console.log(`✗ ${table}: ${error.message}${hint}`);
    } else {
      console.log(`✓ ${table}: reachable, ${count} row(s)`);
    }
  }

  if (publishable) {
    const anon = createClient(url, publishable, { auth: { persistSession: false } });
    const { data, error } = await anon.from("candidates").select("id").limit(1);
    if (error?.code === "PGRST205") {
      console.log("- publishable key RLS check skipped (table missing)");
    } else if (error || (data ?? []).length === 0) {
      console.log("✓ publishable key cannot read candidates (RLS working, or table empty)");
    } else {
      ok = false;
      console.log("✗ publishable key CAN read candidates: RLS is not enabled!");
    }
  }

  if (!ok) process.exit(1);
  console.log("Supabase connection OK");
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});

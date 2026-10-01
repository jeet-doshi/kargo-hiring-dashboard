import { NextResponse } from "next/server";
import { toPublicError } from "@/lib/errors";
import { db } from "@/lib/server/db";

/** Lightweight health check: confirms the server can query Supabase. Returns no data or secrets. */
export async function GET() {
  const tables: Record<string, string> = {};
  let ok = true;
  try {
    for (const table of ["rubric_criteria", "candidates"]) {
      const { count, error } = await db().from(table).select("id", { count: "exact" }).limit(1);
      if (error) {
        ok = false;
        console.error(`[health] ${table}`, error);
        tables[table] = "unavailable";
      } else {
        tables[table] = `ok (${count} rows)`;
      }
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: toPublicError(err).message }, { status: 500 });
  }
  return NextResponse.json({ ok, database: tables }, { status: ok ? 200 : 503 });
}

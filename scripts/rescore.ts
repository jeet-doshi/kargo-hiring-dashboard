/**
 * Re-score every stored candidate with the current rubric + scoring prompt,
 * then rebuild the top-5 briefs per role.
 *
 *   npm run rescore                   re-score + new drafts + briefs
 *   npm run rescore -- --emails-only  only regenerate unsent email drafts (e.g. after changing the threshold)
 *
 * Uses only the stored anonymised CV text; personal data is never re-read.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const { db, loadRubric } = await import("@/lib/server/db");
  const { rescoreCandidate, refreshTopBriefs } = await import("@/lib/server/rescore");
  const { draftEmail } = await import("@/lib/server/pipeline");
  const { getCandidate } = await import("@/lib/server/db");
  const emailsOnly = process.argv.includes("--emails-only");
  const rubric = await loadRubric();
  const { data, error } = await db().from("candidates").select("id, personal_name").order("created_at");
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const concurrency = 3;
  let done = 0;
  const failures: string[] = [];
  for (let i = 0; i < rows.length; i += concurrency) {
    await Promise.all(
      rows.slice(i, i + concurrency).map(async (row) => {
        try {
          if (emailsOnly) {
            const c = await getCandidate(row.id);
            if (!c.email_sent) await draftEmail(c);
          } else {
            await rescoreCandidate(row.id, rubric);
          }
          console.log(`✓ ${++done}/${rows.length} ${row.personal_name}`);
        } catch (e) {
          failures.push(row.personal_name ?? row.id);
          console.log(`✗ ${row.personal_name}: ${(e as Error).message}`);
        }
      }),
    );
  }
  if (!emailsOnly) for (const role of ["PM", "SPM"] as const) await refreshTopBriefs(role);
  console.log(`Done. ${failures.length ? `Failed: ${failures.join(", ")}` : "All candidates re-scored."}`);
  if (failures.length) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

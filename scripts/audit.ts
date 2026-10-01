/**
 * Production-readiness audit of stored candidate data:  npm run audit
 *
 * Checks every candidate for complete scores and per-criterion evidence,
 * brief/email rules for top and below-the-line candidates, and that no
 * personal data appears in anything sent to or produced by Gemini.
 */
import { config } from "dotenv";
import type { CriterionScore } from "@/lib/types";

config({ path: ".env.local", quiet: true });

type Check = { name: string; failures: string[] };

async function main() {
  const { db, loadRubric } = await import("@/lib/server/db");
  const { env } = await import("@/lib/server/env");
  const { quoteInCv, weightedTotal } = await import("@/lib/server/ai/score");
  const { rankForRole, shortlistRole } = await import("@/lib/ranking");
  const { fillName, NAME_PLACEHOLDER } = await import("@/lib/email-format");

  const rubric = await loadRubric();
  const threshold = env.shortlistThreshold();
  const { data, error } = await db().from("candidates").select("*");
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r) => ({ ...r, pm_score: Number(r.pm_score), spm_score: Number(r.spm_score) }));

  const checks: Record<string, Check> = {};
  const check = (key: string, name: string) => (checks[key] ??= { name, failures: [] });
  const fail = (key: string, name: string, msg: string) => check(key, name).failures.push(msg);

  const sentenceCount = (s: string) =>
    s
      .replace(/\b(e\.g|i\.e|vs|approx|etc|Pvt|Ltd|Inc|Dr|Mr|Ms)\./gi, "$1")
      .replace(/(\d)\.(\d)/g, "$1$2")
      .split(/(?<=[.!?])\s+(?=[A-Z"“])/)
      .filter((x) => x.trim()).length;
  const IMPLIED_CONTACT =
    /\b(speak(ing)? with (us|you)|spoke with|our (call|conversation|chat|meeting|discussion|interview)|meeting you|met you|talking with you|(taking|took) the time to (speak|talk|meet)|interviewing with)\b/i;

  for (const c of rows) {
    const who = `${c.personal_name} (${c.applied_role})`;
    // 3. Scores + breakdown + evidence/reason for every criterion
    const k3 = "3";
    const n3 = "Every candidate: PM + SPM score, criterion breakdown, reason/evidence per criterion";
    check(k3, n3);
    for (const role of ["PM", "SPM"] as const) {
      const total = role === "PM" ? c.pm_score : c.spm_score;
      const b = (role === "PM" ? c.pm_score_breakdown : c.spm_score_breakdown) as CriterionScore[] | null;
      if (!Number.isFinite(total)) fail(k3, n3, `${who}: missing ${role} score`);
      if (!Array.isArray(b)) { fail(k3, n3, `${who}: missing ${role} breakdown`); continue; }
      const expected = rubric[role].map((r) => r.criterion_number).join(",");
      if (b.map((x) => x.criterion_number).join(",") !== expected) fail(k3, n3, `${who}: ${role} criteria ${b.map((x) => x.criterion_number)} != rubric ${expected}`);
      for (const x of b) {
        const w = rubric[role].find((r) => r.criterion_number === x.criterion_number)?.weight;
        if (x.weight !== w) fail(k3, n3, `${who}: ${role} #${x.criterion_number} weight ${x.weight} != rubric ${w}`);
        if (!Number.isInteger(x.score) || x.score < 0 || x.score > 10) fail(k3, n3, `${who}: ${role} #${x.criterion_number} bad score ${x.score}`);
        if (!x.reason?.trim()) fail(k3, n3, `${who}: ${role} #${x.criterion_number} empty reason`);
        if (x.score > 0 && !x.evidence_quote) fail(k3, n3, `${who}: ${role} #${x.criterion_number} scored ${x.score} with no evidence quote`);
        if (x.score === 0 && !x.evidence_quote && !/^evidence not found/i.test(x.reason)) fail(k3, n3, `${who}: ${role} #${x.criterion_number} no evidence but reason doesn't say so`);
        if (x.evidence_quote && !quoteInCv(x.evidence_quote, c.anonymized_cv_content)) fail(k3, n3, `${who}: ${role} #${x.criterion_number} quote not in CV`);
      }
      if (Math.abs(weightedTotal(b) - total) > 0.05) fail(k3, n3, `${who}: ${role} total ${total} != weighted sum ${weightedTotal(b)}`);
    }

    // 5. Below the line: warm rejection, no implied contact
    const invite = shortlistRole(c, threshold);
    const body = `${c.email_subject ?? ""}\n${c.email_body ?? ""}`;
    if (!invite) {
      const k5 = "5", n5 = "Below the line: warm rejection draft, no implied interview/conversation";
      check(k5, n5);
      if (c.email_type !== "rejection") fail(k5, n5, `${who}: email_type ${c.email_type}`);
      if (!/thank/i.test(body)) fail(k5, n5, `${who}: rejection lacks a thank-you`);
      if (IMPLIED_CONTACT.test(body)) fail(k5, n5, `${who}: implies contact: "${body.match(IMPLIED_CONTACT)?.[0]}"`);
    } else {
      const k4b = "4b", n4b = "Shortlisted: interview invitation draft, no implied prior conversation";
      check(k4b, n4b);
      if (c.email_type !== "interview_invitation") fail(k4b, n4b, `${who}: email_type ${c.email_type}`);
      if (IMPLIED_CONTACT.test(body.replace(/45-minute conversation/gi, ""))) fail(k4b, n4b, `${who}: implies prior contact: "${body.match(IMPLIED_CONTACT)?.[0]}"`);
      if (invite !== c.applied_role && !new RegExp("Product Manager", "i").test(c.email_body ?? "")) fail(k4b, n4b, `${who}: cross-role invite doesn't name the role`);
    }

    // 6. PII never in AI inputs/outputs; name filled from private record
    const k6 = "6", n6 = "No PII in anything sent to / returned by Gemini; real name filled at send time";
    check(k6, n6);
    const aiText = [
      c.anonymized_cv_content,
      JSON.stringify(c.extraction_json),
      JSON.stringify(c.pm_score_breakdown),
      JSON.stringify(c.spm_score_breakdown),
      c.interview_brief ?? "",
      c.email_subject ?? "",
      c.email_body ?? "",
    ].join("\n").toLowerCase();
    const nameParts = (c.personal_name ?? "").split(/\s+/).filter((p: string) => p.length >= 4);
    for (const part of nameParts) if (aiText.includes(part.toLowerCase())) fail(k6, n6, `${who}: name part "${part}" found in AI data`);
    if (c.personal_email && aiText.includes(c.personal_email.toLowerCase())) fail(k6, n6, `${who}: email found in AI data`);
    if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(aiText)) fail(k6, n6, `${who}: an email address appears in AI data`);
    const phoneDigits = (c.personal_phone ?? "").replace(/\D/g, "");
    if (phoneDigits.length >= 10 && aiText.replace(/\D/g, "").includes(phoneDigits)) fail(k6, n6, `${who}: phone found in AI data`);
    if (!c.email_body?.includes(NAME_PLACEHOLDER)) fail(k6, n6, `${who}: draft lacks ${NAME_PLACEHOLDER}`);
    const first = (c.personal_name ?? "").split(/\s+/)[0];
    if (!fillName(c.email_body ?? "", c.personal_name).startsWith(`Hi ${first},`)) fail(k6, n6, `${who}: filled draft doesn't greet "${first}"`);
  }

  // 4. Top-5 per role: exactly 3-sentence brief; shortlisted candidates have a brief
  const k4 = "4a", n4 = "Top candidates: concise, exactly 3-sentence interview brief";
  check(k4, n4);
  for (const role of ["PM", "SPM"] as const) {
    for (const c of rankForRole(rows, role).slice(0, 5)) {
      const who = `#${c.rank} ${role} ${c.personal_name}`;
      if (!c.interview_brief) { fail(k4, n4, `${who}: no brief`); continue; }
      const n = sentenceCount(c.interview_brief);
      const words = c.interview_brief.split(/\s+/).length;
      if (n !== 3) fail(k4, n4, `${who}: brief has ${n} sentences`);
      if (words > 120) fail(k4, n4, `${who}: brief is ${words} words (not concise)`);
    }
  }
  for (const c of rows) {
    if (shortlistRole(c, threshold) && !c.interview_brief) fail(k4, n4, `${c.personal_name}: shortlisted but no brief`);
  }

  let allOk = true;
  for (const [k, ch] of Object.entries(checks).sort()) {
    const ok = ch.failures.length === 0;
    allOk &&= ok;
    console.log(`${ok ? "PASS" : "FAIL"}  [${k}] ${ch.name}`);
    for (const f of ch.failures) console.log(`        - ${f}`);
  }
  const shortlisted = rows.filter((c) => shortlistRole(c, threshold));
  console.log(`\n${rows.length} candidates · ${shortlisted.length} recommended for interview · ${rows.length - shortlisted.length} rejection drafts · ${rows.filter((c) => c.email_sent).length} sent`);
  if (!allOk) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { BriefPanel, ContactEditor, DeleteCandidate, EmailPanel } from "@/components/candidate-actions";
import { StatusBadge } from "@/components/candidate-table";
import { CriterionBar, ScoreMeter } from "@/components/score";
import { AppError, toPublicError } from "@/lib/errors";
import { decisionText } from "@/lib/decision";
import { rankForRole, recommendedRole, shortlistRole } from "@/lib/ranking";
import { db, getCandidate, normalizeCandidate } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { ROLE_LABELS, type CandidateRow, type CriterionScore, type Role } from "@/lib/types";

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function Breakdown({ role, total, items }: { role: Role; total: number | null; items: CriterionScore[] | null }) {
  if (!items) return <p className="text-sm text-slate-500">Not scored.</p>;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-semibold text-slate-900">{ROLE_LABELS[role]} rubric</h3>
        <span className="text-sm text-slate-600">
          Total <span className="font-semibold tabular-nums text-slate-900">{total?.toFixed(1)}</span> / 100
        </span>
      </div>
      <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {items.map((c) => (
          <li key={c.criterion_number} className="p-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-medium text-slate-900">
                {c.criterion_number}. {c.criterion_name}
                <span className="ml-2 text-xs font-normal text-slate-500">weight {c.weight}%</span>
              </span>
              <div className="flex items-center gap-3">
                <CriterionBar score={c.score} />
                <span className="w-16 text-right text-xs tabular-nums text-slate-500">+{c.weighted_score.toFixed(1)} pts</span>
              </div>
            </div>
            <p className={`mt-1.5 text-sm ${c.evidence_found ? "text-slate-700" : "text-slate-500 italic"}`}>{c.reason}</p>
            {c.evidence_quote && (
              <blockquote className="mt-1.5 border-l-2 border-slate-300 pl-3 text-sm text-slate-600">
                &ldquo;{c.evidence_quote}&rdquo;
                {c.quote_verified ? (
                  <span className="ml-2 text-xs text-emerald-700">✓ found in CV</span>
                ) : (
                  <span className="ml-2 text-xs text-amber-700">⚠ not found verbatim in CV: verify manually</span>
                )}
              </blockquote>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

async function loadRank(c: CandidateRow): Promise<{ rank: number; of: number }> {
  const { data } = await db()
    .from("candidates")
    .select("id, applied_role, pm_score, spm_score, created_at")
    .eq("applied_role", c.applied_role);
  const ranked = rankForRole((data ?? []).map(normalizeCandidate), c.applied_role);
  return { rank: ranked.find((r) => r.id === c.id)?.rank ?? 0, of: ranked.length };
}

export default async function CandidatePage(props: PageProps<"/candidates/[id]">) {
  await connection();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let c: CandidateRow;
  let rank: { rank: number; of: number };
  try {
    c = await getCandidate(id);
    rank = await loadRank(c);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    return (
      <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
        {toPublicError(err).message} <Link href="/" className="underline">Back to dashboard</Link>
      </div>
    );
  }

  const threshold = env.shortlistThreshold();
  const applied = c.applied_role;
  const other: Role = applied === "PM" ? "SPM" : "PM";
  const score = (r: Role) => (r === "PM" ? c.pm_score : c.spm_score);
  const breakdown = (r: Role) => (r === "PM" ? c.pm_score_breakdown : c.spm_score_breakdown);
  const rec = recommendedRole(c, threshold);
  const invite = shortlistRole(c, threshold);
  // Only list-level fields go to the client badge (no CV content).
  const listView = {
    id: c.id,
    applied_role: c.applied_role,
    original_filename: c.original_filename,
    personal_name: c.personal_name,
    personal_email: c.personal_email,
    pm_score: c.pm_score,
    spm_score: c.spm_score,
    interview_brief: c.interview_brief,
    email_type: c.email_type,
    email_sent: c.email_sent,
    created_at: c.created_at,
  };
  const ex = c.extraction_json;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/" className="text-sm text-slate-600 hover:underline">
          ← All candidates
        </Link>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{c.personal_name ?? "Unnamed candidate"}</h1>
            <p className="text-sm text-slate-600">
              Applied for <span className="font-medium">{ROLE_LABELS[applied]}</span> · Rank #{rank.rank} of {rank.of}{" "}
              {ROLE_LABELS[applied]} applicants · {c.original_filename}
            </p>
          </div>
          <StatusBadge c={listView} threshold={threshold} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: the 10-minute read */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title="Score">
            <div className="grid gap-6 sm:grid-cols-2">
              <ScoreMeter label={`${ROLE_LABELS[applied]} (applied)`} score={score(applied)} threshold={threshold} />
              <ScoreMeter label={ROLE_LABELS[other]} score={score(other)} threshold={threshold} />
            </div>
            <p className="mt-4 text-sm text-slate-600">
              Recommended role: <span className="font-medium text-slate-900">{ROLE_LABELS[rec]}</span> (
              {score(rec)?.toFixed(1)}).{" "}
              {rec === "SPM" ? "Clears the senior bar." : "Does not clear the senior bar, so assessed at PM level."}
            </p>
          </Card>

          <Card title="Recommendation vs your decision">
            <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-slate-500">System recommendation</dt>
              <dd>
                {invite ? (
                  <span className="font-medium text-emerald-700">
                    Interview for {ROLE_LABELS[invite]}
                    {invite !== applied && ` (applied for ${ROLE_LABELS[applied]}; clears the PM line but not the SPM line)`}
                  </span>
                ) : (
                  <span className="font-medium text-slate-700">Not shortlisted: below the shortlist line ({threshold})</span>
                )}
                <span className="block text-xs text-slate-500">
                  Based only on the rubric score. It is a suggestion, not a decision.
                </span>
              </dd>
              <dt className="text-slate-500">Your decision</dt>
              <dd>
                <span className={c.email_sent ? "font-medium text-indigo-700" : "font-medium text-amber-700"}>
                  {decisionText(listView, threshold)}
                </span>
                {!c.email_sent && (
                  <span className="block text-xs text-slate-500">
                    Review the draft on the right. Switch it to the other email type if you disagree, then Confirm &amp; Send.
                  </span>
                )}
              </dd>
            </dl>
          </Card>

          <Card title="Interview brief">
            <BriefPanel id={c.id} brief={c.interview_brief} isTop={rank.rank > 0 && rank.rank <= env.briefTopN()} />
          </Card>

          <Card title="Score breakdown">
            <div className="flex flex-col gap-6">
              <Breakdown role={applied} total={score(applied)} items={breakdown(applied)} />
              <details>
                <summary className="cursor-pointer text-sm font-medium text-slate-700">
                  Show {ROLE_LABELS[other]} breakdown
                </summary>
                <div className="mt-3">
                  <Breakdown role={other} total={score(other)} items={breakdown(other)} />
                </div>
              </details>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Each criterion is scored 0-10 against rubric.txt and multiplied by its weight (score × weight ÷ 10 = points).
              Scores of 0 mean the evidence was not found in the CV.
            </p>
          </Card>
        </div>

        {/* Right: contact + email */}
        <div className="flex flex-col gap-6">
          <Card title="Candidate details">
            <ContactEditor
              id={c.id}
              name={c.personal_name}
              email={c.personal_email}
              phone={c.personal_phone}
              nameSource={c.name_source}
              locked={c.email_sent}
            />
            {ex && (
              <div className="mt-4 border-t border-slate-100 pt-4 text-sm">
                <p className="font-medium text-slate-900">{ex.headline}</p>
                <p className="mt-1 text-slate-600">{ex.summary}</p>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="text-slate-500">Experience</dt>
                  <dd>{ex.total_years_experience != null ? `${ex.total_years_experience} years` : "Not stated"}</dd>
                  <dt className="text-slate-500">Current</dt>
                  <dd>{ex.current_title ?? "Not stated"}</dd>
                  <dt className="text-slate-500">Ops roles</dt>
                  <dd>{ex.logistics_operations_roles.length ? ex.logistics_operations_roles.join("; ") : "None found"}</dd>
                </dl>
                {ex.roles.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {ex.roles.map((r, i) => (
                      <li key={i} className="text-slate-700">
                        <span className="font-medium">{r.title}</span>, {r.organisation}
                        <span className="text-slate-400">
                          {" "}
                          · {r.start ?? "?"} – {r.end ?? "?"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>

          <Card title="Email draft">
            <EmailPanel
              id={c.id}
              name={c.personal_name}
              email={c.personal_email}
              subject={c.email_subject}
              body={c.email_body}
              type={c.email_type}
              sent={c.email_sent}
              sentAt={c.email_sent_at}
              from={env.emailFrom()}
            />
          </Card>

          <Card title="What the AI saw">
            <details>
              <summary className="cursor-pointer text-sm text-slate-700">Anonymised CV text sent to Gemini</summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-700">
                {c.anonymized_cv_content}
              </pre>
            </details>
          </Card>

          <DeleteCandidate id={c.id} />
        </div>
      </div>
    </div>
  );
}

"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { ScorePill } from "@/components/score";
import { decisionText } from "@/lib/decision";
import { isShortlisted, rankForRole, recommendedRole, roleScore, shortlistRole } from "@/lib/ranking";
import { ROLE_LABELS, type EmailType, type Role } from "@/lib/types";

export type ListCandidate = {
  id: string;
  applied_role: Role;
  original_filename: string;
  personal_name: string | null;
  personal_email: string | null;
  pm_score: number | null;
  spm_score: number | null;
  interview_brief: string | null;
  email_type: EmailType | null;
  email_sent: boolean;
  created_at: string;
};

/** System recommendation only: never a final outcome. */
export function RecommendationBadge({ c, threshold }: { c: ListCandidate; threshold: number }) {
  const invite = shortlistRole(c, threshold);
  return invite ? (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
      Recommended: interview{invite !== c.applied_role ? ` (${invite})` : ""}
    </span>
  ) : (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">Recommended: not shortlisted</span>
  );
}

export function StatusBadge({ c, threshold }: { c: ListCandidate; threshold: number }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <RecommendationBadge c={c} threshold={threshold} />
      <span className={`text-xs ${c.email_sent ? "font-medium text-indigo-700" : "text-slate-500"}`}>
        {decisionText(c, threshold)}
      </span>
      {!c.email_sent && !c.personal_email && <span className="text-xs font-medium text-amber-700">Email address missing</span>}
    </div>
  );
}

export function CandidateTable({ candidates, threshold }: { candidates: ListCandidate[]; threshold: number }) {
  const router = useRouter();
  const [role, setRole] = useState<Role>("PM");
  const ranked = rankForRole(candidates, role);
  const lineIndex = ranked.findIndex((c) => roleScore(c, role) < threshold);
  const aboveCount = lineIndex === -1 ? ranked.length : lineIndex;
  const crossRoleCount = ranked.filter((c) => isShortlisted(c, threshold) && roleScore(c, role) < threshold).length;
  const sentCount = ranked.filter((c) => c.email_sent).length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Ranked candidates</h2>
          <p className="text-sm text-slate-500">
            {ranked.length} applicants · {aboveCount} above the shortlist line ({threshold})
            {crossRoleCount > 0 && ` · ${crossRoleCount} invited for PM instead`} · {sentCount} emailed
          </p>
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-1" role="tablist">
          {(["PM", "SPM"] as Role[]).map((r) => {
            const n = candidates.filter((c) => c.applied_role === r).length;
            return (
              <button
                key={r}
                role="tab"
                aria-selected={role === r}
                onClick={() => setRole(r)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  role === r ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {ROLE_LABELS[r]} <span className="text-slate-400">({n})</span>
              </button>
            );
          })}
        </div>
      </div>

      {ranked.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">
          No {ROLE_LABELS[role]} candidates yet. Upload a CV above to get started.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Rank</th>
                <th className="px-4 py-2.5 font-medium">Candidate</th>
                <th className="px-4 py-2.5 font-medium">Applied role</th>
                <th className="px-4 py-2.5 font-medium">PM score</th>
                <th className="px-4 py-2.5 font-medium">SPM score</th>
                <th className="px-4 py-2.5 font-medium">Recommended role</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ranked.map((c, i) => {
                const rec = recommendedRole(c, threshold);
                return (
                  <Fragment key={c.id}>
                    {i === lineIndex && (
                      <tr aria-hidden>
                        <td colSpan={7} className="bg-slate-50 px-4 py-1.5">
                          <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                            <span className="h-px flex-1 bg-slate-400" />
                            Shortlist line: {threshold}. Below the line is a recommendation only
                            {role === "SPM" ? " (a PM interview if the PM score clears it)" : ""}. Nothing is sent without you.
                            <span className="h-px flex-1 bg-slate-400" />
                          </div>
                        </td>
                      </tr>
                    )}
                    <tr
                      onClick={() => router.push(`/candidates/${c.id}`)}
                      className="cursor-pointer hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 font-semibold tabular-nums text-slate-700">#{c.rank}</td>
                      <td className="px-4 py-3">
                        <a href={`/candidates/${c.id}`} className="font-medium text-slate-900 hover:underline" onClick={(e) => e.stopPropagation()}>
                          {c.personal_name ?? "Unnamed candidate"}
                        </a>
                        {c.interview_brief && c.rank <= 5 && (
                          <span className="ml-2 whitespace-nowrap rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700">
                            Top 5 · brief
                          </span>
                        )}
                        <div className="truncate text-xs text-slate-400">{c.original_filename}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{ROLE_LABELS[c.applied_role]}</td>
                      <td className="px-4 py-3">
                        <ScorePill score={c.pm_score} threshold={threshold} />
                      </td>
                      <td className="px-4 py-3">
                        <ScorePill score={c.spm_score} threshold={threshold} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-700">{rec}</span>
                          <ScorePill score={roleScore(c, rec)} threshold={threshold} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge c={c} threshold={threshold} />
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

import { connection } from "next/server";
import { CandidateTable, type ListCandidate } from "@/components/candidate-table";
import { UploadPanel } from "@/components/upload-panel";
import { toPublicError } from "@/lib/errors";
import { db, dbError, LIST_COLUMNS, normalizeCandidate } from "@/lib/server/db";
import { env } from "@/lib/server/env";

async function loadCandidates(): Promise<{ candidates: ListCandidate[]; error: string | null }> {
  try {
    const { data, error } = await db().from("candidates").select(LIST_COLUMNS);
    if (error) throw dbError("loading candidates", error);
    return { candidates: (data ?? []).map((r) => normalizeCandidate(r) as unknown as ListCandidate), error: null };
  } catch (err) {
    return { candidates: [], error: toPublicError(err).message };
  }
}

export default async function Home() {
  await connection(); // always render with fresh data
  const { candidates, error } = await loadCandidates();
  const threshold = env.shortlistThreshold();

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}
      <UploadPanel />
      <CandidateTable candidates={candidates} threshold={threshold} />
      <p className="text-xs text-slate-500">
        Scores are 0-100: each rubric criterion is scored 0-10 and weighted by rubric.txt. Candidates are ranked within
        the role they applied for. The top 5 per role get a 3-sentence interview brief. Emails are drafts until you
        press Confirm &amp; Send.
      </p>
    </div>
  );
}

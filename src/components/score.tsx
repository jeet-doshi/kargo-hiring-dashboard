import { scoreBand } from "@/lib/ranking";

const BAND_STYLES = {
  strong: { pill: "bg-emerald-50 text-emerald-800 ring-emerald-600/20", bar: "bg-emerald-500", label: "Above line" },
  borderline: { pill: "bg-amber-50 text-amber-800 ring-amber-600/20", bar: "bg-amber-500", label: "Near line" },
  weak: { pill: "bg-slate-100 text-slate-700 ring-slate-500/20", bar: "bg-slate-400", label: "Below line" },
};

/** Compact score pill for tables: "72.5" coloured by band. */
export function ScorePill({ score, threshold }: { score: number | null; threshold: number }) {
  if (score == null) return <span className="text-slate-400">–</span>;
  const s = BAND_STYLES[scoreBand(score, threshold)];
  return (
    <span className={`inline-flex min-w-12 justify-center rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums ring-1 ring-inset ${s.pill}`}>
      {score.toFixed(1)}
    </span>
  );
}

/** Large score with a 0-100 bar and the shortlist line marked. */
export function ScoreMeter({ label, score, threshold }: { label: string; score: number | null; threshold: number }) {
  const value = score ?? 0;
  const band = scoreBand(value, threshold);
  const s = BAND_STYLES[band];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-600">{label}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.pill}`}>{s.label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-3xl font-semibold tabular-nums text-slate-900">{score == null ? "–" : value.toFixed(1)}</span>
        <span className="text-sm text-slate-500">/ 100</span>
      </div>
      <div className="relative mt-2 h-2.5 rounded-full bg-slate-200" aria-hidden>
        <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${Math.min(100, value)}%` }} />
        <div className="absolute -top-1 h-4.5 w-0.5 bg-slate-800" style={{ left: `${threshold}%` }} title={`Shortlist line: ${threshold}`} />
      </div>
      <div className="mt-1 text-xs text-slate-500">Shortlist line at {threshold}</div>
    </div>
  );
}

/** 10-segment bar for a single 0-10 criterion score. */
export function CriterionBar({ score }: { score: number }) {
  const color = score >= 7 ? "bg-emerald-500" : score >= 4 ? "bg-amber-500" : score > 0 ? "bg-rose-400" : "bg-slate-200";
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5" aria-label={`${score} out of 10`}>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={`h-3 w-2.5 rounded-sm ${i < score ? color : "bg-slate-200"}`} />
        ))}
      </div>
      <span className="text-sm font-semibold tabular-nums text-slate-800">{score}/10</span>
    </div>
  );
}

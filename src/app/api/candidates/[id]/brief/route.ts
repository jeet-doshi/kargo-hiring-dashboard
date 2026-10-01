import { getCandidate } from "@/lib/server/db";
import { respond } from "@/lib/server/http";
import { writeBrief } from "@/lib/server/pipeline";

export const maxDuration = 60;

/** Generate (or regenerate) the interview brief for the candidate's applied role. */
export async function POST(_request: Request, ctx: RouteContext<"/api/candidates/[id]/brief">) {
  return respond(async () => {
    const { id } = await ctx.params;
    const c = await getCandidate(id);
    return { brief: await writeBrief(c, c.applied_role) };
  });
}

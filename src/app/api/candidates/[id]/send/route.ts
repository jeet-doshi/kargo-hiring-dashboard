import { respond } from "@/lib/server/http";
import { sendCandidateEmail } from "@/lib/server/send";

/** The ONLY path that sends email: triggered by the founder's "Confirm & Send" click. */
export async function POST(_request: Request, ctx: RouteContext<"/api/candidates/[id]/send">) {
  return respond(async () => {
    const { id } = await ctx.params;
    return sendCandidateEmail(id);
  });
}

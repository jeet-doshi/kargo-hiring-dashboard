import { AppError } from "@/lib/errors";
import { getCandidate } from "@/lib/server/db";
import { respond } from "@/lib/server/http";
import { draftEmail } from "@/lib/server/pipeline";
import type { EmailType } from "@/lib/types";

export const maxDuration = 60;

/**
 * Regenerate the email draft (never sends). Optional body { type } lets the
 * founder override the system recommendation, e.g. invite a below-the-line candidate.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/candidates/[id]/email">) {
  return respond(async () => {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const type = body?.type as EmailType | undefined;
    if (type !== undefined && type !== "interview_invitation" && type !== "rejection") {
      throw new AppError("BAD_INPUT", "Unknown email type.", 400);
    }
    await draftEmail(await getCandidate(id), type);
    return { ok: true };
  });
}

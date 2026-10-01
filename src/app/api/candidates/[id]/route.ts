import { z } from "zod";
import { AppError } from "@/lib/errors";
import { db, dbError, getCandidate } from "@/lib/server/db";
import { respond } from "@/lib/server/http";

const PatchSchema = z
  .object({
    personal_name: z.string().trim().min(1).max(120),
    personal_email: z.string().trim().email("That doesn't look like a valid email address."),
    email_subject: z.string().trim().min(1, "Subject can't be empty.").max(200),
    email_body: z.string().trim().min(1, "Email body can't be empty.").max(10000),
  })
  .partial();

/** Founder edits: correct private details or edit the email draft before sending. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/candidates/[id]">) {
  return respond(async () => {
    const { id } = await ctx.params;
    const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError("BAD_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    const current = await getCandidate(id);
    const patch: Record<string, unknown> = { ...parsed.data };
    if ((patch.email_subject !== undefined || patch.email_body !== undefined) && current.email_sent) {
      throw new AppError("ALREADY_SENT", "This email has already been sent and can no longer be edited.", 409);
    }
    if (patch.personal_name !== undefined) patch.name_source = "manual";
    if (patch.personal_email !== undefined) patch.personal_email = String(patch.personal_email).toLowerCase();
    const { error } = await db().from("candidates").update(patch).eq("id", id);
    if (error) throw dbError("saving your changes", error);
    return { ok: true };
  });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/candidates/[id]">) {
  return respond(async () => {
    const { id } = await ctx.params;
    const { error } = await db().from("candidates").delete().eq("id", id);
    if (error) throw dbError("deleting the candidate", error);
    return { ok: true };
  });
}

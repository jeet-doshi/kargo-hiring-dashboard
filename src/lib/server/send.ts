import "server-only";
import { createHash } from "crypto";
import { Resend } from "resend";
import { AppError } from "@/lib/errors";
import { fillName, NAME_PLACEHOLDER } from "@/lib/email-format";
import { db, dbError, getCandidate } from "./db";
import { env } from "./env";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111">${esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
}

/**
 * Sends the reviewed draft. Only ever called from the founder's explicit
 * "Confirm & Send" action. The real name and email are read from the private
 * record at this point and merged into the draft.
 */
export async function sendCandidateEmail(id: string): Promise<{ sentAt: string }> {
  const c = await getCandidate(id);
  if (c.email_sent) throw new AppError("ALREADY_SENT", "This email has already been sent.", 409);
  if (!c.personal_email || !EMAIL_RE.test(c.personal_email)) {
    throw new AppError("MISSING_EMAIL", "This candidate has no valid email address. Add one before sending.", 400);
  }
  if (!c.email_subject?.trim() || !c.email_body?.trim()) {
    throw new AppError("NO_DRAFT", "There is no email draft to send. Generate a draft first.", 400);
  }

  const subject = fillName(c.email_subject, c.personal_name);
  const body = fillName(c.email_body, c.personal_name);
  if (body.includes(NAME_PLACEHOLDER) || subject.includes(NAME_PLACEHOLDER)) {
    throw new AppError("BAD_DRAFT", "The draft still contains an unfilled placeholder.", 400);
  }

  const resend = new Resend(env.resendApiKey());
  // Identical retries (double click, network retry) dedupe; an edited draft gets a new key.
  const payloadHash = createHash("sha256").update([c.personal_email, subject, body].join("\n")).digest("hex");
  const idempotencyKey = `kargo-${c.id}-${payloadHash.slice(0, 16)}`;
  let messageId: string | undefined;
  try {
    const { data, error } = await resend.emails.send(
      { from: env.emailFrom(), to: [c.personal_email], subject, text: body, html: toHtml(body) },
      { idempotencyKey },
    );
    if (error) {
      console.error("[resend] send failed", error);
      throw new AppError(
        "SEND_FAILED",
        `The email could not be sent: ${(error.message ?? "the email provider rejected the request").replace(/[.\s]+$/, "")}.`,
        502,
      );
    }
    messageId = data?.id;
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error("[resend] send threw", err);
    throw new AppError("SEND_FAILED", "The email service could not be reached. Nothing was sent; please try again.", 502);
  }

  const sentAt = new Date().toISOString();
  const { error } = await db()
    .from("candidates")
    .update({ email_sent: true, email_sent_at: sentAt, resend_message_id: messageId ?? null })
    .eq("id", c.id);
  if (error) {
    throw dbError("recording the sent status (the email WAS sent; do not resend)", error);
  }
  return { sentAt };
}

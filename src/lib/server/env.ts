import "server-only";
import { AppError } from "@/lib/errors";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Names the missing variable (never its value) so the founder/admin can fix the deployment.
    throw new AppError("CONFIG_MISSING", `Server configuration is incomplete: ${name} is not set.`, 500);
  }
  return value;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseServiceKey: () => required("SUPABASE_SECRET_KEY"),
  geminiApiKey: () => required("GEMINI_API_KEY"),
  geminiModel: () => process.env.GEMINI_MODEL || "gemini-3.8-flash",
  resendApiKey: () => required("RESEND_API_KEY"),
  emailFrom: () => process.env.EMAIL_FROM || "Kargo Hiring <onboarding@resend.dev>",
  founderName: () => process.env.FOUNDER_NAME || "The Kargo Founding Team",
  /** Score (0-100) on the applied role at or above which a candidate is shortlisted. */
  shortlistThreshold: () => {
    const n = Number(process.env.SHORTLIST_THRESHOLD ?? 40);
    return Number.isFinite(n) ? n : 40;
  },
  briefTopN: () => 5,
};

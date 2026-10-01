export type Role = "PM" | "SPM";

export const ROLE_LABELS: Record<Role, string> = {
  PM: "Product Manager",
  SPM: "Senior Product Manager",
};

export type EmailType = "interview_invitation" | "rejection";

export type RubricCriterion = {
  id: string;
  role: Role;
  criterion_number: number;
  criterion_name: string;
  description: string;
  weight: number;
};

/** One scored rubric criterion, as stored in pm_/spm_score_breakdown. */
export type CriterionScore = {
  criterion_number: number;
  criterion_name: string;
  weight: number; // percent
  score: number; // 0-10
  weighted_score: number; // score * weight / 10, contributes to the 0-100 total
  reason: string;
  evidence_quote: string | null;
  evidence_found: boolean;
  quote_verified: boolean; // evidence_quote was found verbatim in the anonymised CV
};

export type CandidateRow = {
  id: string;
  applied_role: Role;
  original_filename: string;
  personal_name: string | null;
  personal_email: string | null;
  personal_phone: string | null;
  name_source: "cv_text" | "filename" | "manual" | null;
  anonymized_cv_content: string;
  extraction_json: CandidateExtraction | null;
  pm_score: number | null;
  spm_score: number | null;
  pm_score_breakdown: CriterionScore[] | null;
  spm_score_breakdown: CriterionScore[] | null;
  interview_brief: string | null;
  interview_brief_role: Role | null;
  email_subject: string | null;
  email_body: string | null;
  email_type: EmailType | null;
  email_sent: boolean;
  email_sent_at: string | null;
  resend_message_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CandidateExtraction = {
  headline: string;
  total_years_experience: number | null;
  current_title: string | null;
  summary: string;
  roles: {
    title: string;
    organisation: string;
    organisation_type: string;
    start: string | null;
    end: string | null;
    highlights: string[];
  }[];
  logistics_operations_roles: string[];
  education: string[];
  skills: string[];
};

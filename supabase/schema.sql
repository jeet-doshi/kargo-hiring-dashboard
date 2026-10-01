-- Kargo Hiring Dashboard schema.
-- Run once in the Supabase SQL editor (or `psql`), then run `npm run seed`
-- (or paste supabase/seed.sql) to load the rubric from rubric.txt.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Rubric (source of truth: rubric.txt, loaded by scripts/seed-rubric.ts)
-- ---------------------------------------------------------------------------
create table if not exists public.rubric_criteria (
  id               uuid primary key default gen_random_uuid(),
  role             text not null check (role in ('PM', 'SPM')),
  criterion_number int  not null check (criterion_number > 0),
  criterion_name   text not null,
  description      text not null,
  weight           numeric(5,2) not null check (weight > 0 and weight <= 100), -- percent
  created_at       timestamptz not null default now(),
  unique (role, criterion_number)
);

-- ---------------------------------------------------------------------------
-- Candidates
-- personal_* columns hold the only copy of PII. They are never sent to Gemini;
-- anonymized_cv_content is what the AI pipeline sees.
-- ---------------------------------------------------------------------------
create table if not exists public.candidates (
  id                    uuid primary key default gen_random_uuid(),
  applied_role          text not null check (applied_role in ('PM', 'SPM')),
  original_filename     text not null,
  file_hash             text not null unique,   -- sha256 of uploaded bytes (duplicate detection)
  content_hash          text not null unique,   -- sha256 of normalised text (same CV, different file)

  -- Private / personal information (stored separately from AI-facing content)
  personal_name         text,
  personal_email        text,
  personal_phone        text,
  name_source           text check (name_source in ('cv_text', 'filename', 'manual')),

  -- AI-facing content and results
  anonymized_cv_content text not null,
  extraction_json       jsonb,
  pm_score              numeric(5,1) check (pm_score between 0 and 100),
  spm_score             numeric(5,1) check (spm_score between 0 and 100),
  pm_score_breakdown    jsonb,
  spm_score_breakdown   jsonb,
  interview_brief       text,
  interview_brief_role  text check (interview_brief_role in ('PM', 'SPM')),

  -- Email draft + sending
  email_subject         text,
  email_body            text,
  email_type            text check (email_type in ('interview_invitation', 'rejection')),
  email_sent            boolean not null default false,
  email_sent_at         timestamptz,
  resend_message_id     text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists candidates_pm_score_idx  on public.candidates (pm_score desc nulls last);
create index if not exists candidates_spm_score_idx on public.candidates (spm_score desc nulls last);
create index if not exists candidates_role_idx      on public.candidates (applied_role);

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists candidates_set_updated_at on public.candidates;
create trigger candidates_set_updated_at
  before update on public.candidates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: enabled with NO policies, so the public anon key can
-- read nothing. The app only talks to the database from the server using the
-- service-role key (which bypasses RLS).
-- ---------------------------------------------------------------------------
alter table public.candidates      enable row level security;
alter table public.rubric_criteria enable row level security;

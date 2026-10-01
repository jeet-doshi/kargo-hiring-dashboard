# Kargo Hiring Dashboard

An internal tool for Kargo's founder to screen **Product Manager (PM)** and **Senior Product Manager (SPM)** applicants against the rubric in [`rubric.txt`](rubric.txt).

The founder uploads a CV and picks the role. The app then:

1. Pulls out the candidate's name, email and phone **locally** and stores them separately.
2. Anonymises the CV.
3. Has Gemini extract a structured profile and score the CV on **both** rubrics. Every criterion gets a 0–10 score, a one-line reason and a verbatim evidence quote.
4. Ranks candidates within the role they applied for.
5. Writes a 3-sentence interview brief for the top 5 per role.
6. Drafts a personalised email: an interview invitation above the shortlist line, a warm rejection below it.

**Score, recommendation and decision are kept separate.** The rubric produces a *score*. The shortlist line turns it into a *system recommendation* (interview or not shortlisted), which is only a suggestion. The *founder's decision* stays "Awaiting your decision" until the founder sends an email. The founder can switch any draft between invitation and rejection to override the recommendation.

**Nothing is ever sent automatically.** The founder reviews and edits the draft, then presses **Confirm & Send**, which sends it through Resend and marks the candidate as sent.

---

## Architecture

```
Browser (Next.js client components)
  │  upload (multipart), edits, Confirm & Send
  ▼
Next.js route handlers on Vercel (server-only; all secrets live here)
  ├─ /api/upload                   → pipeline: parse → PII split → anonymise → Gemini → Supabase
  ├─ /api/candidates/[id]          PATCH (edit contact / draft), DELETE
  ├─ /api/candidates/[id]/brief    POST (re)generate interview brief
  ├─ /api/candidates/[id]/email    POST regenerate email draft (never sends)
  └─ /api/candidates/[id]/send     POST the ONLY path that sends email (Resend)
        │                      │                     │
        ▼                      ▼                     ▼
  Supabase Postgres     Gemini Flash (@google/genai)   Resend
  (service-role key,    anonymised text + rubric only
   RLS on, no policies)
```

| Path | Purpose |
| --- | --- |
| `src/lib/cv/parse.ts` | PDF (unpdf), DOCX (mammoth), TXT → text; rejects empty, unreadable or unsupported files |
| `src/lib/cv/pii.ts` | Rule-based name/email/phone extraction, anonymisation, and a PII guard that runs before any AI call |
| `src/lib/server/gemini.ts` | Structured-JSON Gemini wrapper: zod validation, retries with the error fed back, founder-safe errors |
| `src/lib/server/ai/extract.ts` | AI function 1: CV extraction (structured profile) |
| `src/lib/server/ai/score.ts` | AI function 2: rubric scoring, plus quote verification and the weighted total |
| `src/lib/server/ai/brief.ts` | AI function 3: 3-sentence interview brief |
| `src/lib/server/ai/email.ts` | AI function 4: invitation or rejection draft with a `{{CANDIDATE_NAME}}` placeholder |
| `src/lib/server/pipeline.ts` | Orchestrates the upload; duplicate detection; top-5 brief refresh |
| `src/lib/server/send.ts` | Resend integration (idempotent per candidate) |
| `src/lib/ranking.ts` | Ranking, shortlist line, recommended role |
| `supabase/schema.sql` | Tables, constraints, `updated_at` trigger, RLS |
| `scripts/seed-rubric.ts` | Parses `rubric.txt` → `rubric_criteria` (and writes `supabase/seed.sql`) |

### Database

- **`rubric_criteria`**: `id, role ('PM'|'SPM'), criterion_number, criterion_name, description, weight (%), created_at`. Loaded from `rubric.txt`. Scoring always reads the rubric from this table; it is not hard-coded anywhere in the app.
- **`candidates`**: the applied role and filename; `file_hash` and `content_hash` for duplicate detection; the private `personal_name`, `personal_email` and `personal_phone`; `anonymized_cv_content`; `extraction_json`; `pm_score`, `spm_score` and their `*_score_breakdown` (JSONB, one entry per criterion with score, weight, weighted points, reason, quote and verification flag); `interview_brief`; `email_subject`, `email_body`, `email_type`, `email_sent`, `email_sent_at`, `resend_message_id`; `created_at` and `updated_at`.

---

## Scoring

- Each criterion is scored **0–10** on one fixed scale shared by every candidate (defined in `score.ts`):
  - 0: no evidence.
  - 1–3: related content, but most of the requirements are missing.
  - 4–6: some required elements present, at least one missing.
  - 7–8: every required element present.
  - 9–10: exceeds the bar, with several strong instances.
- **Weighted criterion score** = score × weight ÷ 10. With weights in percent, the **role total is already on a 0–100 scale**: PM score = Σ PM criteria, SPM score = Σ SPM criteria.
- **Consistency:** the scoring prompt uses a fixed seed, and evidence must be verbatim. Re-running the same CV three times gave identical totals (±0.5).
  - The model is told to read each bar literally: evidence in the form of the rubric's own examples satisfies a requirement, and nothing the rubric excludes earns credit.
- Weights come from `rubric.txt`. The model is never shown the weights, so it can't skew individual scores toward a target total. The weighting is computed in code.
- **Evidence discipline:**
  - Every scored criterion must include a quote copied verbatim from the anonymised CV. The server checks the quote against the CV text. If it isn't found, the model is asked to retry. If it still isn't found, the score is kept but flagged "⚠ not found verbatim, verify manually" in the UI.
  - If there's no evidence, the score is forced to 0 and the reason starts with "Evidence not found:".
- **Ranking:** candidates are ranked within the role they applied for, by that role's score.
- **Shortlist line:** `SHORTLIST_THRESHOLD`, default **40**. Candidates at or above the line on their applied role's rubric get an interview invitation draft. An **SPM applicant who misses the SPM line but clears it on the PM rubric** gets an invitation to interview for the **PM** role instead, and the email says so. Everyone else gets a warm rejection draft.
  - 40 was chosen from the real score spread of the 32 CVs scored so far. PM scores cluster at 66.5, then 41–50, with the next highest at 34.5 and the rest at 22 or below. Roughly, 40 means "meets the bar on the heaviest criterion (shipment-level ops) and partially on others".
  - No SPM applicant cleared the SPM rubric (max 30.5). The SPM bar needs 3+ external party types, two or more voluntary adoptions, and team-wide standards after the candidate's own failures.
  - After changing the threshold, run `npm run rescore -- --emails-only` to rebuild unsent drafts.
- **Recommended role:** SPM if the SPM score clears the line, otherwise PM.
- **Briefs:** generated automatically for the top 5 applicants per role (refreshed after each upload). Any candidate can also have one generated on demand.

---

## Privacy approach

1. **Local PII extraction.** Name, email and phone are found with deterministic rules in `pii.ts`, never by the AI.
   - Email and phone are found with regexes.
   - The name comes from the CV header. If the header is unreadable or doesn't match the filename, it comes from the filename instead (e.g. `pm_01_priya_krishnan.pdf`).
   - The founder can correct the name or email on the candidate page.
2. **Separate storage.** PII sits in the `personal_*` columns. Everything the AI sees or produces lives in separate columns built from the anonymised text.
3. **Anonymisation.** Emails, phone numbers, personal URLs (LinkedIn, GitHub, portfolio) and every part of the candidate's name are replaced with `[EMAIL]`, `[PHONE]`, `[LINK]` and `[CANDIDATE]`.
4. **PII guard.** `assertNoPii` runs on the anonymised text before any Gemini call. If a known name, email or phone is still present, the upload is stopped and nothing is sent.
5. **Emails.** Gemini writes drafts with a `{{CANDIDATE_NAME}}` placeholder. The real name and email are read from the private record and filled in on the server, for the preview and at send time.
6. **Secrets.** Every Gemini, Resend and Supabase call runs on the server. There are no `NEXT_PUBLIC_` secrets. The database uses Row Level Security with no policies, so the public anon key can read nothing; the server uses the service-role key. Error responses carry founder-friendly messages only, never stack traces or provider error bodies.
7. **Repo hygiene.** `.env*` files and the candidate CV folders (`applications/`, `hires/`, `roles/`) are git-ignored.
8. **Transparency.** The candidate page has a "What the AI saw" panel showing the exact anonymised text sent to Gemini.

`npm run test:pii` runs parsing and anonymisation over every CV in `./applications` and fails if any detected name, email or phone survives.

---

## Error handling

| Situation | Behaviour |
| --- | --- |
| Invalid or unsupported file | Magic-byte check. "Unsupported or invalid file. Please upload a PDF, DOCX or TXT CV." |
| Empty CV, or a scanned image with no text | "This CV has little or no readable text…" |
| Duplicate upload | SHA-256 of the file **and** of the normalised text, plus unique constraints. "This CV has already been uploaded (Name, Role)." |
| Gemini failure | Retried with backoff, then "The AI service is unavailable right now…". Nothing partial is saved. |
| Malformed Gemini response | Zod validation and semantic checks (every criterion present, quotes verified, exactly 3 sentences, placeholder present), retried with the error fed back, then a clear message |
| Database failure | "Database error while <action>. Please try again." Details are logged on the server only. |
| Missing email | The upload still succeeds with a warning. Status shows "Email missing", Send is disabled, and the founder can add the email on the candidate page. |
| Resend failure | The provider's message is shown and the candidate is **not** marked as sent. Sends use an idempotency key, so retries can't double-send. |
| Email draft or brief fails after scoring | Scores are kept, with a warning. Use "Regenerate draft" or "Generate brief" on the candidate page. |

---

## Environment variables

Copy `.env.example` to `.env.local` (git-ignored):

| Variable | Required | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL (not secret) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | no | Publishable key. Reserved for future client-side use; the app currently does all DB access server-side, and RLS blocks this key from reading any table |
| `SUPABASE_SECRET_KEY` | yes | Secret/service-role key. **Server only**, never `NEXT_PUBLIC_` |
| `GEMINI_API_KEY` | yes | Google AI Studio key |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.8-flash` (current stable Flash) |
| `RESEND_API_KEY` | yes | Resend API key |
| `EMAIL_FROM` | no | e.g. `Kargo Hiring <hiring@yourdomain.com>`. Must be a domain verified in Resend. The default `onboarding@resend.dev` only delivers to your own Resend account address. |
| `FOUNDER_NAME` | no | Email sign-off |
| `SHORTLIST_THRESHOLD` | no | 0–100, default 60 |

---

## Run locally

Requires Node 20.9+.

```bash
npm install
cp .env.example .env.local      # then fill in the values
```

1. In the Supabase dashboard, open **SQL Editor** and run [`supabase/schema.sql`](supabase/schema.sql).
2. Load the rubric. Either run:
   ```bash
   npm run seed
   ```
   or paste the generated [`supabase/seed.sql`](supabase/seed.sql) into the SQL Editor.
3. Start the app and open http://localhost:3000:
   ```bash
   npm run dev
   ```

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run test:db` | Supabase connection test. Checks both tables with the secret key, and that the publishable key can't read data (RLS). |
| `npm run test:pii` | Parses and anonymises every CV in `./applications`; fails if any name, email or phone leaks |
| `npm run seed` | Reloads `rubric_criteria` from `rubric.txt` |
| `npm run rescore` | Re-scores every candidate from the stored anonymised text, rebuilds unsent drafts and top-5 briefs. Use it after changing the rubric or scoring prompt, so everyone is judged by identical rules. |
| `npm run audit` | Checks stored data for every candidate: complete scores, criterion breakdowns with verified evidence, 3-sentence briefs for the top 5, the right draft type, no implied prior contact, and no PII in anything sent to or produced by Gemini |
| `npm run rescore -- --emails-only` | Only rebuilds unsent email drafts (e.g. after changing the threshold) |

`GET /api/health` reports whether the deployed app can query both tables. It returns no data or secrets.

## Deploy to Vercel

1. Push the repo to GitHub. Secrets and CVs are git-ignored.
2. In Vercel, **Add New → Project**, then import the repo. The Next.js preset is detected automatically.
3. Under **Settings → Environment Variables**, add the variables above for Production (and Preview if you want).
4. Deploy. The upload route sets `maxDuration = 300` s, which fits within Vercel's default Fluid Compute limits. Each CV takes about 30–60 s, and the dashboard uploads several CVs one request at a time.
5. Optional: verify a sending domain in Resend and set `EMAIL_FROM` to use it.

---

## AI pipeline, step by step

1. **Parse** the upload into text (`parse.ts`).
2. **Hash and dedupe.** Compute file and content hashes and reject duplicates.
3. **Split PII**, anonymise, and run the PII guard (`pii.ts`).
4. **Load the rubric** for both roles from `rubric_criteria`.
5. **Run three Gemini calls in parallel**, each with a JSON schema generated from zod:
   - `extractCandidate`: headline, years, roles, logistics-operations roles, education, skills.
   - `scoreCandidate(PM)` and `scoreCandidate(SPM)`: one entry per criterion with `score`, `evidence_found`, `evidence_quote` and `reason`. Validated, then quotes are verified and weighted totals computed.
6. **Save** the candidate row.
7. **Draft the email** (`generateEmail`). The type is set by the shortlist line, and the body uses the `{{CANDIDATE_NAME}}` placeholder.
8. **Refresh briefs** (`generateBrief`) for any of the top 5 in the applied role that lack one. Each brief has exactly 3 sentences: why they stand out, the strongest evidence, what to probe.
9. The founder reviews and edits, then presses **Confirm & Send**. `send.ts` fills in the name, sends through Resend and marks the candidate as sent.

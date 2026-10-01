/**
 * Local (non-AI) extraction and redaction of personal information.
 *
 * Personal details are detected with deterministic rules so that the raw CV
 * never has to be sent to an AI model to find them. Everything sent to Gemini
 * passes through `anonymize` and then `assertNoPii`.
 */

export type PersonalInfo = {
  name: string | null;
  email: string | null;
  phone: string | null;
  nameSource: "cv_text" | "filename" | null;
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Candidate phone-ish runs; validated by digit count below.
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const URL_RE =
  /\b(?:https?:\/\/|www\.)\S+|\b(?:linkedin\.com|github\.com|behance\.net|medium\.com|flowcv\.me|vercel\.app)\/?\S*/gi;

// Words that look like names in a CV header but are not names.
const NOT_NAME_WORDS = new Set(
  [
    "resume", "curriculum", "vitae", "cv", "profile", "product", "manager", "senior", "associate",
    "summary", "professional", "experience", "education", "skills", "contact", "email", "phone",
    "mobile", "linkedin", "portfolio", "india", "mumbai", "pune", "bangalore", "bengaluru", "delhi",
    "chennai", "kochi", "ahmedabad", "gurugram", "gurgaon", "hyderabad", "kolkata", "ncr", "head",
    "lead", "strategy", "operations", "growth", "work", "objective", "final", "updated", "pm", "spm",
    "the", "and", "of",
  ],
);

const FILENAME_NOISE = new Set(["cv", "resume", "pm", "spm", "final", "updated", "new", "copy", "v1", "v2"]);

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function looksLikeName(s: string): boolean {
  const words = s.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every(
    (w) => /^[A-Z][a-zA-Z'’.-]{0,24}$/.test(w) && !NOT_NAME_WORDS.has(w.toLowerCase().replace(/\.$/, "")),
  );
}

/** "pm_01_priya_krishnan.pdf" -> "Priya Krishnan" */
export function nameFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, "");
  const tokens = base
    .split(/[\s_\-.]+/)
    .filter((t) => t && !/\d/.test(t) && !FILENAME_NOISE.has(t.toLowerCase()));
  if (tokens.length < 2 || tokens.length > 4) return null;
  if (!tokens.every((t) => /^[A-Za-z'’]{2,}$/.test(t))) return null;
  const name = titleCase(tokens.join(" "));
  return looksLikeName(name) ? name : null;
}

function nameFromText(text: string): string | null {
  const lines = text.split("\n").slice(0, 3);
  for (const line of lines) {
    // Header lines often look like "Jane Doe jane@x.co | +91 ..."; take the part before contact info.
    const head = line.replace(EMAIL_RE, "|").split(/[|·•,@•]|\+?\d|https?:|linkedin/i)[0].trim();
    const candidate = head.replace(/\S+@\S+$/, "").trim();
    if (looksLikeName(candidate)) return candidate === candidate.toUpperCase() ? titleCase(candidate) : candidate;
  }
  return null;
}

function findPhone(text: string): string | null {
  for (const m of text.matchAll(PHONE_RE)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) return m[0].trim();
  }
  return null;
}

export function extractPersonalInfo(text: string, filename: string): PersonalInfo {
  const emails = text.match(EMAIL_RE) ?? [];
  const email = emails.find((e) => !/noreply|example\.com/i.test(e))?.toLowerCase() ?? null;
  const phone = findPhone(text);

  const fromText = nameFromText(text);
  const fromFile = nameFromFilename(filename);
  const agrees =
    fromText && fromFile && fromText.toLowerCase().split(" ").some((w) => fromFile.toLowerCase().split(" ").includes(w));
  let name: string | null = null;
  let nameSource: PersonalInfo["nameSource"] = null;
  // The CV header wins only when it is consistent with the filename (or there is
  // no usable filename); otherwise a header like "Core Competencies" could be
  // mistaken for a name. The founder can correct the name in the UI either way.
  if (fromText && (agrees || !fromFile)) {
    name = fromText;
    nameSource = "cv_text";
  } else if (fromFile) {
    name = fromFile;
    nameSource = "filename";
  }
  return { name, email, phone, nameSource };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Name parts worth redacting (the full name plus each part of 3+ letters). */
function nameTerms(names: (string | null | undefined)[]): string[] {
  const terms = new Set<string>();
  for (const n of names) {
    if (!n) continue;
    terms.add(n.trim());
    for (const part of n.split(/\s+/)) if (part.length >= 3) terms.add(part);
  }
  // Longest first so the full name is replaced before its parts.
  return [...terms].sort((a, b) => b.length - a.length);
}

/**
 * Remove name, email, phone and personal URLs. `extraNames` lets us redact the
 * filename-derived name as well, in case it appears in the body.
 */
export function anonymize(text: string, pii: PersonalInfo, extraNames: (string | null)[] = []): string {
  let out = text.replace(EMAIL_RE, "[EMAIL]").replace(URL_RE, "[LINK]");
  out = out.replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/g, "").length;
    return digits >= 10 ? "[PHONE]" : m;
  });
  for (const term of nameTerms([pii.name, ...extraNames])) {
    // Short parts (e.g. "Rao") need word boundaries; longer ones are also removed
    // when glued to other text, which happens with overlaid PDF headers ("SHARMAPriya").
    const pattern = term.length >= 4 ? escapeRe(term) : `\\b${escapeRe(term)}\\b`;
    out = out.replace(new RegExp(pattern, "gi"), "[CANDIDATE]");
  }
  return out.replace(/(\[CANDIDATE\]\s*){2,}/g, "[CANDIDATE] ");
}

/**
 * Defence in depth: called immediately before any text is sent to Gemini.
 * Throws if any known personal detail is still present.
 */
export function assertNoPii(text: string, pii: Pick<PersonalInfo, "name" | "email" | "phone">): void {
  const lower = text.toLowerCase();
  if (pii.email && lower.includes(pii.email.toLowerCase())) throw new Error("PII guard: email present");
  if (new RegExp(EMAIL_RE.source).test(text)) throw new Error("PII guard: an email address is present");
  if (pii.phone) {
    const digits = pii.phone.replace(/\D/g, "");
    if (digits.length >= 10 && text.replace(/\D/g, "").includes(digits)) {
      throw new Error("PII guard: phone present");
    }
  }
  if (pii.name && new RegExp(`\\b${escapeRe(pii.name)}\\b`, "i").test(text)) {
    throw new Error("PII guard: name present");
  }
}

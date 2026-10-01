/** The AI never sees the candidate's name; this placeholder is filled in from the private record. */
export const NAME_PLACEHOLDER = "{{CANDIDATE_NAME}}";

/** Personalise a stored draft with the candidate's first name (used for preview and at send time). */
export function fillName(text: string, name: string | null): string {
  const first = name?.trim().split(/\s+/)[0] || "there";
  return text.split(NAME_PLACEHOLDER).join(first);
}

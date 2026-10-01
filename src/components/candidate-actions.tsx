"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, jsonInit } from "@/lib/client/api";
import { fillName, NAME_PLACEHOLDER } from "@/lib/email-format";
import type { EmailType } from "@/lib/types";

function ErrorText({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="mt-2 text-sm text-rose-700">
      {message}
    </p>
  ) : null;
}

const btn =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

/* ------------------------------------------------------------------ */
/* Contact details (private record; never sent to the AI)             */
/* ------------------------------------------------------------------ */
export function ContactEditor(props: {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  nameSource: string | null;
  locked: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(!props.email || !props.name);
  const [name, setName] = useState(props.name ?? "");
  const [email, setEmail] = useState(props.email ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const patch: Record<string, string> = {};
      if (name.trim() && name.trim() !== props.name) patch.personal_name = name.trim();
      if (email.trim() && email.trim() !== props.email) patch.personal_email = email.trim();
      if (Object.keys(patch).length) await api(`/api/candidates/${props.id}`, jsonInit("PATCH", patch));
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-slate-500">Email</dt>
          <dd className="break-all text-slate-900">{props.email ?? <span className="text-amber-700">Missing</span>}</dd>
          <dt className="text-slate-500">Phone</dt>
          <dd className="text-slate-900">{props.phone ?? <span className="text-slate-400">Not found</span>}</dd>
        </dl>
        {props.nameSource === "filename" && (
          <p className="mt-2 text-xs text-amber-700">Name taken from the file name; please check it is right.</p>
        )}
        {!props.locked && (
          <button className={`${btn} mt-3`} onClick={() => setEditing(true)}>
            Edit contact details
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      {!props.email && (
        <p className="rounded bg-amber-50 px-2 py-1 text-amber-800">No email found in the CV. Add one to enable sending.</p>
      )}
      <label className="block">
        <span className="text-slate-600">Name</span>
        <input className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block">
        <span className="text-slate-600">Email</span>
        <input type="email" className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        {props.email && props.name && (
          <button className={btn} onClick={() => setEditing(false)} disabled={saving}>
            Cancel
          </button>
        )}
      </div>
      <ErrorText message={error} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Interview brief                                                    */
/* ------------------------------------------------------------------ */
export function BriefPanel({ id, brief, isTop }: { id: string; brief: string | null; isTop: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/candidates/${id}/brief`, { method: "POST" });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {brief ? (
        <p className="text-sm leading-relaxed text-slate-800">{brief}</p>
      ) : (
        <p className="text-sm text-slate-500">
          {isTop
            ? "Brief not generated yet."
            : "Briefs are generated automatically for the top 5 applicants per role. You can still generate one for this candidate."}
        </p>
      )}
      <button className={`${btn} mt-3`} onClick={generate} disabled={busy}>
        {busy ? "Generating…" : brief ? "Regenerate brief" : "Generate brief"}
      </button>
      <ErrorText message={error} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Email draft review + Confirm & Send                                 */
/* ------------------------------------------------------------------ */
export function EmailPanel(props: {
  id: string;
  name: string | null;
  email: string | null;
  subject: string | null;
  body: string | null;
  type: EmailType | null;
  sent: boolean;
  sentAt: string | null;
  from: string;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(props.subject ?? "");
  const [body, setBody] = useState(props.body ?? "");
  const [busy, setBusy] = useState<null | "save" | "regen" | "send">(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = subject !== (props.subject ?? "") || body !== (props.body ?? "");

  async function run(kind: "save" | "regen" | "send", fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run("save", async () => {
      await api(`/api/candidates/${props.id}`, jsonInit("PATCH", { email_subject: subject, email_body: body }));
      setNotice("Draft saved.");
      router.refresh();
    });

  const regenerate = (type?: EmailType) =>
    run("regen", async () => {
      if (dirty && !window.confirm("Discard your edits and generate a new draft?")) return;
      await api(`/api/candidates/${props.id}/email`, jsonInit("POST", type ? { type } : {}));
      // Reload so the new draft from the server replaces local state.
      window.location.reload();
    });

  const send = () =>
    run("send", async () => {
      // Persist any edits first so exactly what was reviewed is what gets sent.
      if (dirty) await api(`/api/candidates/${props.id}`, jsonInit("PATCH", { email_subject: subject, email_body: body }));
      await api(`/api/candidates/${props.id}/send`, { method: "POST" });
      setConfirming(false);
      router.refresh();
    });

  const typeBadge =
    props.type === "interview_invitation" ? (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
        Interview invitation
      </span>
    ) : props.type === "rejection" ? (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-500/20">
        Warm rejection
      </span>
    ) : null;

  if (props.sent) {
    return (
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {typeBadge}
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
            Sent {props.sentAt ? new Date(props.sentAt).toLocaleString() : ""}
          </span>
        </div>
        <p className="text-slate-600">To: {props.email}</p>
        <p className="font-medium text-slate-900">{fillName(props.subject ?? "", props.name)}</p>
        <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-slate-800">{fillName(props.body ?? "", props.name)}</pre>
      </div>
    );
  }

  if (!props.subject && !props.body) {
    return (
      <div className="text-sm">
        <p className="text-slate-600">No draft yet. The AI draft may have failed during upload.</p>
        <button className={`${btn} mt-3`} onClick={() => regenerate()} disabled={busy !== null}>
          {busy === "regen" ? "Generating…" : "Generate draft"}
        </button>
        <ErrorText message={error} />
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {typeBadge}
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Not sent: awaiting your decision</span>
      </div>
      <p className="text-slate-600">
        To: {props.email ?? <span className="font-medium text-amber-700">no email address yet: add one under Candidate details</span>}
      </p>

      <label className="block">
        <span className="text-slate-600">Subject</span>
        <input className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="block">
        <span className="text-slate-600">Body</span>
        <textarea
          className="mt-0.5 h-64 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-[13px] leading-relaxed"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <span className="text-xs text-slate-500">
          <code>{NAME_PLACEHOLDER}</code> is replaced with &ldquo;{fillName(NAME_PLACEHOLDER, props.name)}&rdquo; when sent.
        </span>
      </label>

      <details className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <summary className="cursor-pointer font-medium text-slate-700">Preview exactly what will be sent</summary>
        <p className="mt-2 text-slate-500">From: {props.from}</p>
        <p className="font-medium text-slate-900">{fillName(subject, props.name)}</p>
        <pre className="mt-2 whitespace-pre-wrap font-sans text-slate-800">{fillName(body, props.name)}</pre>
      </details>

      <div className="flex flex-wrap gap-2">
        <button className={btn} onClick={save} disabled={busy !== null || !dirty}>
          {busy === "save" ? "Saving…" : "Save draft"}
        </button>
        <button className={btn} onClick={() => regenerate(props.type ?? undefined)} disabled={busy !== null}>
          {busy === "regen" ? "Regenerating…" : "Regenerate draft"}
        </button>
        <button
          className={btn}
          onClick={() => regenerate(props.type === "interview_invitation" ? "rejection" : "interview_invitation")}
          disabled={busy !== null}
          title="Your decision overrides the system recommendation"
        >
          {props.type === "interview_invitation" ? "Switch to rejection" : "Switch to invitation"}
        </button>
        <button
          className="ml-auto rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => setConfirming(true)}
          disabled={busy !== null || !props.email || !subject.trim() || !body.trim()}
        >
          Confirm &amp; Send
        </button>
      </div>

      {confirming && (
        <div role="dialog" aria-modal className="rounded-lg border-2 border-indigo-600 bg-indigo-50 p-4">
          <p className="font-medium text-slate-900">
            Send this {props.type === "interview_invitation" ? "interview invitation" : "rejection"} to {props.email}?
          </p>
          <p className="mt-1 text-slate-600">This cannot be undone.</p>
          <div className="mt-3 flex gap-2">
            <button
              className="rounded-md bg-indigo-600 px-4 py-1.5 font-semibold text-white disabled:opacity-50"
              onClick={send}
              disabled={busy !== null}
            >
              {busy === "send" ? "Sending…" : "Yes, send email"}
            </button>
            <button className={btn} onClick={() => setConfirming(false)} disabled={busy !== null}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {notice && <p className="text-emerald-700">{notice}</p>}
      <ErrorText message={error} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function DeleteCandidate({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className="text-sm text-rose-700 hover:underline"
        onClick={async () => {
          if (!window.confirm("Delete this candidate and all their data? This cannot be undone.")) return;
          try {
            await api(`/api/candidates/${id}`, { method: "DELETE" });
            router.push("/");
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        Delete candidate
      </button>
      <ErrorText message={error} />
    </div>
  );
}

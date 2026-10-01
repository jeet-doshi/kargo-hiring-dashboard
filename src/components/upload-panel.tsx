"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { ROLE_LABELS, type Role } from "@/lib/types";

type Item = {
  key: string;
  file: File;
  status: "queued" | "processing" | "done" | "error";
  message?: string;
  warnings?: string[];
  candidateId?: string;
};

const ACCEPT = ".pdf,.docx,.txt";

export function UploadPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function pick(list: FileList | null) {
    if (!list) return;
    setFiles(Array.from(list));
    setFormError(null);
  }

  async function upload() {
    if (!role) return setFormError("Select the role these CVs applied for.");
    if (!files.length) return setFormError("Choose at least one CV file.");
    setFormError(null);
    setBusy(true);
    const batch: Item[] = files.map((file, i) => ({ key: `${Date.now()}-${i}`, file, status: "queued" }));
    setItems((prev) => [...batch, ...prev]);
    setFiles([]);
    if (inputRef.current) inputRef.current.value = "";

    const update = (key: string, patch: Partial<Item>) =>
      setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

    // One request per CV, in sequence: keeps each request well inside serverless time limits.
    for (const item of batch) {
      update(item.key, { status: "processing" });
      try {
        const form = new FormData();
        form.append("file", item.file);
        form.append("role", role);
        const res = await api<{ id: string; name: string | null; warnings: string[] }>("/api/upload", {
          method: "POST",
          body: form,
        });
        update(item.key, {
          status: "done",
          candidateId: res.id,
          message: res.name ? `Scored: ${res.name}` : "Scored",
          warnings: res.warnings,
        });
        router.refresh();
      } catch (err) {
        update(item.key, { status: "error", message: (err as Error).message });
      }
    }
    setBusy(false);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Upload Candidate CV</h2>
      <p className="mt-1 text-sm text-slate-500">
        PDF, DOCX or TXT, up to 5 MB each. You can select several CVs for the same role. Each one is anonymised,
        scored against both rubrics and gets an email draft. Nothing is sent until you confirm.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pick(e.dataTransfer.files);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm ${
            dragOver ? "border-indigo-500 bg-indigo-50" : "border-slate-300 hover:border-slate-400"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            onChange={(e) => pick(e.target.files)}
            disabled={busy}
          />
          {files.length ? (
            <span className="font-medium text-slate-800">
              {files.length === 1 ? files[0].name : `${files.length} files selected`}
            </span>
          ) : (
            <>
              <span className="font-medium text-slate-800">Drop CVs here or click to choose</span>
              <span className="mt-1 text-slate-500">PDF · DOCX · TXT</span>
            </>
          )}
        </label>

        <div className="flex flex-col gap-3">
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-700">Applied role</legend>
            <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
              {(["PM", "SPM"] as Role[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  aria-pressed={role === r}
                  disabled={busy}
                  className={`rounded-md border px-4 py-2 text-sm font-medium ${
                    role === r
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            onClick={upload}
            disabled={busy}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Processing…" : "Upload"}
          </button>
        </div>
      </div>

      {formError && <p className="mt-3 text-sm text-rose-700">{formError}</p>}

      {items.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
          {items.map((it) => (
            <li key={it.key} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
              <span className="truncate font-medium text-slate-800">{it.file.name}</span>
              <span className="sm:text-right">
                {it.status === "queued" && <span className="text-slate-500">Queued</span>}
                {it.status === "processing" && (
                  <span className="text-indigo-700">Anonymising and scoring… (about 30-60s)</span>
                )}
                {it.status === "done" && (
                  <span className="text-emerald-700">
                    {it.message}{" "}
                    {it.candidateId && (
                      <a className="underline" href={`/candidates/${it.candidateId}`}>
                        View
                      </a>
                    )}
                  </span>
                )}
                {it.status === "error" && <span className="text-rose-700">{it.message}</span>}
                {it.warnings?.map((w) => (
                  <span key={w} className="block text-amber-700">
                    {w}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

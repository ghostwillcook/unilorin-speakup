import { useRef, useState, type FormEvent } from "react";
import NeonButton from "@/components/NeonButton";

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 5000;
const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;

interface UploadTicket {
  path: string;
  token: string;
  bucket: string;
}

/**
 * Lodge-a-complaint form.
 *
 * Attachments are a best-effort extra, never a gate: if Supabase Storage is not
 * configured the route answers 503 and the complaint still submits without
 * files. Someone reporting a problem should not be blocked because object
 * storage has not been set up yet.
 */
export default function ComplaintForm({
  onSubmitted,
}: {
  /** Receives the new complaint's id so the caller can offer to open it. */
  onSubmitted: (complaintId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    const next: Record<string, string> = {};
    const t = title.trim();
    const d = description.trim();

    if (t.length === 0) next.title = "Please give your complaint a title.";
    else if (t.length > MAX_TITLE)
      next.title = `Keep the title to ${MAX_TITLE} characters or fewer.`;

    if (d.length === 0) next.description = "Please describe what happened.";
    else if (d.length > MAX_DESCRIPTION)
      next.description = `Keep the description to ${MAX_DESCRIPTION} characters or fewer.`;

    if (files.length > MAX_FILES)
      next.files = `You can attach at most ${MAX_FILES} files.`;
    else {
      const tooBig = files.find((f) => f.size > MAX_BYTES);
      if (tooBig) next.files = `"${tooBig.name}" is larger than 10 MB.`;
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  /**
   * Returns the storage object keys of everything uploaded. The bucket is
   * private, so a key — not a URL — is what gets stored on the complaint;
   * reads go back through /api/attachments. A 503 means storage is not
   * configured — surfaced as a warning and treated as "no attachments" rather
   * than as a failure.
   */
  async function uploadAll(): Promise<string[]> {
    if (files.length === 0) return [];
    const keys: string[] = [];

    for (const file of files) {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }),
      });

      if (res.status === 503) {
        const body = (await res.json()) as { hint?: string; error?: string };
        setWarning(
          body.hint ??
            body.error ??
            "File storage is not configured, so your complaint was sent without attachments.",
        );
        return [];
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not prepare "${file.name}" for upload.`);
      }

      const ticket = (await res.json()) as UploadTicket;
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const put = await fetch(
        `${base}/storage/v1/object/upload/sign/${ticket.bucket}/${ticket.path}?token=${encodeURIComponent(ticket.token)}`,
        {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        },
      );
      if (!put.ok) throw new Error(`Upload of "${file.name}" failed.`);
      keys.push(ticket.path);
    }
    return keys;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    setWarning(null);
    if (!validate()) return;

    setBusy(true);
    try {
      const uploaded = await uploadAll();

      const res = await fetch("/api/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          files: uploaded,
        }),
      });

      if (res.status === 503) {
        const body = (await res.json()) as { hint?: string };
        setWarning(body.hint ?? "The database is not configured yet.");
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not submit your complaint.");
      }

      const body = (await res.json()) as { complaint?: { id?: string } };

      setTitle("");
      setDescription("");
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      setNotice("Your complaint has been submitted and is now pending review.");
      onSubmitted(body.complaint?.id ?? "");
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="surface p-5 sm:p-6" noValidate>
      <h2 className="text-graphite text-lg font-semibold">Lodge a Complaint</h2>
      <p className="mt-1 text-sm text-muted">
        Give as much detail as you can. You can attach evidence if you have it.
      </p>

      {notice && (
        <div className="notice mt-4" role="status">
          {notice}
        </div>
      )}
      {warning && (
        <div className="notice notice-warn mt-4" role="status">
          {warning}
        </div>
      )}
      {errors.form && (
        <div className="notice notice-error mt-4" role="alert">
          {errors.form}
        </div>
      )}

      <div className="mt-5">
        <label className="field-label" htmlFor="complaint-title">
          Title
        </label>
        <input
          id="complaint-title"
          className="field"
          value={title}
          maxLength={MAX_TITLE + 1}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Briefly, what is this about?"
          aria-invalid={Boolean(errors.title)}
          aria-describedby={errors.title ? "complaint-title-error" : undefined}
        />
        {errors.title && (
          <p id="complaint-title-error" className="mt-1 text-xs text-danger">
            {errors.title}
          </p>
        )}
      </div>

      <div className="mt-4">
        <label className="field-label" htmlFor="complaint-description">
          What happened
        </label>
        <textarea
          id="complaint-description"
          className="textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Include dates, locations and anyone involved, if relevant."
          aria-invalid={Boolean(errors.description)}
          aria-describedby={
            errors.description ? "complaint-description-error" : undefined
          }
        />
        <div className="mt-1 flex items-center justify-between">
          {errors.description ? (
            <p id="complaint-description-error" className="text-xs text-danger">
              {errors.description}
            </p>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted">
            {description.trim().length}/{MAX_DESCRIPTION}
          </span>
        </div>
      </div>

      <div className="mt-4">
        <label className="field-label" htmlFor="complaint-files">
          Attachments <span className="text-muted">(optional)</span>
        </label>
        <input
          id="complaint-files"
          ref={fileInput}
          type="file"
          multiple
          className="field file:mr-3 file:rounded-md file:border-0 file:bg-veil file:px-3 file:py-1 file:text-accent"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
        <p className="mt-1 text-xs text-muted">
          Up to {MAX_FILES} files, 10 MB each.
        </p>
        {errors.files && (
          <p className="mt-1 text-xs text-danger">{errors.files}</p>
        )}
      </div>

      <div className="mt-6">
        <NeonButton type="submit" loading={busy}>
          {busy ? "Submitting…" : "Submit complaint"}
        </NeonButton>
      </div>
    </form>
  );
}

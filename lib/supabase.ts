import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase Storage for complaint attachments.
 *
 * The service-role key is read here and used only inside API routes. It must
 * never be exposed with a NEXT_PUBLIC_ prefix — it bypasses row level security
 * entirely.
 */

export const STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET || "complaint-files";

let cached: SupabaseClient | null = null;

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase Storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY in .env.local, and create the " +
        `"${STORAGE_BUCKET}" bucket.`,
    );
    this.name = "StorageNotConfiguredError";
  }
}

/** Lazily builds the service-role client. Throws if unconfigured. */
export function getSupabaseAdmin(): SupabaseClient {
  if (!isStorageConfigured()) throw new StorageNotConfiguredError();
  if (!cached) {
    cached = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return cached;
}

/** Namespaces uploads per user and strips anything unsafe from the filename. */
export function storageKeyFor(userId: string, filename: string): string {
  const safe = filename
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(-120);
  // Uniqueness without a timestamp collision risk across concurrent uploads.
  const nonce = Math.random().toString(36).slice(2, 10);
  return `${userId}/${nonce}-${safe}`;
}

/**
 * The bucket is private, so an object key is not a URL anyone can open. Reads
 * go through /api/attachments, which authorizes the caller and then signs a
 * short-lived link. Sixty seconds is long enough to follow a click and short
 * enough that a copied URL is not a lasting grant.
 */
export const SIGNED_URL_TTL_SECONDS = 60;

const MAX_STORAGE_KEY = 400;

/**
 * Validates an object key before it reaches Storage. Rejects absolute paths and
 * `..` so a caller cannot climb out of their own namespace, and restricts the
 * character set to what `storageKeyFor` actually produces.
 */
export function isValidStorageKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= MAX_STORAGE_KEY &&
    !key.startsWith("/") &&
    !key.includes("..") &&
    !key.includes("\\") &&
    /^[\w./-]+$/.test(key)
  );
}

/**
 * True when `key` sits in `userId`'s namespace. `storageKeyFor` prefixes every
 * upload with the owner's id, which makes ownership checkable from the key
 * alone — no database round trip, so attachments stay readable during an outage.
 */
export function ownsStorageKey(key: string, userId: string): boolean {
  return isValidStorageKey(key) && key.startsWith(`${userId}/`);
}

/** Signs a time-limited download URL. Throws if storage is unconfigured. */
export async function createSignedDownloadUrl(key: string): Promise<string> {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .createSignedUrl(key, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    throw new Error(error?.message ?? "Could not sign the attachment URL.");
  }
  return data.signedUrl;
}

export const UPLOAD_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxFiles: 5,
  allowedMime: [
    "image/png",
    "image/jpeg",
    "image/webp",
    "application/pdf",
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
} as const;

import { Resend } from "resend";

/**
 * Transactional email via Resend (password reset, security confirmations).
 *
 * Email is an optional integration, same contract as Supabase Storage in
 * lib/supabase.ts: the feature degrades gracefully when RESEND_API_KEY is
 * absent instead of crashing the route. Callers check isEmailConfigured()
 * first to decide what to tell the user; sendEmail itself never throws —
 * it reports { ok: false, error } so each caller chooses whether a failed
 * send matters. That mirrors the push fan-out in
 * pages/api/admin/notifications.ts, where the Web Push attempt is
 * deliberately swallowed because the persisted row is the source of truth;
 * here too a delivery hiccup must never turn into a 500 on top of a
 * request whose side effects already succeeded (e.g. the reset token row
 * is already committed by the time the email goes out).
 */

let cached: Resend | null = null;

/** True when an API key is present. Never throws. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * From-address for every outgoing email. Defaults to Resend's shared
 * onboarding address so local testing works without a verified domain.
 */
export function emailFrom(): string {
  return (
    process.env.EMAIL_FROM || "UNILORIN Student Connect <onboarding@resend.dev>"
  );
}

/**
 * Absolute origin of the app, used to build links in emails. Falls back to
 * NEXTAUTH_URL before localhost so a deploy that only set the auth variable
 * still yields correct links. Trailing slash is stripped because every
 * caller concatenates a path onto it.
 */
export function appBaseUrl(): string {
  const raw =
    process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends one email. Lazily builds the Resend client (module-level cache, same
 * shape as getSupabaseAdmin) so merely importing this module does nothing.
 * Returns { ok: true } or { ok: false, error } — NEVER throws; see the
 * module doc comment for why.
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
}: SendEmailArgs): Promise<{ ok: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    return { ok: false, error: "Email is not configured (RESEND_API_KEY)." };
  }
  try {
    if (!cached) {
      cached = new Resend(process.env.RESEND_API_KEY);
    }
    const { error } = await cached.emails.send({
      from: emailFrom(),
      to,
      subject,
      html,
      text,
    });
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown email error.",
    };
  }
}

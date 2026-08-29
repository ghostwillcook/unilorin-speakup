import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GetServerSideProps } from "next";

import AdminLayout from "@/components/AdminLayout";
import GlassCard, { PanelHeader } from "@/components/GlassCard";
import NeonButton from "@/components/NeonButton";
import { isRedirect, requirePage } from "@/lib/guards";
import type { SessionUser } from "@/lib/guards";
// Type-only, and deliberately so: lib/settings.ts imports lib/prisma.ts, which
// imports @prisma/client at module scope. requirePage below escapes that because
// Next strips imports used solely by getServerSideProps — but anything the
// component body touches ships to the browser, so no value may be imported from
// there. The interface is erased at compile time and costs the bundle nothing.
import type { SpeakUpSettings } from "@/lib/settings";

/**
 * Runtime settings for the platform.
 *
 * Both controls here change live behaviour rather than recording a preference:
 * the socket server reads these rows, so a saved rate limit applies to the next
 * message anyone sends and anonymous mode decides whether the global room shows
 * pseudonyms or real names. The copy says so plainly, because an admin flipping
 * the anonymity switch is making a policy decision about students who are not
 * in the room.
 *
 * Saving sends only the keys that actually changed. That keeps a concurrent
 * edit by another admin from being silently reverted by whatever this form
 * happened to load, and it is why the API's "unknown key" rejection is never
 * hit by this page.
 *
 * The server's response — not the form's local values — becomes the new
 * baseline, so the clamp in saveSettings() (1..600) is visible rather than
 * hidden behind an optimistic success.
 */

const RATE_MIN = 1;
const RATE_MAX = 600;

/**
 * Placeholder values for the render before GET /api/settings answers.
 *
 * Intentionally not DEFAULT_SETTINGS from lib/settings.ts — see the import note
 * above. Nothing is decided by these: they are overwritten by the server's
 * response on load, and the Save button stays disabled until that response has
 * established a baseline, so a placeholder can never be written back as if it
 * were a real setting.
 */
const PLACEHOLDER: SpeakUpSettings = {
  anonymousMode: true,
  chatRateLimitPerMin: 20,
};

interface Props {
  user: SessionUser;
}

/* ------------------------------------------------------------------------- */
/* Response narrowing                                                         */
/* ------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

/**
 * Narrows the payload, falling back per-field to the placeholder. A malformed
 * field must not blank a control — an empty box looks like a real value and
 * could be saved back as one.
 */
function asSettings(value: unknown): SpeakUpSettings | null {
  const raw = isRecord(value) ? value.settings : null;
  if (!isRecord(raw)) return null;

  const rate = raw.chatRateLimitPerMin;
  return {
    anonymousMode:
      typeof raw.anonymousMode === "boolean"
        ? raw.anonymousMode
        : PLACEHOLDER.anonymousMode,
    chatRateLimitPerMin:
      typeof rate === "number" && Number.isFinite(rate) && rate > 0
        ? Math.round(rate)
        : PLACEHOLDER.chatRateLimitPerMin,
  };
}

/** Only the keys that differ from the saved baseline. */
function diff(
  saved: SpeakUpSettings,
  form: SpeakUpSettings,
): Partial<SpeakUpSettings> {
  const patch: Partial<SpeakUpSettings> = {};
  if (form.anonymousMode !== saved.anonymousMode) {
    patch.anonymousMode = form.anonymousMode;
  }
  if (form.chatRateLimitPerMin !== saved.chatRateLimitPerMin) {
    patch.chatRateLimitPerMin = form.chatRateLimitPerMin;
  }
  return patch;
}

/* ------------------------------------------------------------------------- */

export default function AdminSettings({ user }: Props) {
  /** What the server last confirmed. The dirty check compares against this. */
  const [saved, setSaved] = useState<SpeakUpSettings | null>(null);
  /** What the controls show. */
  const [form, setForm] = useState<SpeakUpSettings>(PLACEHOLDER);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set only for the 503 database-not-configured case. */
  const [setupHint, setSetupHint] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  /** The raw text of the number field, so a half-typed value is not clobbered. */
  const [rateText, setRateText] = useState(
    String(PLACEHOLDER.chatRateLimitPerMin),
  );
  const [nonce, setNonce] = useState(0);

  /* ------------------------------------------------------------------- load */

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch("/api/settings", {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const body: unknown = await res.json().catch(() => null);
        if (controller.signal.aborted) return;

        if (!res.ok) {
          setSaved(null);
          setError(
            readField(body, "error") ??
              `Could not load settings (${res.status}).`,
          );
          // The guard ships an actionable hint with its 503; show it verbatim.
          setSetupHint(res.status === 503 ? readField(body, "hint") : null);
          return;
        }

        const settings = asSettings(body);
        if (!settings) {
          setSaved(null);
          setError("The server returned settings in an unexpected shape.");
          setSetupHint(null);
          return;
        }

        setSaved(settings);
        setForm(settings);
        setRateText(String(settings.chatRateLimitPerMin));
        setError(null);
        setSetupHint(null);
      } catch {
        if (controller.signal.aborted) return;
        setSaved(null);
        setSetupHint(null);
        setError(
          "Could not reach the server. Please try again.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [nonce]);

  /* ------------------------------------------------------------------ edits */

  /** Any edit invalidates the previous save's confirmation. */
  const touch = useCallback(() => setConfirmation(null), []);

  const toggleAnonymous = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.checked;
      setForm((current) => ({ ...current, anonymousMode: next }));
      touch();
    },
    [touch],
  );

  const changeRate = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const text = event.target.value;
      setRateText(text);
      touch();

      // An empty or mid-edit field leaves the committed value alone; the dirty
      // check and the Save guard both work off `form`, so a blank box can never
      // be submitted as a number.
      const parsed = Number.parseInt(text, 10);
      if (!Number.isFinite(parsed)) return;
      setForm((current) => ({ ...current, chatRateLimitPerMin: parsed }));
    },
    [touch],
  );

  /** Snap the field back to what will actually be sent once focus leaves. */
  const commitRate = useCallback(() => {
    const parsed = Number.parseInt(rateText, 10);
    const next = Number.isFinite(parsed)
      ? Math.min(RATE_MAX, Math.max(RATE_MIN, parsed))
      : (saved?.chatRateLimitPerMin ?? PLACEHOLDER.chatRateLimitPerMin);

    setRateText(String(next));
    setForm((current) =>
      current.chatRateLimitPerMin === next
        ? current
        : { ...current, chatRateLimitPerMin: next },
    );
  }, [rateText, saved]);

  const patch = useMemo(
    () => (saved ? diff(saved, form) : {}),
    [form, saved],
  );
  const dirty = Object.keys(patch).length > 0;

  const rateOutOfRange =
    form.chatRateLimitPerMin < RATE_MIN || form.chatRateLimitPerMin > RATE_MAX;

  const revert = useCallback(() => {
    if (!saved) return;
    setForm(saved);
    setRateText(String(saved.chatRateLimitPerMin));
    setConfirmation(null);
    setError(null);
  }, [saved]);

  /* ------------------------------------------------------------------- save */

  const save = useCallback(async () => {
    if (!saved || saving) return;

    // Recomputed here rather than trusting the memo: the button is the only
    // caller, but an empty patch would be a 200 that means nothing.
    const body = diff(saved, form);
    if (Object.keys(body).length === 0) return;

    setSaving(true);
    setError(null);
    setConfirmation(null);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setError(
          readField(payload, "error") ??
            `Settings were not saved (${res.status}).`,
        );
        setSetupHint(res.status === 503 ? readField(payload, "hint") : null);
        return;
      }

      const settings = asSettings(payload);
      if (!settings) {
        // Possibly persisted, so re-read rather than claim either outcome.
        setError(
          "Saved, but the server's response could not be read. Reloading the current values.",
        );
        setNonce((key) => key + 1);
        return;
      }

      // The response is the new baseline, so the server's clamp shows up in the
      // field instead of the form quietly disagreeing with what was stored.
      setSaved(settings);
      setForm(settings);
      setRateText(String(settings.chatRateLimitPerMin));
      setSetupHint(null);
      setConfirmation(
        settings.anonymousMode
          ? `Settings saved. Anonymous mode is on and the chat limit is ${settings.chatRateLimitPerMin} messages per minute.`
          : `Settings saved. Anonymous mode is off — the global chat now shows students' real names — and the limit is ${settings.chatRateLimitPerMin} messages per minute.`,
      );
    } catch {
      setError("Could not reach the server. Settings were not saved.");
    } finally {
      setSaving(false);
    }
  }, [form, saved, saving]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void save();
    },
    [save],
  );

  /* ----------------------------------------------------------------- render */

  // A 503 from PUT means the settings shown are the built-in defaults and there
  // is nowhere to write them, so the controls lock rather than inviting edits
  // that cannot land.
  const disabled = loading || saving || !saved || setupHint !== null;

  return (
    <AdminLayout
      title="Settings"
      subtitle={`Platform behaviour for chat and anonymity. Signed in as ${user.name}.`}
      right={
        <>
          {dirty && (
            <span className="badge border border-warn/30 bg-warn/8 text-warn">
              Unsaved changes
            </span>
          )}
          <NeonButton
            variant="ghost"
            onClick={() => setNonce((key) => key + 1)}
            loading={loading}
            disabled={saving}
          >
            Reload
          </NeonButton>
        </>
      }
    >
      {setupHint && (
        <div className="notice notice-warn mb-5">
          <span aria-hidden="true">⚠</span>
          <span>
            <strong className="font-semibold">Database not configured.</strong>{" "}
            {setupHint} Until then these are the built-in defaults and cannot be
            changed.
          </span>
        </div>
      )}

      {error && !setupHint && (
        <div className="notice notice-error mb-5" role="alert">
          <span aria-hidden="true">✕</span>
          <span className="flex-1">{error}</span>
        </div>
      )}

      {confirmation && (
        <div
          className="notice mb-5"
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true">✓</span>
          <span>{confirmation}</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <GlassCard className="mb-5 overflow-hidden">
          <PanelHeader
            title="Anonymity"
            subtitle="Who students appear as in the global chat room."
          />

          <div className="px-5 py-5">
            {/* A real checkbox styled as a switch: keyboard, form semantics and
                screen-reader state come free, and only the visuals are ours. */}
            <label
              className={`flex items-start gap-4 ${
                disabled ? "cursor-not-allowed" : "cursor-pointer"
              }`}
            >
              <span className="relative mt-0.5 inline-flex shrink-0">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={form.anonymousMode}
                  onChange={toggleAnonymous}
                  disabled={disabled}
                  // The wrapping label would otherwise name this control with
                  // the whole explanatory paragraph; the paragraph is the
                  // description, not the name.
                  aria-label="Anonymous mode"
                  aria-describedby="anonymous-help"
                />
                <span
                  aria-hidden="true"
                  className="block h-6 w-11 rounded-full border border-line bg-canvas/85 transition-colors peer-checked:border-line peer-checked:bg-veil peer-focus-visible:ring-2 peer-focus-visible:ring-graphite/40 peer-disabled:opacity-50"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-canvas shadow transition-transform peer-checked:translate-x-5 peer-checked:bg-canvas peer-disabled:opacity-50"
                />
              </span>

              <span className="min-w-0">
                <span className="block text-sm font-semibold text-graphite">
                  Anonymous mode
                  <span
                    className={`badge ml-2 align-middle ${
                      form.anonymousMode
                        ? "border border-line bg-veil text-accent"
                        : "border border-warn/30 bg-warn/8 text-warn"
                    }`}
                  >
                    {form.anonymousMode ? "On" : "Off"}
                  </span>
                </span>
                <span
                  id="anonymous-help"
                  className="mt-1.5 block text-sm text-muted"
                >
                  On, every student posts to the global room under a rotating
                  pseudonym such as “Anonymous #42”. Turning it{" "}
                  <strong className="font-semibold text-muted">off</strong>{" "}
                  shows students’ real names in the global chat to everyone in
                  the room — which removes the protection that makes students
                  willing to raise sensitive complaints, so only turn it off if
                  the Unit has decided named discussion is appropriate. Direct
                  messages to the Unit are always identified either way.
                </span>
              </span>
            </label>
          </div>
        </GlassCard>

        <GlassCard className="mb-5 overflow-hidden">
          <PanelHeader
            title="Chat rate limit"
            subtitle="How fast one student may post in the global room."
          />

          <div className="px-5 py-5">
            <label className="field-label" htmlFor="chat-rate">
              Messages per minute, per student
            </label>
            <input
              id="chat-rate"
              type="number"
              inputMode="numeric"
              className="field max-w-[10rem]"
              min={RATE_MIN}
              max={RATE_MAX}
              step={1}
              value={rateText}
              onChange={changeRate}
              onBlur={commitRate}
              disabled={disabled}
              aria-describedby="chat-rate-help"
            />
            <p id="chat-rate-help" className="mt-2 text-sm text-muted">
              Between {RATE_MIN} and {RATE_MAX}. The socket server enforces this
              immediately — no restart is needed, and the next message a student
              sends is already measured against the new limit. Anyone over it
              gets a “slow down” notice instead of having their message
              silently dropped.
            </p>
            {rateOutOfRange && (
              <p className="mt-2 text-sm text-warn">
                Values outside {RATE_MIN}–{RATE_MAX} are clamped into range when
                saved.
              </p>
            )}
          </div>
        </GlassCard>

        <div className="flex flex-wrap items-center gap-3">
          <NeonButton type="submit" loading={saving} disabled={!dirty || disabled}>
            Save changes
          </NeonButton>

          {dirty && (
            <NeonButton
              type="button"
              variant="ghost"
              onClick={revert}
              disabled={saving}
            >
              Discard
            </NeonButton>
          )}

          <p className="text-sm text-muted">
            {loading
              ? "Loading current settings…"
              : !saved
                ? "Settings are unavailable — resolve the problem above, then Reload."
                : dirty
                  ? `Unsaved: ${Object.keys(patch).join(", ")}.`
                  : "Everything here matches what is live."}
          </p>
        </div>
      </form>
    </AdminLayout>
  );
}

/* ------------------------------------------------------------------------- */

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const gate = await requirePage(ctx, "ADMIN");
  if (isRedirect(gate)) return gate;
  return { props: { user: gate.user } };
};

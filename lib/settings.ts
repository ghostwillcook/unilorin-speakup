import { prisma, isDbConfigured } from "@/lib/prisma";

/**
 * Admin-controlled runtime settings, stored as `Setting` key/value rows.
 *
 * These are read by the socket server too, so changing the rate limit in
 * /admin/settings actually alters behaviour rather than just recording a
 * number.
 */
export interface SpeakUpSettings {
  /** When false, chat shows real names instead of pseudonyms. */
  anonymousMode: boolean;
  /** Messages one student may send per minute in the global room. */
  chatRateLimitPerMin: number;
  /**
   * How many complaints a student may have open (PENDING or IN_REVIEW)
   * before the system refuses new submissions. 0 = unlimited. The admin
   * sets this in /admin/settings; it exists so a student cannot flood the
   * queue while earlier complaints are still being worked.
   */
  complaintSubmissionLimit: number;
}

export const DEFAULT_SETTINGS: SpeakUpSettings = {
  anonymousMode: true,
  chatRateLimitPerMin: 20,
  complaintSubmissionLimit: 0,
};

export const SETTING_KEYS = {
  anonymousMode: "anonymousMode",
  chatRateLimitPerMin: "chatRateLimitPerMin",
  complaintSubmissionLimit: "complaintSubmissionLimit",
} as const;

/** Reads settings, falling back to defaults for missing rows or no database. */
export async function getSettings(): Promise<SpeakUpSettings> {
  if (!isDbConfigured()) return { ...DEFAULT_SETTINGS };

  try {
    const rows = await prisma.setting.findMany();
    const map = new Map(rows.map((r) => [r.key, r.value]));

    return {
      anonymousMode: parseBool(
        map.get(SETTING_KEYS.anonymousMode),
        DEFAULT_SETTINGS.anonymousMode,
      ),
      chatRateLimitPerMin: parseInt_(
        map.get(SETTING_KEYS.chatRateLimitPerMin),
        DEFAULT_SETTINGS.chatRateLimitPerMin,
      ),
      complaintSubmissionLimit: parseIntAllowZero(
        map.get(SETTING_KEYS.complaintSubmissionLimit),
        DEFAULT_SETTINGS.complaintSubmissionLimit,
      ),
    };
  } catch {
    // Table may not exist yet (pre-migration). Defaults keep pages rendering.
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(
  patch: Partial<SpeakUpSettings>,
): Promise<SpeakUpSettings> {
  const entries: Array<[string, string]> = [];

  if (typeof patch.anonymousMode === "boolean") {
    entries.push([SETTING_KEYS.anonymousMode, String(patch.anonymousMode)]);
  }
  if (typeof patch.chatRateLimitPerMin === "number") {
    // Clamped so a typo cannot disable rate limiting or lock chat entirely.
    const n = Math.max(1, Math.min(600, Math.round(patch.chatRateLimitPerMin)));
    entries.push([SETTING_KEYS.chatRateLimitPerMin, String(n)]);
  }
  if (typeof patch.complaintSubmissionLimit === "number") {
    // 0 means unlimited; the ceiling is generous but bounded so the settings
    // UI can never be used to brick complaint submission with a typo'd
    // negative or a scientific-notation million.
    const n = Math.max(0, Math.min(100, Math.round(patch.complaintSubmissionLimit)));
    entries.push([SETTING_KEYS.complaintSubmissionLimit, String(n)]);
  }

  for (const [key, value] of entries) {
    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
  return getSettings();
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return raw === "true";
}

function parseInt_(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Like parseInt_ but accepts 0 (the "unlimited" sentinel for the
 *  complaint limit — it is a meaningful value, not a fallback case). */
function parseIntAllowZero(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

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
}

export const DEFAULT_SETTINGS: SpeakUpSettings = {
  anonymousMode: true,
  chatRateLimitPerMin: 20,
};

export const SETTING_KEYS = {
  anonymousMode: "anonymousMode",
  chatRateLimitPerMin: "chatRateLimitPerMin",
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

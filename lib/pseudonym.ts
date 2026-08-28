/**
 * Pseudonym presentation helpers.
 *
 * Generation lives in the socket server (it owns per-connection session
 * state); this module only handles how a pseudonym looks once it arrives, so
 * "Anonymous #42" keeps the same colour everywhere it appears.
 */

/**
 * Stable hue per pseudonym, for the admin chat log's pseudonym-to-identity
 * pairing.
 *
 * Lightness is deliberately low. The earlier value — 90% saturation at 62%
 * lightness — was written for the dark palette this project no longer has; on
 * the white ground of /admin/chat-logs it renders around 2:1 against the page,
 * so a pseudonym label was effectively unreadable. Dark and desaturated keeps
 * the hue distinguishable between students while clearing AA as body text.
 */
export function pseudonymColor(pseudonym: string): string {
  let hash = 0;
  for (let i = 0; i < pseudonym.length; i++) {
    hash = (hash << 5) - hash + pseudonym.charCodeAt(i);
    hash |= 0;
  }
  // A wide sweep rather than the old green-cyan band: at this lightness the
  // hues sit close together, so the range has to be broad to stay tellable.
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 42% 31%)`;
}

/** "Anonymous #42" -> 42. Null when the format does not match. */
export function pseudonymNumber(pseudonym: string): number | null {
  const m = /#(\d+)\s*$/.exec(pseudonym);
  return m ? Number.parseInt(m[1], 10) : null;
}

/** Two-character avatar text, e.g. "42" or "AN". */
export function pseudonymInitials(pseudonym: string): string {
  const n = pseudonymNumber(pseudonym);
  if (n !== null) return String(n).slice(-2).padStart(2, "0");
  return pseudonym.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "AN";
}

/** Short clock label for message rows. */
export function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Fuller stamp for admin log tables. */
export function dateTimeLabel(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

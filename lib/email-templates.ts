/**
 * Email templates for the password-reset flow.
 *
 * Everything is inline-styled and table-based: email clients (Gmail,
 * Outlook) strip <style> blocks and some ignore flexbox entirely, so the
 * only reliable toolkit is tables plus inline attributes. No images, no
 * external CSS — the mail must render fully offline and in dark-mode
 * clients that invert colors. The palette matches the site: the violet
 * header band is --wl-violet (#10026F) on the warm paper background
 * (#f7f5f0) the landing page uses.
 */

const VIOLET = "#10026F";
const PAPER = "#f7f5f0";
const INK = "#1c1a17";
const MUTED = "#6b675f";
const CARD_MAX_WIDTH = 480;

/**
 * Shared visual frame: full-bleed paper background, violet wordmark band,
 * and a white card. `title` is the <title> (inbox preview text in some
 * clients) — the visible header is the wordmark band, so the two are
 * kept separate from the body content.
 */
export function emailShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${PAPER};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${PAPER};">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="${CARD_MAX_WIDTH}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${CARD_MAX_WIDTH}px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background-color:${VIOLET};padding:24px 28px;">
                <span style="font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.02em;">UNILORIN Student Connect</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};font-size:15px;line-height:1.6;">
${bodyHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Escapes user-provided text (names) before it lands in HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Greeting uses the first name only — emails read friendlier that way. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

/** The primary CTA — a table-cell button, the only shape all clients render. */
function buttonHtml(url: string, label: string): string {
  return `                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                  <tr>
                    <td style="background-color:${VIOLET};border-radius:8px;">
                      <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
                    </td>
                  </tr>
                </table>`;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * "Someone asked to reset your password" email. The raw URL is repeated as
 * plain text under the button because some clients (and corporate filters)
 * disable styled links — the user must always have a copy-pasteable path.
 */
export function resetRequestEmail(
  name: string,
  resetUrl: string,
  expiresMinutes: number,
): EmailContent {
  const greeting = escapeHtml(firstName(name));
  const url = escapeHtml(resetUrl);

  const bodyHtml = `                <p style="margin:0 0 16px;">Hi ${greeting},</p>
                <p style="margin:0 0 16px;">We received a request to reset your UNILORIN Student Connect password.</p>
${buttonHtml(resetUrl, "Reset password")}
                <p style="margin:0 0 16px;word-break:break-all;">If the button doesn't work, copy and paste this link into your browser:<br /><a href="${url}" style="color:${VIOLET};">${url}</a></p>
                <p style="margin:0 0 16px;">This link expires in ${expiresMinutes} minutes and can be used once.</p>
                <p style="margin:0;color:${MUTED};">If you didn't request this, you can ignore this email — your password is unchanged.</p>`;

  return {
    subject: "Reset your UNILORIN Student Connect password",
    html: emailShell("Reset your password", bodyHtml),
    text: [
      `Hi ${firstName(name)},`,
      "",
      "We received a request to reset your UNILORIN Student Connect password.",
      "",
      `Reset your password: ${resetUrl}`,
      "",
      `This link expires in ${expiresMinutes} minutes and can be used once.`,
      "",
      "If you didn't request this, you can ignore this email — your password is unchanged.",
      "",
      "— UNILORIN Student Connect",
    ].join("\n"),
  };
}

/**
 * Post-change confirmation. Sent after the password actually changes so a
 * compromised reset link doesn't go silently: the real owner gets one last
 * chance to raise the alarm via the Student Affairs Unit.
 */
export function passwordChangedEmail(name: string): EmailContent {
  const greeting = escapeHtml(firstName(name));

  const bodyHtml = `                <p style="margin:0 0 16px;">Hi ${greeting},</p>
                <p style="margin:0 0 16px;">Your UNILORIN Student Connect password was just changed.</p>
                <p style="margin:0 0 16px;">You can now sign in with your new password.</p>
                <p style="margin:0;color:${MUTED};">If this wasn't you, contact the Student Affairs Unit immediately.</p>`;

  return {
    subject: "Your UNILORIN Student Connect password was changed",
    html: emailShell("Your password was changed", bodyHtml),
    text: [
      `Hi ${firstName(name)},`,
      "",
      "Your UNILORIN Student Connect password was just changed.",
      "",
      "You can now sign in with your new password.",
      "",
      "If this wasn't you, contact the Student Affairs Unit immediately.",
      "",
      "— UNILORIN Student Connect",
    ].join("\n"),
  };
}

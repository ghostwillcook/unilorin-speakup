import { Inter, Plus_Jakarta_Sans } from "next/font/google";

/**
 * Landing-page typography, kept separate from the app's system fonts.
 *
 * The landing page follows the Wollo design language (see the .wl- layer in
 * globals.css), which calls for a geometric sans at heavy weights for headings
 * and a neutral geometric sans for body copy. The consoles deliberately keep
 * the Segoe UI stack — this is a landing-page-only choice, which is why the
 * variables are consumed by .wl-page rather than by anything global.
 *
 * Both families self-host through next/font: no runtime request to Google,
 * no layout shift after hydration, and the build works offline once the
 * font files are cached in .next/cache.
 */
export const wlDisplay = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--wl-display",
  display: "swap",
});

export const wlBody = Inter({
  subsets: ["latin"],
  variable: "--wl-body",
  display: "swap",
});

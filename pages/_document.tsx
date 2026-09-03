import { Head, Html, Main, NextScript } from "next/document";

/**
 * Custom document exists for two reasons:
 *
 * 1. The motion layer starts elements at `opacity: 0` and reveals them once
 *    an IntersectionObserver fires. If the JS bundle fails to load, that
 *    reveal never happens and the page would render blank. The noscript
 *    block below restores every animated element to its final state, so the
 *    content survives without scripting.
 *
 * 2. Favicon links. These belong in _document (not per-page Head components)
 *    because they are identical on every page and Next would otherwise
 *    deduplicate or reorder them unpredictably. favicon.ico covers browser
 *    tabs; the PNG sizes cover Android chrome, Windows tiles, and Apple
 *    touch icons (180px). The theme-color matches the landing page's violet.
 */
export default function MyDocument() {
  return (
    <Html lang="en">
      <Head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/favicon-180.png" />
        <meta name="theme-color" content="#10026F" />
        <noscript>
          <style
            dangerouslySetInnerHTML={{
              __html: `
                .reveal, .line-inner, .rotator-word, .slide-panel {
                  opacity: 1 !important;
                  transform: none !important;
                }
                .marquee-track { animation: none !important; }
                .rotator-ghost { display: none !important; }
                .rotator-word { position: static !important; }
              `,
            }}
          />
        </noscript>
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

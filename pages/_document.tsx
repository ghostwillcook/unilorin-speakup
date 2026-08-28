import { Head, Html, Main, NextScript } from "next/document";

/**
 * Custom document exists for one reason: the motion layer starts elements at
 * `opacity: 0` and reveals them once an IntersectionObserver fires. If the JS
 * bundle fails to load, that reveal never happens and the page would render
 * blank. The noscript block below restores every animated element to its
 * final state, so the content survives without scripting.
 */
export default function MyDocument() {
  return (
    <Html lang="en">
      <Head>
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

import Head from "next/head";
import Link from "next/link";

import { UnilorinLogo, SpeakUpWordmark } from "@/components/Logo";
import {
  HeartShape,
  MegaphoneShape,
  ParallaxObject,
  ShieldShape,
  SpeechBubbleShape,
} from "@/components/landing/Shapes";
import { Reveal, Stagger } from "@/components/Motion";
import { wlBody, wlDisplay } from "@/lib/fonts";

/**
 * The welcome page — the bridge between the landing page and sign-in.
 *
 * Flow: Landing ("Get started") → HERE → ("Sign in" pill) → /auth/signin.
 *
 * A student who tapped "Get started" has shown intent but hasn't committed
 * to typing credentials yet. This page rewards that tap with the same visual
 * energy they just saw — the Wollo diorama, the floating clay objects, the
 * violet pill buttons — while delivering the Dean's welcome message for the
 * new academic session. The sign-in action is a floating pill at the bottom
 * of the hero: always reachable, never pushy, styled exactly like the
 * landing page's primary CTA so the visual thread is unbroken from first
 * tap to sign-in form.
 *
 * Still intentionally static, like the landing page: no session, no fetch,
 * no socket. Nothing here can fail on a missing backend.
 */

const WHAT_YOU_GET = [
  {
    n: "01",
    tag: "Complaints",
    title: "A record that follows through",
    body: "Lodge it once with evidence attached. Watch it move from pending to resolved — and talk it through with the Unit in the same thread.",
  },
  {
    n: "02",
    tag: "Messages",
    title: "A private line to the Unit",
    body: "Not everything needs a form. Message the Student Affairs Unit directly, and your conversation stays yours — no other student ever sees it.",
  },
  {
    n: "03",
    tag: "Community",
    title: "A room where you&apos;re a number",
    body: "The anonymous room lets you talk with other students about what's happening on campus — as Anonymous #42, never as you.",
  },
];

export default function WelcomePage() {
  return (
    <>
      <Head>
        <title>Welcome · UNILORIN SpeakUp</title>
        <meta
          name="description"
          content="Welcome to the 2026/2027 Academic Session. Every student deserves to be heard. Sign in to SpeakUp."
        />
      </Head>

      <div
        className={`wl-page flex min-h-screen flex-col ${wlDisplay.variable} ${wlBody.variable}`}
      >
        {/* Slim header — the landing page's bar minus the nav links (this page
            has nowhere else to go but forward or back). */}
        <header className="wl-header sticky top-0 z-20">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-2.5 sm:py-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <UnilorinLogo size={34} />
              <span className="ml-0.5 text-sm sm:ml-1 sm:text-lg">
                <SpeakUpWordmark />
              </span>
            </div>
            <Link href="/" className="wl-btn-ghost">
              ← Back
            </Link>
          </div>
        </header>

        <main className="flex-1">
          {/* Hero diorama — the Wollo violet container carrying the Dean's
              welcome message and the sign-in pill floater. */}
          <section className="mx-auto w-full max-w-6xl px-5 pb-10 pt-8 sm:pt-12">
            <div className="wl-hero wl-on-violet relative px-4 py-16 text-center sm:px-12 sm:py-20">
              {/* Floating objects — same shapes, same parallax speeds as the
                  landing hero, so the visual language is one voice. */}
              <ParallaxObject
                speed={0.3}
                className="absolute -left-6 top-8 hidden w-20 md:block lg:-left-10 lg:w-24"
              >
                <span
                  className="wl-float block"
                  style={{ "--wl-tilt": "-10deg" } as React.CSSProperties}
                >
                  <SpeechBubbleShape className="block h-auto w-full drop-shadow-[0_24px_48px_rgba(16,2,111,0.35)]" />
                </span>
              </ParallaxObject>

              <ParallaxObject
                speed={0.18}
                className="absolute -right-8 top-6 hidden w-20 md:block lg:-right-12 lg:w-28"
              >
                <span
                  className="wl-float wl-float-slow block"
                  style={{ "--wl-tilt": "12deg" } as React.CSSProperties}
                >
                  <MegaphoneShape className="block h-auto w-full drop-shadow-[0_24px_48px_rgba(16,2,111,0.35)]" />
                </span>
              </ParallaxObject>

              <ParallaxObject
                speed={0.24}
                className="absolute -bottom-6 left-10 hidden w-14 lg:block"
              >
                <span
                  className="wl-float wl-float-slow block"
                  style={{ "--wl-tilt": "-6deg" } as React.CSSProperties}
                >
                  <HeartShape className="block h-auto w-full drop-shadow-[0_24px_48px_rgba(16,2,111,0.35)]" />
                </span>
              </ParallaxObject>

              <ParallaxObject
                speed={0.32}
                className="absolute -bottom-8 right-12 hidden w-18 lg:block"
              >
                <span
                  className="wl-float block"
                  style={{ "--wl-tilt": "8deg" } as React.CSSProperties}
                >
                  <ShieldShape className="block h-auto w-full drop-shadow-[0_24px_48px_rgba(16,2,111,0.35)]" />
                </span>
              </ParallaxObject>

              <div className="relative mx-auto max-w-2xl">
                <Reveal>
                  <span className="wl-kicker justify-center">
                    <span className="wl-kicker-dot" aria-hidden="true" />
                    2026/2027 Academic Session
                  </span>
                </Reveal>

                {/* The Dean's welcome message — delivered verbatim, typeset in
                    the hero's display weight so it reads as an address, not
                    body copy. */}
                <Reveal delay={120}>
                  <p className="mt-6 text-lg font-medium text-white/70 sm:text-xl">
                    Dear Students,
                  </p>
                </Reveal>

                <h1 className="wl-display mt-4 text-[clamp(2.25rem,6vw,4.5rem)] text-white">
                  Welcome to a New Session
                </h1>

                <Reveal delay={200}>
                  <p className="mx-auto mt-6 max-w-lg text-base leading-relaxed text-white/80 sm:text-lg">
                    At Student Affairs, every student deserves to be heard.
                    This platform gives you a space to share your concerns,
                    ideas, and experiences.
                  </p>
                </Reveal>

                <Reveal delay={280}>
                  <p className="wl-display mt-6 text-[clamp(1.25rem,3vw,2rem)] font-bold text-white">
                    Speak up. Be heard. Be part of the change.
                  </p>
                </Reveal>

                {/* The pill floater — the page's single primary action, styled
                    exactly like the landing page's CTA (white pill on violet)
                    so the visual thread from "Get started" to the sign-in form
                    never breaks. */}
                <Reveal delay={360}>
                  <div className="mt-10 flex flex-col items-center gap-3">
                    <Link
                      href="/auth/signin"
                      className="group inline-flex items-center gap-3 rounded-full bg-white px-8 py-4 text-base font-bold text-[var(--wl-violet)] shadow-[0_24px_48px_rgb(16_2_111/0.3)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_32px_64px_rgb(16_2_111/0.4)]"
                    >
                      Sign in to continue
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        className="transition-transform duration-200 group-hover:translate-x-1"
                      >
                        <path
                          d="M5 12h14M13 6l6 6-6 6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </svg>
                    </Link>
                    <p className="text-sm text-white/60">
                      Use your UNILORIN email and password
                    </p>
                  </div>
                </Reveal>

                {/* Sign-off: the Unit collectively, not an individual's name. */}
                <Reveal delay={440}>
                  <div className="mt-12 border-t border-white/20 pt-6">
                    <p className="text-sm font-bold text-white/90">
                      Student Affairs
                    </p>
                  </div>
                </Reveal>
              </div>
            </div>
          </section>

          {/* Three-beat feature grid — the numbered saturated cards from the
              landing page, now answering "what am I signing up for?" */}
          <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-6">
            <Reveal>
              <h2 className="wl-h2 text-center">
                Three things you get the moment you&apos;re in
              </h2>
            </Reveal>

            <Stagger step={100} className="mt-10 grid gap-5 md:grid-cols-3">
              {WHAT_YOU_GET.map((item) => (
                <article
                  key={item.n}
                  className={`wl-feature ${item.n === "01" ? "wl-feature-1" : item.n === "02" ? "wl-feature-2" : "wl-feature-3"}`}
                >
                  <span className="wl-feature-tag">{item.tag}</span>
                  <h3 className="wl-h3 mt-4 text-xl text-white">{item.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-white/85">
                    {item.body}
                  </p>
                  <span className="wl-feature-num mt-auto pt-6" aria-hidden="true">
                    {item.n}
                  </span>
                </article>
              ))}
            </Stagger>
          </section>

          {/* Trust strip — a quiet line before the sign-in pill repeats at
              the bottom for anyone who scrolled. */}
          <section className="mx-auto w-full max-w-3xl px-5 pb-24 text-center">
            <Reveal>
              <p className="text-sm leading-relaxed text-[var(--wl-grey)]">
                Your name is never shown to other students. Accounts are issued
                by the Student Affairs Unit — if you don&apos;t have one yet, visit
                the office or check your UNILORIN email.
              </p>
              <div className="mt-6">
                <Link
                  href="/auth/signin"
                  className="wl-btn-violet inline-flex items-center gap-2"
                >
                  Sign in
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M5 12h14M13 6l6 6-6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                </Link>
              </div>
            </Reveal>
          </section>
        </main>
      </div>
    </>
  );
}

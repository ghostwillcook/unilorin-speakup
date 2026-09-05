import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { UnilorinLogo, SpeakUpWordmark } from "@/components/Logo";
import { Marquee, Reveal, Stagger, WordLines } from "@/components/Motion";
import CountUp from "@/components/landing/CountUp";
import Faq from "@/components/landing/Faq";
import {
  HeartShape,
  MegaphoneShape,
  ParallaxObject,
  RingShape,
  ShieldShape,
  SphereShape,
  SpeechBubbleShape,
} from "@/components/landing/Shapes";
import { wlBody, wlDisplay } from "@/lib/fonts";
import { useHeaderFold } from "@/lib/useHeaderFold";

/**
 * Landing page — Wollo design language.
 *
 * Still intentionally static: no session hook, no data fetch, no socket. The
 * spec requires this page to be complete on `npm run dev` before the database
 * or socket server exist, so nothing here can fail on a missing backend.
 *
 * The visual system (.wl- classes in globals.css) is scoped to this page via
 * .wl-page; the student and admin consoles keep the app's original design.
 * Section anchors (#complaints, #chat, #how-it-works) are preserved from the
 * previous landing page so inbound links keep resolving.
 */
export default function Home() {
  return (
    <>
      <Head>
        <title>UNILORIN Student Connect — Student Affairs Unit</title>
        <meta
          name="description"
          content="Report an issue to the University of Ilorin Student Affairs Unit, or talk to other students under a pseudonym."
        />
      </Head>

      <div
        className={`wl-page flex min-h-screen flex-col ${wlDisplay.variable} ${wlBody.variable}`}
      >
        <SiteHeader />

        <main className="flex-1">
          <Hero />
          <TickerBand />
          <BentoGrid />
          <NumberedFeatures />
          <StatsBand />
          <CategoryMasonry />
          <VisitTheUnit />
          <FaqSection />
          <CtaBanner />
        </main>

        <SiteFooter />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* Header                                                                     */
/* ------------------------------------------------------------------------- */

const NAV = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Complaints", href: "#complaints" },
  { label: "Live chat", href: "#chat" },
  { label: "FAQ", href: "#faq" },
];

function SiteHeader() {
  // The section links exist only in the desktop bar otherwise; on phones this
  // disclosure keeps them reachable. It closes on link tap, the one navigation
  // gesture a phone user makes here.
  const [open, setOpen] = useState(false);

  // Fold the bar away on scroll down, bring it back on scroll up — phones
  // only, where the bar costs a meaningful slice of viewport. The breakpoint
  // and scroll mechanics live in useHeaderFold; an open menu pins the bar.
  const folded = useHeaderFold({ pinned: open });

  return (
    <header
      className={`wl-header sticky top-0 z-20 ${folded ? "wl-header-hidden" : ""}`}
    >
      {/* gap-2 rather than gap-3: on a phone the logo, wordmark and CTA are
          one visual group; the desktop breathing room is whitespace the narrow
          bar cannot spare. py-2.5 for the same reason. */}
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-5 py-2.5 sm:gap-4 sm:py-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <UnilorinLogo size={34} />
          <span className="ml-0.5 text-sm sm:ml-1 sm:text-lg">
            <SpeakUpWordmark />
          </span>
        </div>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Sections">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className="wl-nav-link">
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1 sm:gap-1.5">
          {/* Hidden below md rather than sm: at 640-768px the bar would
              otherwise wrap the ghost link or crowd the CTA. The hamburger's
              menu carries Log in there. Both CTAs route through /welcome so
              every visitor sees the Dean's message before the form. */}
          <Link href="/welcome" className="wl-btn-ghost hidden md:inline-flex">
            Log in
          </Link>
          <Link href="/welcome" className="wl-btn-violet whitespace-nowrap">
            Get started
          </Link>

          <button
            type="button"
            className="wl-btn-ghost -mr-2 p-2 md:hidden"
            aria-expanded={open}
            aria-controls="wl-mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {/* Two bars, not three: it reads as "menu" without a third stroke
                competing with the logo at this size. */}
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 15h16"}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav
          id="wl-mobile-nav"
          aria-label="Sections"
          className="border-t border-[rgb(16_2_111/0.07)] px-5 pb-4 pt-2 md:hidden"
        >
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="wl-nav-link block py-2.5 text-base"
              onClick={() => setOpen(false)}
            >
              {item.label}
            </a>
          ))}
          <Link
            href="/welcome"
            className="wl-nav-link block py-2.5 text-base"
            onClick={() => setOpen(false)}
          >
            Log in
          </Link>
        </nav>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------------- */
/* Hero diorama                                                               */
/* ------------------------------------------------------------------------- */

/**
 * The violet container with floating matte objects. Objects are absolutely
 * positioned and deliberately overhang the frame (negative insets), which is
 * the Z-axis depth the Wollo hero is built on; `overflow: visible` on .wl-hero
 * is what permits it.
 *
 * Each object is ParallaxObject (scroll translation, spec speed 0.3) wrapping
 * a .wl-shape carrying the idle float animation — separate elements so the
 * transforms compose instead of conflict.
 */
function Hero() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 pb-10 pt-10 sm:pt-14">
      {/* px-4 on phones: the kicker is nowrap at this width, and every
          horizontal millimetre is text that no longer has to break. */}
      <div className="wl-hero wl-on-violet px-4 py-16 text-center sm:px-12 sm:py-24">
        {/* Floating objects — hidden below md where they would collide with the
            headline rather than frame it. */}
        <ParallaxObject
          speed={0.3}
          className="absolute -left-6 top-10 hidden w-24 md:block lg:-left-10 lg:w-28"
        >
          <span className="wl-float block" style={{ "--wl-tilt": "-10deg" } as React.CSSProperties}>
            <SpeechBubbleShape className="block h-auto w-full drop-shadow-[0_24px_48px_rgba(16,2,111,0.35)]" />
          </span>
        </ParallaxObject>

        <ParallaxObject
          speed={0.18}
          className="absolute -right-8 top-6 hidden w-24 md:block lg:-right-14 lg:w-32"
        >
          <span className="wl-float wl-float-slow block" style={{ "--wl-tilt": "12deg" } as React.CSSProperties}>
            <MegaphoneShape className="block h-auto w-full drop-shadow-[0_24px_48px_rgba(16,2,111,0.35)]" />
          </span>
        </ParallaxObject>

        <ParallaxObject
          speed={0.24}
          className="absolute -bottom-8 left-8 hidden w-16 lg:block"
        >
          <span className="wl-float wl-float-slow block" style={{ "--wl-tilt": "-6deg" } as React.CSSProperties}>
            <HeartShape className="block h-auto w-full drop-shadow-[0_24px_48px_rgba(16,2,111,0.35)]" />
          </span>
        </ParallaxObject>

        <ParallaxObject
          speed={0.32}
          className="absolute -bottom-10 right-14 hidden w-20 lg:block"
        >
          <span className="wl-float block" style={{ "--wl-tilt": "8deg" } as React.CSSProperties}>
            <ShieldShape className="block h-auto w-full drop-shadow-[0_24px_48px_rgba(16,2,111,0.35)]" />
          </span>
        </ParallaxObject>

        {/* The campus, framed as one more floating object — a small window into
            the place this platform exists for, breaking the frame on the right. */}
        <ParallaxObject
          speed={0.12}
          className="absolute -right-6 bottom-16 hidden w-36 rotate-3 lg:block"
        >
          <span className="wl-float block rounded-2xl">
            <Image
              src="/campus-hero.webp"
              alt=""
              aria-hidden="true"
              width={288}
              height={216}
              className="h-auto w-full rounded-2xl border-4 border-white/90 object-cover shadow-[0_24px_48px_rgba(16,2,111,0.35)]"
            />
          </span>
        </ParallaxObject>

        <div className="relative mx-auto max-w-3xl">
          <Reveal>
            {/* max-w-none at this level: the kicker inside is nowrap, and a
                centered constrained wrapper would let it overflow visually
                rather than be measured against the true container width. */}
            <span className="wl-kicker justify-center max-w-none">
              <span className="wl-kicker-dot" aria-hidden="true" />
              University of Ilorin · Student Affairs Unit
            </span>
          </Reveal>

          <h1 className="wl-display mt-7 text-[clamp(2.5rem,7vw,5.5rem)] text-white">
            {/* Plain string lines: the whole headline uses the display face —
                the italic-serif accent experiment was reverted per owner
                feedback (the grotesque alone reads better). */}
            <WordLines lines={["UNILORIN", "Student Connect."]} />
          </h1>

          <Reveal delay={140}>
            <p className="mx-auto mt-7 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg">
              Be Involved. Stay Informed. Speak Up, Make Change.
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/welcome"
                className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-[0.9375rem] font-bold text-[var(--wl-violet)] shadow-[0_24px_48px_rgb(16_2_111/0.28)] transition-transform duration-150 hover:-translate-y-0.5"
              >
                Get started
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
              <a href="#how-it-works" className="wl-btn-outline">
                See how it works
              </a>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Ticker                                                                     */
/* ------------------------------------------------------------------------- */

function TickerBand() {
  return (
    <div className="wl-band py-4">
      <Marquee
        items={[
          "Anonymous to other students",
          "A status you can follow",
          "A reply you can read",
          "Direct line to Student Affairs",
          "Evidence stays private",
        ]}
        seconds={30}
        className="text-sm font-semibold"
      />
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Bento grid                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Four product-truth cards in the Wollo bento pattern: tag pills on soft grey,
 * a status journey, and small UI mocks. Everything shown is a real feature of
 * the app, described rather than exaggerated.
 */
function BentoGrid() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-20 sm:py-24">
      <Reveal>
        <span className="wl-kicker">
          <span className="wl-kicker-dot" aria-hidden="true" />
          Everything on one record
        </span>
        <h2 className="wl-h2 mt-4 max-w-2xl">
          From the moment you raise it to the moment it&apos;s resolved.
        </h2>
      </Reveal>

      {/* gap-6 rather than gap-5: the cards' shadow halos are ~24px, and a
          20px gap let adjacent halos overlap into a continuous bridge — the
          "blobbed together" glass look. 24px keeps each card's shadow inside
          its own cell. */}
      <Stagger step={100} className="mt-12 grid gap-6 lg:grid-cols-3">
        {/* Status journey — the widest card, because it is the core promise. */}
        <div className="wl-card wl-card-hover scroll-mt-24 p-7 lg:col-span-2" id="complaints">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="wl-h3 text-xl">Follow your complaint</h3>
            <div className="flex items-center gap-1.5" aria-hidden="true">
              <span className="wl-pill wl-pill-grey">This week</span>
              <span className="wl-pill wl-pill-white">This month</span>
              <span className="wl-pill wl-pill-grey">This term</span>
            </div>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[rgb(17_12_30/0.66)]">
            Every complaint moves through a status you can check any time — and
            the Unit&apos;s reply lands on the same thread.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <span className="wl-pill wl-pill-yellow">Pending</span>
            <span className="h-px w-6 bg-[var(--wl-rule)]" aria-hidden="true" />
            <span className="wl-pill wl-pill-grey">In review</span>
            <span className="h-px w-6 bg-[var(--wl-rule)]" aria-hidden="true" />
            <span className="wl-pill wl-pill-violet">Resolved</span>
          </div>

          <div className="mt-8 rounded-2xl bg-[rgb(186_186_194/0.14)] p-5">
            <p className="text-sm font-semibold text-[rgb(17_12_30/0.8)]">
              No water supply in Amina Hostel Block C
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="wl-pill wl-pill-white text-xs">water.jpg</span>
              <span className="wl-pill wl-pill-white text-xs">receipt.pdf</span>
              <span className="wl-pill wl-pill-grey text-xs">3 days ago</span>
            </div>
          </div>
        </div>

        {/* Anonymous chat */}
        <div className="wl-card wl-card-hover scroll-mt-24 p-7" id="chat">
          <h3 className="wl-h3 text-xl">Anonymous by default</h3>
          <p className="mt-3 text-sm leading-relaxed text-[rgb(17_12_30/0.66)]">
            In the anonymous room you are a number, never a name — to other students,
            always.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <span className="wl-pill wl-pill-grey">Anonymous #42</span>
            <span className="wl-pill wl-pill-grey">Anonymous #17</span>
            <span className="wl-pill wl-pill-violet">Student Affairs</span>
          </div>
          <div className="mt-6 space-y-2.5">
            <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-[rgb(186_186_194/0.18)] px-4 py-2.5 text-sm">
              Has anyone else lost water in Block C?
            </div>
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[var(--wl-violet)] px-4 py-2.5 text-sm text-white">
              The Works Unit is fitting a pump today.
            </div>
          </div>
        </div>

        {/* Evidence */}
        <div className="wl-card wl-card-hover p-7">
          <h3 className="wl-h3 text-xl">Evidence, kept private</h3>
          <p className="mt-3 text-sm leading-relaxed text-[rgb(17_12_30/0.66)]">
            Attach up to five files per complaint. They sit in a private store —
            links are short-lived and issued only to you.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <span className="wl-pill wl-pill-white w-fit">
              <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" fill="none" />
              </svg>
              photo-of-leak.jpg
            </span>
            <span className="wl-pill wl-pill-white w-fit">
              <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" fill="none" />
              </svg>
              warden-note.pdf
            </span>
          </div>
        </div>

        {/* DM — white type on violet: the Unit's own channel, not another
            white panel. No label chips; the arrow says it plainly. */}
        <div className="wl-card-dark wl-card-hover p-7 lg:col-span-2">
          <h3 className="wl-h3 text-xl">A direct line to the Unit</h3>
          <p className="mt-3 text-sm leading-relaxed text-white/80">
            Not everything needs a formal complaint. Message the Student
            Affairs Unit privately and keep the whole conversation in one
            place.
          </p>
          <p className="mt-6 flex items-center gap-3 text-sm font-semibold text-white">
            You
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M7 10h8M9 6.5 5.5 10 9 13.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity="0.7"
              />
              <path
                d="M17 14H9M15 17.5 18.5 14 15 10.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity="0.7"
              />
            </svg>
            Student Affairs
          </p>
        </div>
      </Stagger>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Numbered features — How it works                                           */
/* ------------------------------------------------------------------------- */

function NumberedFeatures() {
  const steps = [
    {
      n: "01",
      tag: "Account",
      title: "Sign in",
      body: "Use your UNILORIN email, student ID and password. Only registered students can post.",
      cls: "wl-feature-1",
    },
    {
      n: "02",
      tag: "Report",
      title: "Say what happened",
      body: "Lodge a complaint, message the Unit privately, or talk it over with peers in the anonymous room.",
      cls: "wl-feature-2",
    },
    {
      n: "03",
      tag: "Resolution",
      title: "Follow it through",
      body: "Watch the status change as the Unit reviews your report, and read their reply when it lands.",
      cls: "wl-feature-3",
    },
  ];

  return (
    <section id="how-it-works" className="mx-auto w-full max-w-6xl scroll-mt-24 px-5 pb-20 sm:pb-24">
      <Reveal>
        <span className="wl-kicker">
          <span className="wl-kicker-dot" aria-hidden="true" />
          How it works
        </span>
        <h2 className="wl-h2 mt-4 max-w-2xl">
          Three steps, start to resolution.
        </h2>
      </Reveal>

      <Stagger step={100} className="mt-12 grid gap-6 md:grid-cols-3">
        {steps.map((s) => (
          <article key={s.n} className={`wl-feature ${s.cls}`}>
            <span className="wl-feature-tag">{s.tag}</span>
            <h3 className="wl-h3 mt-5 text-2xl text-white">{s.title}</h3>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/85">
              {s.body}
            </p>
            <span className="wl-feature-num mt-auto pt-6" aria-hidden="true">
              {s.n}
            </span>
            <Link
              href="/auth/signin"
              className="wl-feature-arrow"
              aria-label={`${s.title} — sign in to continue`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
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
          </article>
        ))}
      </Stagger>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Stats                                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Count-up metric cards. The figures are structural facts of the platform —
 * ways to raise something, anonymity to other students, hours of access —
 * rather than invented usage statistics, which the app has no basis to claim.
 */
function StatsBand() {
  const stats = [
    {
      value: 3,
      suffix: "",
      badge: "Ways to raise it",
      badgeCls: "bg-[var(--wl-yellow)] text-[var(--wl-ink)]",
      caption: "A complaint, a private message, or the anonymous room.",
    },
    {
      value: 100,
      suffix: "%",
      badge: "Anonymous to students",
      badgeCls: "bg-[var(--wl-pink)] text-white",
      caption: "In the anonymous room you are a pseudonym, never a name.",
    },
    {
      value: 24,
      suffix: "/7",
      badge: "Open online",
      badgeCls: "bg-[var(--wl-purple)] text-white",
      caption: "Raise it at 2am the same as at noon.",
    },
  ];

  return (
    <section className="mx-auto w-full max-w-6xl px-5 pb-20 sm:pb-24">
      <Stagger step={100} className="grid gap-6 md:grid-cols-3">
        {stats.map((s) => (
          <div key={s.badge} className="wl-card wl-card-hover p-7">
            <span className={`wl-badge-angle ${s.badgeCls}`}>{s.badge}</span>
            <CountUp
              value={s.value}
              suffix={s.suffix}
              className="wl-stat-value mt-5 block"
            />
            <p className="mt-3 text-sm leading-relaxed text-[rgb(17_12_30/0.66)]">
              {s.caption}
            </p>
          </div>
        ))}
      </Stagger>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Category masonry                                                           */
/* ------------------------------------------------------------------------- */

/** What students actually raise, in the Wollo testimonial-masonry layout.
 *  CSS columns give the staggered heights without a masonry library. */
function CategoryMasonry() {
  const categories = [
    // Harassment and assault lead the list on purpose: they are the most
    // serious things a student can raise, and the masonry order is the order
    // a skim reads, so they must be the first two cards seen.
    {
      title: "Harassment",
      body: "Harassment of any kind — from staff, students, or anyone else — belongs here. Report it, and it will be handled with care.",
      chips: ["Harassment", "Confidential"],
    },
    {
      title: "Assault",
      body: "Physical or sexual assault. These reports reach the Unit directly and are treated with priority.",
      chips: ["Assault", "Priority"],
    },
    {
      title: "Hostels & facilities",
      body: "Water supply, broken sockets, unsafe fittings — the things you live with every day.",
      chips: ["Water", "Electrical", "Maintenance"],
    },
    {
      title: "Results & academics",
      body: "Missing grades, portal problems, anything holding up your CGPA.",
      chips: ["Missing results", "Portal"],
    },
    {
      title: "Safety & wellbeing",
      body: "Concerns you want on the record, handled with care and followed to a resolution.",
      chips: ["Safety", "Wellbeing"],
    },
    {
      title: "Transport & charges",
      body: "Shuttle overcharging at the gate, fares above the posted rate, fare boards gone missing.",
      chips: ["Transport", "Fares"],
    },
    {
      title: "Fees & documents",
      body: "Payment issues, transcripts, clearance — when the paperwork is the problem.",
      chips: ["Fees", "Documents"],
    },
  ];

  return (
    <section className="mx-auto w-full max-w-6xl px-5 pb-20 sm:pb-24">
      <Reveal>
        <span className="wl-kicker">
          <span className="wl-kicker-dot" aria-hidden="true" />
          What students raise
        </span>
        <h2 className="wl-h2 mt-4 max-w-2xl">
          If it affects student life, it belongs here.
        </h2>
      </Reveal>

      {/* gap-6 + mb-6, same reasoning as the bento grid above: measured on a
          390px viewport, the old 20px spacing let each card's shadow halo
          (≈22px reach) bridge to the next, so the seven stacked cards read
          as one connected glass chain. */}
      <div className="mt-12 columns-1 gap-6 sm:columns-2 lg:columns-3">
        {categories.map((c, i) => (
          <Reveal key={c.title} delay={i * 60} className="mb-6 break-inside-avoid">
            <div className="wl-card wl-card-hover p-6">
              <h3 className="wl-h3 text-lg">{c.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-[rgb(17_12_30/0.66)]">
                {c.body}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {c.chips.map((chip) => (
                  <span key={chip} className="wl-pill wl-pill-grey text-xs">
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Visit the Unit                                                             */
/* ------------------------------------------------------------------------- */

/**
 * The Unit's own front door — kept from the previous landing page, restyled.
 *
 * Student Connect is a way in to the office, not a replacement for it, so a student
 * should be able to recognise the building before walking across campus to it.
 *
 * NOTE: the Unit has confirmed its hours — Monday to Friday until 18:00, with
 * weekend availability on a published schedule. If the schedule changes, this
 * page should follow it: a wrong closing time sends someone over for nothing.
 */
const VISIT_DETAILS = [
  {
    label: "Where",
    lines: [
      "Student Affairs Unit",
      "University of Ilorin, Main Campus",
      "Ilorin, Kwara State",
    ],
  },
  {
    label: "Postal",
    lines: ["PMB 1515, Ilorin", "Kwara State, Nigeria"],
  },
  {
    label: "Open",
    lines: ["Monday – Friday", "8:00 – 18:00", "Weekends on schedule"],
  },
];

function VisitTheUnit() {
  return (
    <section id="visit" className="mx-auto w-full max-w-6xl scroll-mt-24 px-5 pb-20 sm:pb-24">
      <div className="grid items-stretch gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Reveal direction="left" className="h-full">
          <figure className="wl-card h-full p-2.5">
            <div className="relative h-64 overflow-hidden rounded-2xl sm:h-80 lg:h-[24rem]">
              <Image
                src="/student-affairs-entrance.png"
                alt="The entrance to the Student Affairs Unit at the University of Ilorin"
                fill
                sizes="(max-width: 1024px) 100vw, 55vw"
                className="object-cover"
              />
            </div>
            <figcaption className="px-2 pb-1 pt-3 text-xs text-[rgb(17_12_30/0.55)]">
              The Student Affairs Unit, University of Ilorin.
            </figcaption>
          </figure>
        </Reveal>

        <Reveal direction="right" delay={120} className="h-full">
          <div className="wl-card flex h-full flex-col p-7">
            <span className="wl-kicker">
              <span className="wl-kicker-dot" aria-hidden="true" />
              In person
            </span>

            <h2 className="wl-h2 mt-5 text-3xl">Visit the Unit</h2>

            <p className="mt-3 text-sm leading-relaxed text-[rgb(17_12_30/0.66)]">
              Student Connect is the quickest way to put something on record and follow
              it. When you would rather say it face to face, the office is open
              through the week.
            </p>

            <dl className="mt-7 grid gap-5 sm:grid-cols-3">
              {VISIT_DETAILS.map((item) => (
                <div key={item.label}>
                  <dt className="text-xs font-bold uppercase tracking-wider text-[rgb(17_12_30/0.45)]">
                    {item.label}
                  </dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-[rgb(17_12_30/0.8)]">
                    {item.lines.map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>

            {/* mt-auto pins this to the bottom so both panels in the row end on
                the same line however the address wraps. */}
            <div className="mt-auto pt-7">
              <Link href="/auth/signin" className="wl-btn-ghost -ml-2.5">
                Or raise it here instead →
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* FAQ                                                                        */
/* ------------------------------------------------------------------------- */

function FaqSection() {
  const items = [
    {
      q: "Will other students know it's me?",
      a: "No. In the anonymous room you appear only as a pseudonym like Anonymous #42 — your name is never shown to other students. Complaints and private messages carry your identity to the Student Affairs Unit alone, because that is what lets them actually resolve your case.",
    },
    {
      q: "What can I report?",
      a: "Anything that affects student life: hostel conditions, missing results, harassment or assault, safety concerns, overcharging by shuttle operators, problems with fees or documents. If it matters to you, it belongs on the record.",
    },
    {
      q: "What happens after I submit a complaint?",
      a: "Your complaint gets a status — pending, in review, resolved or rejected — that you can check any time. When the Student Affairs Unit responds, their reply lands on the same complaint, so the whole history stays in one place.",
    },
    {
      q: "Can I attach evidence?",
      a: "Yes — up to five files per complaint, 10 MB each. Files are held in a private store; access links are short-lived and issued only to you and the Unit, never to other students.",
    },
    {
      q: "Do I have to be anonymous?",
      a: "You are always anonymous to other students. To the Unit, your complaint carries your name — that is deliberate: it is what allows them to follow up, ask you for details, and close the matter properly.",
    },
  ];

  return (
    <section id="faq" className="mx-auto w-full max-w-3xl scroll-mt-24 px-5 pb-20 sm:pb-24">
      <Reveal>
        <span className="wl-kicker">
          <span className="wl-kicker-dot" aria-hidden="true" />
          Questions
        </span>
        <h2 className="wl-h2 mt-4">Before you speak up.</h2>
      </Reveal>
      <Reveal delay={100} className="mt-10">
        <Faq items={items} />
      </Reveal>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* CTA banner                                                                 */
/* ------------------------------------------------------------------------- */

function CtaBanner() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 pb-24">
      <div className="wl-hero wl-on-violet relative flex flex-col items-start gap-8 overflow-hidden p-10 sm:p-14 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-xl">
          <h2 className="wl-h2 text-white">
            Your voice reaches further here.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/80">
            Sign in with your UNILORIN email, raise what matters, and follow it
            through to the reply.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/welcome"
              className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-[0.9375rem] font-bold text-[var(--wl-violet)] shadow-[0_24px_48px_rgb(16_2_111/0.28)] transition-transform duration-150 hover:-translate-y-0.5"
            >
              Get started
            </Link>
          </div>
        </div>

        {/* Cluster of objects on the open right side; hidden on mobile where
            the banner is a single column and they would sit on the text. */}
        <div className="pointer-events-none relative hidden h-44 w-64 flex-none lg:block" aria-hidden="true">
          <span className="wl-float absolute left-6 top-0 block w-20">
            <SphereShape className="block h-auto w-full drop-shadow-[0_24px_48px_rgba(16,2,111,0.35)]" />
          </span>
          <span className="wl-float wl-float-slow absolute bottom-2 left-16 block w-16">
            <RingShape className="block h-auto w-full drop-shadow-[0_24px_48px_rgba(16,2,111,0.35)]" />
          </span>
          <span className="wl-float absolute right-8 top-8 block w-16">
            <HeartShape className="block h-auto w-full drop-shadow-[0_24px_48px_rgba(16,2,111,0.35)]" />
          </span>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Footer                                                                     */
/* ------------------------------------------------------------------------- */

function SiteFooter() {
  return (
    <footer className="border-t border-[var(--wl-rule)] bg-white/60">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-center sm:flex-row sm:text-left">
        {/* The crest is a bordered disc, which reads heavy next to two stacked
            caption lines — size 24 (smaller than the header's 34) plus a
            wider gap keeps the lockup from feeling fused into one blob. */}
        <div className="flex items-center gap-4">
          <UnilorinLogo size={24} />
          <p className="text-left text-xs leading-relaxed text-[rgb(17_12_30/0.55)]">
            Student Affairs Unit
            <br />
            University of Ilorin, Nigeria
          </p>
        </div>

        <p className="text-xs text-[rgb(17_12_30/0.55)]">
          UNILORIN Student Connect ·{" "}
          <Link
            href="/welcome"
            className="font-semibold text-[var(--wl-violet)] underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </footer>
  );
}

import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import {
  UnilorinLogo,
  StudentAffairsLogo,
  SpeakUpWordmark,
} from "@/components/Logo";
import GlassCard from "@/components/GlassCard";
import { NeonLink } from "@/components/NeonButton";
import {
  Marquee,
  Reveal,
  SplitLines,
  Stagger,
} from "@/components/Motion";

/**
 * Landing page.
 *
 * Intentionally static — no session hook, no data fetch, no socket. The spec
 * requires this page to be complete on `npm run dev` before the database or
 * socket server exist, so nothing here can fail on a missing backend.
 */
export default function Home() {
  return (
    <>
      <Head>
        <title>UNILORIN SpeakUp — Students Affairs Unit</title>
        <meta
          name="description"
          content="Report an issue to the University of Ilorin Students Affairs Unit, or talk to other students under a pseudonym."
        />
      </Head>

      <div className="flex min-h-screen flex-col">
        <SiteHeader />

        <main className="flex-1">
          <Hero />
          <TickerBand />

          <div className="mx-auto w-full max-w-6xl px-5">
            <VisitTheUnit />
            <CtaCards />
          </div>

          <div className="mx-auto w-full max-w-6xl px-5 pb-24">
            <HowItWorks />
          </div>
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
];

function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-3">
        <div className="flex items-center gap-3">
          <UnilorinLogo size={38} />
          <div className="hidden h-8 w-px bg-line sm:block" />
          <div className="hidden sm:block">
            <StudentAffairsLogo size={34} />
          </div>
          <span className="ml-1 text-base sm:text-lg">
            <SpeakUpWordmark />
          </span>
        </div>

        {/* Dot-separated inline nav. The separators are decorative, so they are
            hidden from assistive tech rather than read as list punctuation. */}
        <nav className="hidden items-center gap-3 md:flex">
          {NAV.map((item, i) => (
            <span key={item.href} className="flex items-center gap-3">
              {i > 0 && <span className="dot-sep" aria-hidden="true" />}
              <a href={item.href} className="nav-label">
                {item.label}
              </a>
            </span>
          ))}
        </nav>

        <NeonLink href="/auth/signin">Sign In</NeonLink>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------------- */
/* Hero                                                                      */
/* ------------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="hero-photo flex min-h-[86vh] items-center">
      {/* Decorative: the headline carries the meaning, so the photograph is
          announced to nobody. The white scrim lives in .hero-photo::after. */}
      <Image
        src="/campus-hero.webp"
        alt=""
        aria-hidden="true"
        fill
        priority
        sizes="100vw"
        className="hero-photo-img"
      />

      <div className="hero-photo-content mx-auto w-full max-w-5xl px-5 py-24 text-center">
        <Reveal>
          <span className="eyebrow">
            <span className="eyebrow-icon" aria-hidden="true">
              <span className="pulse-dot" />
            </span>
            <span className="text-drift-soft">
              University of Ilorin · Students Affairs Unit
            </span>
          </span>
        </Reveal>

        {/* Lines are authored rather than measured: SplitLines clips each one
            and raises it, which only works with deliberate breaks. */}
        <h1 className="display mt-8">
          <SplitLines lines={["Speak up.", "Be heard."]} />
        </h1>

        <p className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-muted">
          Report it, follow it, and read the reply. Raise any complaint or issues
          — anonymously if you would rather not be named.
        </p>

        <Reveal delay={140}>
          <div className="mt-10 flex items-center justify-center gap-3">
            <NeonLink href="/auth/signin">Get started</NeonLink>
            <a
              href="#how-it-works"
              className="btn-icon"
              aria-label="See how it works"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M12 5v14M6 13l6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Ticker                                                                    */
/* ------------------------------------------------------------------------- */

function TickerBand() {
  return (
    <div className="border-y border-line bg-raised py-4">
      <Marquee
        items={[
          "Anonymous to other students",
          "A status you can follow",
          "A reply you can read",
          "Direct line to Students Affairs",
          "Evidence stays private",
        ]}
        seconds={30}
        className="text-sm"
      />
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Visit the Unit                                                            */
/* ------------------------------------------------------------------------- */

/**
 * The Unit's own front door.
 *
 * SpeakUp is a way in to the office, not a replacement for it, so a student
 * should be able to recognise the building before walking across campus to it.
 *
 * NOTE: the opening hours below are the standard Nigerian public-service working
 * day, not something the Unit has confirmed. Check them before this page goes in
 * front of students — a wrong closing time sends someone over for nothing.
 */
const VISIT_DETAILS = [
  {
    label: "Where",
    lines: [
      "Students Affairs Unit",
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
    lines: ["Monday – Friday", "8:00 – 16:00"],
  },
];

function VisitTheUnit() {
  return (
    <section id="visit" className="scroll-mt-24 pt-20">
      <div className="grid items-stretch gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Reveal direction="left" className="h-full">
          {/* The photograph is the point, so the panel is only a frame: 10px of
              glass around the image and nothing else competing with it. */}
          <figure className="surface edge-run h-full p-2.5">
            <div className="relative h-64 overflow-hidden rounded-[0.7rem] sm:h-80 lg:h-[24rem]">
              <Image
                src="/student-affairs-entrance.png"
                alt="The entrance to the Students Affairs Unit at the University of Ilorin"
                fill
                sizes="(max-width: 1024px) 100vw, 55vw"
                className="object-cover"
              />
            </div>
            <figcaption className="px-2 pb-1 pt-3 text-xs text-muted">
              The Students Affairs Unit, University of Ilorin.
            </figcaption>
          </figure>
        </Reveal>

        <Reveal direction="right" delay={120} className="h-full">
          <div className="surface edge-run edge-run-delay-1 flex h-full flex-col p-7">
            <span className="eyebrow self-start">
              <span className="eyebrow-icon" aria-hidden="true">
                <span className="pulse-dot" />
              </span>
              <span className="text-drift-soft">In person</span>
            </span>

            <h2 className="display-sm mt-6 text-3xl">
              <span className="text-drift">Visit the Unit</span>
            </h2>

            <p className="mt-3 text-sm leading-relaxed text-muted">
              SpeakUp is the quickest way to put something on record and follow
              it. When you would rather say it face to face, the office is open
              through the week.
            </p>

            <dl className="mt-7 grid gap-5 sm:grid-cols-3">
              {VISIT_DETAILS.map((item) => (
                <div key={item.label}>
                  <dt className="field-label">{item.label}</dt>
                  <dd className="text-sm leading-relaxed text-graphite">
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
              <NeonLink href="/auth/signin" variant="ghost">
                Or raise it here instead
              </NeonLink>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Cards                                                                     */
/* ------------------------------------------------------------------------- */

function CtaCards() {
  return (
    <Stagger step={90} className="grid gap-5 py-20 sm:grid-cols-2">
      <GlassCard hover className="edge-run h-full scroll-mt-24 p-7" id="complaints">
        <CardIcon>
          <path
            d="M4 5h16v11H8l-4 4V5Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            fill="none"
          />
          <path
            d="M8 9h8M8 12.5h5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </CardIcon>

        <h2 className="display-sm mt-5 text-2xl">
          <span className="text-drift">Lodge a Complaint</span>
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Describe what happened, attach evidence if you have it, and track the
          status from pending through to resolved — with the Unit&apos;s reply
          attached.
        </p>
        <div className="mt-7">
          <NeonLink href="/auth/signin">Submit a complaint</NeonLink>
        </div>
      </GlassCard>

      <GlassCard
        hover
        className="edge-run edge-run-delay-2 h-full scroll-mt-24 p-7"
        id="chat"
      >
        <CardIcon>
          <circle
            cx="12"
            cy="8.5"
            r="3.5"
            stroke="currentColor"
            strokeWidth="1.6"
            fill="none"
          />
          <path
            d="M4.5 20a7.5 7.5 0 0 1 15 0"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
        </CardIcon>

        <h2 className="display-sm mt-5 text-2xl">
          <span className="text-drift">Join the Live Chat</span>
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Talk with other students in real time as{" "}
          <span className="font-mono text-accent">Anonymous #42</span>. Your name
          is never shown to other students.
        </p>
        <div className="mt-7">
          <NeonLink href="/auth/signin" variant="ghost">
            Enter the chat
          </NeonLink>
        </div>
      </GlassCard>
    </Stagger>
  );
}

function CardIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-veil text-graphite">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        {children}
      </svg>
    </span>
  );
}

/* ------------------------------------------------------------------------- */
/* How it works                                                              */
/* ------------------------------------------------------------------------- */

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Sign in",
      body: "Use your UNILORIN email, student ID and password. Only registered students can post.",
    },
    {
      n: "02",
      title: "Say what happened",
      body: "Lodge a complaint, message Student Affairs privately, or raise it with peers in the live chat.",
    },
    {
      n: "03",
      title: "Follow it through",
      body: "Watch the status change as the Unit reviews your report, and read their reply when it lands.",
    },
  ];

  return (
    <section id="how-it-works" className="scroll-mt-24 pt-24">
      <Reveal>
        <h2 className="display-sm text-center">
          <span className="text-drift">How it works</span>
        </h2>
      </Reveal>

      <Stagger step={90} className="mt-12 grid gap-5 sm:grid-cols-3">
        {steps.map((s, i) => (
          <div
            key={s.n}
            className={`surface-glass edge-run h-full p-6 ${
              i === 1 ? "edge-run-delay-1" : i === 2 ? "edge-run-delay-2" : ""
            }`}
          >
            <span className="font-mono text-xs font-bold text-accent">
              {s.n}
            </span>
            <h3 className="mt-2 text-lg font-semibold text-graphite">
              {s.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
          </div>
        ))}
      </Stagger>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Footer                                                                    */
/* ------------------------------------------------------------------------- */

function SiteFooter() {
  return (
    <footer className="border-t border-line bg-raised">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-center sm:flex-row sm:text-left">
        <div className="flex items-center gap-3">
          <UnilorinLogo size={30} />
          <p className="text-xs leading-relaxed text-muted">
            Students Affairs Unit
            <br />
            University of Ilorin, Nigeria
          </p>
        </div>

        <p className="text-xs text-muted">
          UNILORIN SpeakUp ·{" "}
          <Link
            href="/auth/signin"
            className="text-graphite underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </footer>
  );
}

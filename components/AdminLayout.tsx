import type { ReactNode } from "react";
import Head from "next/head";

import AdminSidebar from "@/components/AdminSidebar";

/**
 * The admin shell.
 *
 * Every page under /admin renders through this, so the sidebar, document title
 * pattern and page-heading rhythm are declared exactly once. A page then only
 * has to describe its own content — which is why adding an admin screen means
 * writing a panel, not another layout.
 *
 * Deliberately inert: no fetching, no session read, no guard. Each admin page
 * gates itself in getServerSideProps, and a layout that also checked would put
 * two answers to one question in the tree.
 */
export default function AdminLayout({
  title,
  subtitle,
  children,
  right,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Header-level actions: filters, refresh, status pills. */
  right?: ReactNode;
}) {
  return (
    <>
      <Head>
        <title>{`${title} · SpeakUp Admin`}</title>
      </Head>

      <AdminSidebar />

      {/* The sidebar chrome is fixed at every breakpoint, so the space it
          occupies has to be reserved here — pt-14 clears the mobile bar,
          lg:pl-72 clears the desktop rail (both track the sidebar's own
          h-14 / w-72), and pb-32 on main clears the floating dock (and its
          sheet) at the bottom on mobile, where lg:pb-10 restores the desktop
          rhythm. */}
      <div className="min-h-screen pt-14 lg:pl-72 lg:pt-0">
        <main className="mx-auto w-full max-w-6xl px-4 py-7 pb-32 sm:px-6 lg:px-10 lg:py-10 lg:pb-10">
          <header className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-5">
            <div className="min-w-0">
              <h1 className="display-sm text-[1.75rem] sm:text-[2.25rem]">
                {title}
              </h1>
              {subtitle && (
                <p className="subcopy mt-2 max-w-2xl">{subtitle}</p>
              )}
            </div>
            {right && (
              <div className="flex flex-wrap items-center gap-2">{right}</div>
            )}
          </header>

          {children}
        </main>
      </div>
    </>
  );
}

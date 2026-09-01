import type { NextApiRequest, NextApiResponse, GetServerSidePropsContext } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { landingFor } from "@/lib/roles";
import { isDbConfigured } from "@/lib/prisma";

export type Role = "STUDENT" | "ADMIN";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  studentId: string;
  isActive: boolean;
}

/**
 * Central authorization helpers.
 *
 * Every admin API route funnels through `requireRole(..., "ADMIN")` so access
 * control lives in one auditable place instead of being reimplemented — or
 * forgotten — per handler. Client-side checks are presentation only; these are
 * the enforcement.
 */

export async function getSessionUser(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<SessionUser | null> {
  const session = await getServerSession(req, res, authOptions);
  return (session?.user as SessionUser | undefined) ?? null;
}

/**
 * Resolves the caller, or writes 401/403 and returns null. Callers must
 * `return` immediately when null comes back.
 */
export async function requireRole(
  req: NextApiRequest,
  res: NextApiResponse,
  role?: Role,
): Promise<SessionUser | null> {
  const user = await getSessionUser(req, res);

  if (!user) {
    res.status(401).json({ error: "Not signed in." });
    return null;
  }
  if (!user.isActive) {
    res.status(403).json({ error: "This account has been deactivated." });
    return null;
  }
  if (role && user.role !== role) {
    res.status(403).json({ error: "Insufficient permissions." });
    return null;
  }
  return user;
}

/**
 * Guards a handler that needs the database. Returns false having already sent
 * 503, so a missing DATABASE_URL degrades to a clear error instead of a stack
 * trace — which is what lets the landing page ship before the backend does.
 */
export function requireDb(res: NextApiResponse): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({
      error: "Database not configured.",
      hint: "Add DATABASE_URL and DIRECT_URL to .env.local, then run `npx prisma migrate dev`.",
    });
    return false;
  }
  return true;
}

export function methodNotAllowed(
  res: NextApiResponse,
  allowed: string[],
): void {
  res.setHeader("Allow", allowed.join(", "));
  res.status(405).json({ error: `Method not allowed. Use ${allowed.join(" or ")}.` });
}

/** Wraps a handler body so an unexpected throw becomes JSON, not an HTML 500. */
export async function guarded(
  res: NextApiResponse,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    // Server-side diagnostics: the swallowed throw still has to land somewhere
    // a maintainer can read. The client gets calm copy instead — an err.message
    // here can be a Prisma error naming tables and columns, and schema detail
    // is not something to hand every signed-in user.
    console.error("[student-connect:api]", err);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ error: "Something went wrong. Please try again." });
    }
  }
}

/* ------------------------------------------------------------------------- */
/* Page-level guards for getServerSideProps                                   */
/* ------------------------------------------------------------------------- */

type Redirect = { redirect: { destination: string; permanent: false } };

/**
 * Page equivalent of requireRole. Returns the user, or a redirect object to
 * hand straight back from getServerSideProps. Signed-in users hitting the
 * wrong area are sent to their own dashboard rather than to the login page.
 */
export async function requirePage(
  ctx: GetServerSidePropsContext,
  role: Role,
): Promise<{ user: SessionUser } | Redirect> {
  const session = await getServerSession(ctx.req, ctx.res, authOptions);
  const user = session?.user as SessionUser | undefined;

  if (!user) {
    const next = encodeURIComponent(ctx.resolvedUrl || "/");
    return {
      redirect: {
        destination: `/auth/signin?next=${next}`,
        permanent: false,
      },
    };
  }
  if (!user.isActive) {
    return {
      redirect: { destination: "/auth/signin?error=deactivated", permanent: false },
    };
  }
  if (user.role !== role) {
    return {
      redirect: { destination: landingFor(user.role), permanent: false },
    };
  }

  // getServerSideProps serializes props to JSON, and `undefined` is not
  // serializable. NextAuth's DefaultSession adds an optional `image` to
  // session.user that the Credentials provider never sets, so the raw object
  // carries `image: undefined` — and every page that returns `{ props: { user } }`
  // throws "undefined cannot be serialized". Returning an explicit SessionUser
  // with only the declared fields keeps that stray undefined out of every page.
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      studentId: user.studentId,
      isActive: user.isActive,
    },
  };
}

export function isRedirect(
  value: { user: SessionUser } | Redirect,
): value is Redirect {
  return "redirect" in value;
}

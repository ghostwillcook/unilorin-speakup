/**
 * Client-safe role helpers.
 *
 * Deliberately its own module with zero imports. `landingFor` is needed on both
 * sides of the wire, and when it lived in lib/auth.ts the signin page's
 * top-level import pulled bcryptjs, the NextAuth Credentials provider and
 * @prisma/client into the browser bundle — 159 kB of server code shipped to
 * every student. Keep this file free of server dependencies.
 */

export type Role = "STUDENT" | "ADMIN";

/** Where each role lands after signing in. */
export function landingFor(role: Role): string {
  return role === "ADMIN" ? "/admin" : "/student";
}

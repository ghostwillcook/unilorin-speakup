import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma, isDbConfigured } from "@/lib/prisma";

/**
 * Credentials auth against the spec's own `User.passwordHash` column.
 *
 * Sessions are JWTs, so no Account/Session tables are needed — and the socket
 * server can verify the very same token with NEXTAUTH_SECRET.
 */
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },

  pages: {
    signIn: "/auth/signin",
    error: "/auth/signin",
  },

  providers: [
    CredentialsProvider({
      name: "UNILORIN credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        studentId: { label: "Student ID", type: "text" },
        password: { label: "Password", type: "password" },
      },

      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        // Surfaces as a readable sign-in error rather than a 500 when someone
        // tries to log in before the database is wired up.
        if (!isDbConfigured()) {
          throw new Error("Database is not configured yet.");
        }

        const email = credentials.email.trim().toLowerCase();
        const user = await prisma.user.findUnique({ where: { email } });

        // Same generic failure whether the account is missing or the password
        // is wrong, so the form cannot be used to enumerate valid emails.
        if (!user) return null;

        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;

        // Student ID is checked only when supplied, so admins can sign in with
        // email and password alone.
        const providedId = credentials.studentId?.trim();
        if (
          providedId &&
          providedId.toLowerCase() !== user.studentId.toLowerCase()
        ) {
          return null;
        }

        // Deactivated accounts are refused here, which is what makes the
        // admin Users page's block action meaningful.
        if (!user.isActive) {
          throw new Error("This account has been deactivated.");
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          studentId: user.studentId,
          isActive: user.isActive,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.studentId = user.studentId;
        token.isActive = user.isActive;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.studentId = token.studentId;
        session.user.isActive = token.isActive;
      }
      return session;
    },
  },

  // Dev-only fallback: keeps `npm run dev` from hard-failing before .env.local
  // exists. Production must set NEXTAUTH_SECRET explicitly.
  secret:
    process.env.NEXTAUTH_SECRET ||
    (process.env.NODE_ENV !== "production"
      ? "dev-only-insecure-secret-change-me"
      : undefined),
};

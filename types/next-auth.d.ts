import type { DefaultSession } from "next-auth";

/**
 * The Credentials provider puts the application's own user fields on the JWT,
 * so both the session and the token need widening. The socket server decodes
 * the same token shape with next-auth/jwt.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "STUDENT" | "ADMIN";
      studentId: string;
      isActive: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    email: string;
    name: string;
    role: "STUDENT" | "ADMIN";
    studentId: string;
    isActive: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "STUDENT" | "ADMIN";
    studentId: string;
    isActive: boolean;
  }
}

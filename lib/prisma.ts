import { PrismaClient } from "@prisma/client";

/**
 * Lazy Prisma singleton.
 *
 * The spec requires `/` to render on `npm run dev` before any database exists.
 * A module-scope `new PrismaClient()` would be constructed the moment anything
 * in the import graph touched this file, so construction is deferred until a
 * query is actually issued. Import this module freely; nothing happens until
 * you call a model.
 */

const globalForPrisma = globalThis as unknown as {
  __studentConnectPrisma?: PrismaClient;
};

export class DbNotConfiguredError extends Error {
  constructor() {
    super(
      "DATABASE_URL is not set. Copy .env.local.example to .env.local and add " +
        "your Supabase connection strings, then run `npx prisma migrate dev`.",
    );
    this.name = "DbNotConfiguredError";
  }
}

/** True when a connection string is present. Never throws. */
export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** Returns the client, constructing it on first use. Throws if unconfigured. */
export function getPrisma(): PrismaClient {
  if (!isDbConfigured()) throw new DbNotConfiguredError();

  if (!globalForPrisma.__studentConnectPrisma) {
    globalForPrisma.__studentConnectPrisma = new PrismaClient({
      log:
        process.env.NODE_ENV === "development"
          ? ["warn", "error"]
          : ["error"],
    });
  }
  return globalForPrisma.__studentConnectPrisma;
}

/**
 * Ergonomic accessor: `prisma.user.findMany()` reads normally but still defers
 * construction to the first property access.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(
      client as unknown as object,
      prop,
      receiver,
    ) as unknown;
    return typeof value === "function"
      ? (value as (...a: unknown[]) => unknown).bind(client)
      : value;
  },
});

export default prisma;

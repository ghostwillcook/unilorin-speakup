/**
 * UNILORIN SpeakUp — ESLint configuration.
 *
 * Flat config, not `.eslintrc.json`. That is forced by the versions this repo
 * pins rather than being a preference. eslint-config-next@15.5.23 caps its
 * ESLint peer at `^9.0.0`, and ESLint 9 ignores `.eslintrc.*` entirely unless
 * you also export ESLINT_USE_FLAT_CONFIG=false — a bare `npx eslint .` against
 * an eslintrc file exits 2 with "couldn't find an eslint.config file". Legacy
 * config would therefore work under `next lint` (which picks the format from
 * whichever file it finds) and fail under the CLI. Flat config is the one
 * format both entry points agree on at these versions; both were run to check.
 *
 * The FlatCompat bridge is needed because eslint-config-next@15.5.23 still
 * ships eslintrc-shaped configs only — index.js / core-web-vitals.js /
 * typescript.js, no `exports` map and no flat entry point (that lands in the
 * 16.x line). This is the same bridge create-next-app generates for Next 15,
 * which is why @eslint/eslintrc is a direct devDependency rather than being
 * borrowed out of ESLint's own dependency tree by hoisting luck.
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  {
    /**
     * Nothing generated, vendored or built is source, and linting it produces
     * findings nobody can act on.
     *
     * node_modules is already in ESLint 9's default ignore list, but it is
     * spelled out because it is also where this project's generated Prisma
     * client lands: prisma/schema.prisma sets `binaryTargets` but no `output`,
     * so `prisma generate` writes to node_modules/.prisma/client and
     * node_modules/@prisma/client. The `generated` glob covers the other half —
     * if that generator ever gains an explicit `output` (a project-local
     * `generated` folder is the Prisma 6 default for the newer `prisma-client`
     * provider), the emitted client stays out of the lint run without anyone
     * having to remember to come back here.
     *
     * prisma/migrations is checked-in SQL plus a lock file. There is no JS or
     * TS in it today; ignoring it keeps a future migration helper script from
     * being linted as application code.
     *
     * .netlify holds the vendored @netlify/plugin-nextjs bundle — several
     * hundred .ts/.js files that are not ours. next-env.d.ts is rewritten by
     * `next dev`/`next build` on every run and its triple-slash references trip
     * @typescript-eslint/triple-slash-reference.
     */
    ignores: [
      "node_modules/**",
      "**/generated/**",
      ".next/**",
      "out/**",
      ".netlify/**",
      "prisma/migrations/**",
      "next-env.d.ts",
    ],
  },

  // next/core-web-vitals is next/recommended with the Core Web Vitals rules
  // promoted to errors; next/typescript layers on @typescript-eslint. Both are
  // resolved through FlatCompat, per the header.
  //
  // server/socket.mjs is linted (not ignored) by these same configs, and needs
  // no override to be: `.mjs` is unambiguously ESM, and eslint-config-next's
  // base config already declares `env: { node: true }`, which FlatCompat turns
  // into the Node globals that file uses. Linting it matters more than most —
  // tsconfig.json excludes `server`, so ESLint is the only static check it
  // gets.
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    /**
     * Tooling config files are read by a bundler or task runner, never imported
     * by another module, so there is no debugging or refactoring benefit to
     * naming their default export — which is the entire point of
     * import/no-anonymous-default-export. Off here rather than fixed in place:
     * postcss.config.mjs is load-bearing for the Tailwind v4 build, and
     * reshaping a working build file to satisfy a stylistic rule is the wrong
     * trade. Real modules under pages/, lib/ and components/ keep the rule.
     */
    files: ["*.config.{js,cjs,mjs,ts}"],
    rules: {
      "import/no-anonymous-default-export": "off",
    },
  },

  {
    /**
     * Node build tooling — the Netlify deploy plugin and its shared fixer
     * script — is CommonJS by necessity: Netlify loads local plugins with
     * require(), so ESM would simply not run. The next/typescript preset's
     * no-require-imports rule assumes bundled application code and has no
     * opinion worth honouring here.
     */
    files: ["netlify/plugins/**/*.js", "scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;

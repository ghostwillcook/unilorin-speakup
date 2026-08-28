/**
 * Local build plugin: repair the Windows-generated Next.js server handler.
 *
 * Ordering is the whole reason this is a plugin rather than a line in the build
 * command. The lifecycle is:
 *
 *   build command  ->  @netlify/plugin-nextjs onBuild  ->  this onBuild
 *     ->  functions bundling  ->  upload
 *
 * The broken file does not exist until the Next.js plugin's onBuild generates
 * it, so patching from the build command is too early; bundling happens right
 * after the onBuild phase, so patching from a later hook risks being too late.
 * This plugin is therefore declared *after* @netlify/plugin-nextjs in
 * netlify.toml, which is what makes its onBuild run second.
 *
 * onEnd re-checks rather than re-patches: by then the bundle is sealed, so a
 * surviving defect can only be reported, and reporting it loudly beats shipping
 * a deploy whose every route 502s while the build log says success.
 *
 * See scripts/fix-netlify-windows-paths.cjs for what the defect actually is.
 * On Netlify's Linux builders this is a no-op, which is the intended outcome.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  fixWindowsPaths,
  BROKEN,
  FUNCTIONS_DIR,
} = require("../../../scripts/fix-netlify-windows-paths.cjs");

const ENTRY = path.join(
  FUNCTIONS_DIR,
  "___netlify-server-handler/___netlify-server-handler.mjs",
);

module.exports = {
  onBuild: ({ utils }) => {
    const { scanned, patched, occurrences } = fixWindowsPaths(console.log);

    if (patched === 0) {
      console.log(
        `No Windows path corruption found in ${scanned} generated file(s) — ` +
          "nothing to do (expected on Linux builders).",
      );
      return;
    }

    console.log(
      `Rewrote ${occurrences} corrupted path literal(s) across ${patched} ` +
        `file(s) of ${scanned} scanned.`,
    );

    // Verify the result parses as an ES module instead of trusting the string
    // replace. A SyntaxError that survives to the runtime is invisible until
    // every route 502s, so fail the build here where it is still debuggable.
    // `node --check` honours the .mjs extension and so applies module rules.
    if (fs.existsSync(ENTRY)) {
      const text = fs.readFileSync(ENTRY, "utf8");
      if (text.includes(BROKEN)) {
        return utils.build.failBuild(
          `Patch did not clear every "${BROKEN}" literal in ${ENTRY}. ` +
            "Deploying would produce 502s on all server-rendered routes.",
        );
      }

      // A task-root path line that still carries a backslash will resolve to
      // a nonexistent module at cold start (JS eats `\d`, `\r`, `\s`... as
      // escapes), which reports as ERR_MODULE_NOT_FOUND, not a syntax error —
      // so --check alone cannot catch it.
      const stragglers = text
        .split(/\r?\n/)
        .filter((l) => l.includes("/var/task") && l.includes("\\"));
      if (stragglers.length > 0) {
        return utils.build.failBuild(
          `Corrupted path separator(s) survived the patch in ${ENTRY}:\n` +
            stragglers.map((l) => "  " + l.trim()).join("\n"),
        );
      }

      try {
        execFileSync(process.execPath, ["--check", ENTRY], { stdio: "pipe" });
        console.log(`${ENTRY} parses as an ES module.`);
      } catch (err) {
        const detail = err.stderr ? err.stderr.toString().trim() : err.message;
        return utils.build.failBuild(
          `Patched handler is still not valid JavaScript:\n${detail}`,
        );
      }
    }
  },

  onEnd: () => {
    if (!fs.existsSync(ENTRY)) return;
    if (fs.readFileSync(ENTRY, "utf8").includes(BROKEN)) {
      console.error(
        `WARNING: ${ENTRY} still contains "${BROKEN}". The deployed ` +
          "function will fail to parse and every SSR route will answer 502.",
      );
    }
  },
};

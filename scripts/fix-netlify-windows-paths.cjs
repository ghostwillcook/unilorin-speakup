/**
 * Repairs the function entry point that @netlify/plugin-nextjs emits when the
 * build runs on Windows.
 *
 * The plugin composes the Lambda task root with the package path using
 * path.join, which on win32 yields backslashes, then embeds the result in
 * generated JavaScript as a string literal. `/var/task/unilorin-speakup`
 * therefore ships as `\var\task\unilorin-speakup`, where `\v` and `\t` become
 * control characters and `\u` is an *invalid* Unicode escape — a SyntaxError in
 * an .mjs module. The handler cannot parse at cold start, so every
 * server-rendered route answers 502 and the site serves Netlify's own 404.
 *
 * The bundle layout itself is correct: the files really do sit under
 * <task-root>/unilorin-speakup/, so only the separators are wrong. Rewriting
 * them to forward slashes yields a path that is valid on the Linux runtime.
 *
 * This is a workaround for a host-OS bug, not a fix, and it is deliberately a
 * no-op anywhere the bug does not occur — including Netlify's own Linux
 * builders, where the generated path is already correct. The durable answer is
 * to build there rather than on Windows.
 *
 * Runs from netlify/plugins/fix-windows-paths (after the Next.js plugin has
 * generated the function, before Netlify bundles it) and standalone via
 * `node scripts/fix-netlify-windows-paths.cjs`.
 */
const fs = require("node:fs");
const path = require("node:path");

const FUNCTIONS_DIR = ".netlify/functions-internal";
const BROKEN = "\\var\\task";
const FIXED = "/var/task";

/**
 * Generated entry points only. The bundled node_modules is ~100 MB and cannot
 * contain this defect — the corruption is introduced by code generation, not by
 * any dependency — so descending into it would cost minutes and find nothing.
 */
function generatedFiles(dir, depth = 0) {
  const found = [];
  if (depth > 2 || !fs.existsSync(dir)) return found;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      found.push(...generatedFiles(full, depth + 1));
    } else if (/\.(mjs|cjs|js|json)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * @param {(msg: string) => void} log
 * @returns {{ scanned: number, patched: number, occurrences: number }}
 */
function fixWindowsPaths(log = console.log) {
  let scanned = 0;
  let patched = 0;
  let occurrences = 0;

  for (const file of generatedFiles(FUNCTIONS_DIR)) {
    scanned += 1;
    const before = fs.readFileSync(file, "utf8");
    // The BROKEN-prefix guard from earlier revisions was wrong: a file whose
    // prefix a previous run already repaired still carries corrupted
    // separators further along the path, and would be skipped forever. Both
    // passes below are individually idempotent, so run them unconditionally
    // and let "did the content change" be the only gate.

    // Two corruption shapes ship in the same file. The prefix is always
    // backslashed; the remainder is backslashed on some lines (path.join all
    // the way down) and already forward-slashed on others (string
    // concatenation). Rather than enumerate shapes, any line that still
    // references the task root and contains a backslash is treated as one
    // corrupted path and gets every separator rewritten. A line that mentions
    // /var/task is a path line by construction, so this cannot over-match —
    // and `.split(BROKEN).join(FIXED)` alone demonstrably is not enough: it
    // leaves lines like
    //   await import('/var/task/pkg\.netlify\dist\run\handlers\server.js')
    // where `\d`, `\r` and `\s` silently eat their backslashes and the module
    // lookup fails at cold start.
    const after = before
      // Pass 1: repair the task-root prefix on every affected line. Without
      // this, pass 2 cannot see them — it looks for FIXED, which this pass
      // is what introduces.
      .split(BROKEN)
      .join(FIXED)
      .split(/\r?\n/)
      .map((line) => {
        if (!line.includes(FIXED) || !line.includes("\\")) return line;
        const fixed = line.split("\\").join("/");
        if (fixed !== line) {
          occurrences += 1;
          log(`  patched path separators in: ${line.trim().slice(0, 120)}`);
        }
        return fixed;
      })
      .join("\n");

    if (after === before) continue;

    fs.writeFileSync(file, after, "utf8");
    patched += 1;
  }

  return { scanned, patched, occurrences };
}

module.exports = { fixWindowsPaths, BROKEN, FUNCTIONS_DIR };

// Standalone invocation: report and verify, so a human running this directly
// gets the same assurance the build plugin gets.
if (require.main === module) {
  const result = fixWindowsPaths();
  console.log(
    `scanned ${result.scanned} generated file(s), patched ${result.patched}`,
  );

  const entry = path.join(
    FUNCTIONS_DIR,
    "___netlify-server-handler/___netlify-server-handler.mjs",
  );
  if (fs.existsSync(entry)) {
    const text = fs.readFileSync(entry, "utf8");
    console.log(
      "chdir line:",
      text.split(/\r?\n/).find((l) => l.includes("process.chdir")),
    );
    console.log("still broken:", text.includes(BROKEN));
  }
}

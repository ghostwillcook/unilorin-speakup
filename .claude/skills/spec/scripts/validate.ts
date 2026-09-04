#!/usr/bin/env bun
/**
 * Structural validator for .wise/specs/<name>/ spec bundles.
 * Acts like a compile check: exits 1 and prints tsc-style diagnostics if anything is wrong.
 *
 * Usage:
 *   bun run validate.ts <feature-dir>       # e.g. bun run validate.ts .wise/specs/checkout
 *   bun run validate.ts --all <features-root>  # validate every feature subfolder
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname, relative } from "path";

type Severity = "error" | "warning";

interface Diagnostic {
  file: string;
  line: number;
  code: string;
  severity: Severity;
  message: string;
}

// TEST-SPEC is always required (the TDD verification layer). API-CONTRACTS,
// UI-CONTRACTS, and TECHNICAL-DESIGN are optional — a feature only gets them
// if it actually has that surface (client-server boundary / Frontend-Mobile UI
// / multi-service backend orchestration), decided by the Job 1 interview in
// SKILL.md. ENTITIES.md/USE-CASES.md are not part of the active bundle right
// now (see references/structure.md) — not mandatory, not optional, simply not
// created unless the user explicitly asks for one.
const MANDATORY_TECH_FILES = ["TEST-SPEC.md"] as const;
const OPTIONAL_TECH_FILES = ["API-CONTRACTS.md", "UI-CONTRACTS.md", "TECHNICAL-DESIGN.md"] as const;
const TECH_FILES = [...MANDATORY_TECH_FILES, ...OPTIONAL_TECH_FILES] as const;

const TECH_TITLE_PREFIX: Record<(typeof TECH_FILES)[number], string> = {
  "API-CONTRACTS.md": "API Contracts:",
  "UI-CONTRACTS.md": "UI Contracts:",
  "TECHNICAL-DESIGN.md": "Technical Design Document:",
  "TEST-SPEC.md": "Test Specification:",
};

// TC-N is flat and unscoped by design — TEST-SPEC.md is a single list of
// whole-system Gherkin scenarios, not split by test level (unit/integration/e2e)
// or platform (BE/FE/...), so there's no per-platform ID shape to accept here.
const ID_PATTERNS: Record<string, RegExp> = {
  "FR-ID": /^FR-\d+$/,
  "NFR-ID": /^NFR-\d+$/,
  "EC-ID": /^EC-\d+$/,
  "TC-ID": /^TC-\d+$/,
  "SM-platform-ID": /^SM-[A-Z]+-\d+$/,
};

function diag(diags: Diagnostic[], file: string, line: number, severity: Severity, code: string, message: string) {
  diags.push({ file, line, code, severity, message });
}

function lines(content: string): string[] {
  return content.split("\n");
}

/** Validate heading hierarchy: single H1, then H2s numbered 1,2,3.. in order,
 *  with H3s under each H2 numbered N.1, N.2.. restarting per parent, and no
 *  heading duplicating the H1 title text verbatim. */
function checkHeadings(diags: Diagnostic[], file: string, content: string, expectH2Numbers: boolean) {
  const ls = lines(content);
  let h1Count = 0;
  let h1Text = "";
  let expectedH2 = 1;
  let expectedH3 = 1;
  let currentH2 = 0;
  let inFence = false;

  ls.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = raw;
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (/^#\s+/.test(line)) {
      h1Count++;
      h1Text = line.replace(/^#\s+/, "").trim();
      if (h1Count > 1) {
        diag(diags, file, lineNo, "error", "SPEC1001", `Multiple H1 headings found; a spec file must have exactly one title heading. Extra: "${line}"`);
      }
    } else if (/^##\s+/.test(line)) {
      const text = line.replace(/^##\s+/, "").trim();
      if (h1Text && text === h1Text) {
        diag(diags, file, lineNo, "error", "SPEC1002", `Heading "${text}" duplicates the H1 title verbatim — remove this redundant heading (each file's own title already conveys it).`);
      }
      if (expectH2Numbers) {
        const m = text.match(/^(\d+)\.\s/);
        if (!m) {
          diag(diags, file, lineNo, "error", "SPEC1003", `H2 heading "${text}" is missing its leading number (expected "${expectedH2}. ...").`);
        } else {
          const n = parseInt(m[1], 10);
          if (n !== expectedH2) {
            diag(diags, file, lineNo, "error", "SPEC1004", `H2 heading numbered ${n} out of sequence — expected ${expectedH2}. Numbering must be sequential starting at 1.`);
          }
          currentH2 = expectedH2;
          expectedH2++;
          expectedH3 = 1;
        }
      }
    } else if (/^###\s+/.test(line)) {
      const text = line.replace(/^###\s+/, "").trim();
      if (h1Text && text === h1Text) {
        diag(diags, file, lineNo, "error", "SPEC1002", `Heading "${text}" duplicates the H1 title verbatim — remove this redundant heading.`);
      }
      if (expectH2Numbers && currentH2 > 0) {
        const m = text.match(/^(\d+)\.(\d+)\s/);
        if (m) {
          const parent = parseInt(m[1], 10);
          const child = parseInt(m[2], 10);
          if (parent !== currentH2) {
            diag(diags, file, lineNo, "error", "SPEC1005", `H3 heading "${text}" has parent number ${parent}, but is nested under H2 section ${currentH2}.`);
          } else if (child !== expectedH3) {
            diag(diags, file, lineNo, "error", "SPEC1006", `H3 heading numbered ${currentH2}.${child} out of sequence — expected ${currentH2}.${expectedH3}.`);
          }
          expectedH3++;
        }
        // H3 without a numeric prefix (e.g. a plain test-case title) is allowed —
        // not every technical file numbers its leaf headings, only its groups.
      }
    }
  });

  if (h1Count === 0) {
    diag(diags, file, 1, "error", "SPEC1000", "File is missing its H1 title heading.");
  }
}

/** Technical files must open with `# <Kind>: <Feature Name>` and a backlink
 *  line to SPEC.md + whichever other technical files actually exist in this
 *  bundle (API-CONTRACTS/UI-CONTRACTS are optional, so "siblings" is computed
 *  per-feature from what's present on disk, not the full known-file list). */
function checkTechFileConventions(diags: Diagnostic[], featureDir: string, fileName: (typeof TECH_FILES)[number], content: string, presentFiles: readonly string[]) {
  const file = join(featureDir, fileName);
  const ls = lines(content);
  const title = ls[0] || "";
  const prefix = TECH_TITLE_PREFIX[fileName];
  if (!title.startsWith(`# ${prefix} `)) {
    diag(diags, file, 1, "error", "SPEC3001", `Title should start with "# ${prefix} " followed by the feature name.`);
  }
  if (title.includes("&amp;") || content.includes("&amp;")) {
    diag(diags, file, 1, "error", "SPEC3002", `File contains an escaped "&amp;" — use a literal "&" instead (likely leaked from an HTML-escaping tool).`);
  }
  const backlinkIdx = ls.findIndex((l) => l.startsWith("> Part of"));
  if (backlinkIdx === -1) {
    diag(diags, file, 3, "error", "SPEC3003", `Missing the "> Part of [SPEC.md](SPEC.md). See also: ..." backlink line near the top of the file.`);
    return;
  }
  const backlink = ls[backlinkIdx];
  const siblings = presentFiles.filter((f) => f !== fileName);
  for (const sib of siblings) {
    if (!backlink.includes(`(${sib})`)) {
      diag(diags, file, backlinkIdx + 1, "warning", "SPEC3004", `Backlink line does not reference ${sib}.`);
    }
  }
}

// Matches FR-1, NFR-1, EC-1, TC-1, UT-MOB-001, IT-MOB-001, SM-MOB-1, etc.
const ID_TOKEN_RE = /\b[A-Z]{2,6}(?:-[A-Z]+)?-\d+\b/g;

/** An ID is *defined* where it's the sole bolded cell opening a table row
 *  (`| **FR-1** | ... |`) or the ID in a `#### <ID>: <Title>` test-case
 *  heading — that's the one spot each ID gets minted. Every other occurrence
 *  of that same token anywhere in the bundle (a Dependency column, a
 *  `**Reference**:` field, a Next-State cell, prose) is a *reference* to be
 *  checked against the defined set. */
function extractIdsAndRefs(content: string) {
  const ls = lines(content);
  const defined: { id: string; line: number }[] = [];
  const referenced: { id: string; line: number }[] = [];

  ls.forEach((line, idx) => {
    const lineNo = idx + 1;
    // Strip markdown links before token-scanning: an external identifier
    // (a Jira key, a ticket number) linked out to another system — e.g.
    // `[PB-7652](https://.../browse/PB-7652)` — happens to share this
    // bundle's ID shape (letters-hyphen-digits) but isn't one of *our*
    // IDs. A real FR/NFR/EC/TC/SM reference in this bundle's convention
    // is always bare prose, a table cell, or an `@FR-1`-style tag — never
    // a hyperlink — so link labels/URLs are never a legitimate ID
    // reference or definition site and are safe to exclude from scanning.
    const scanLine = line.replace(/\[[^\]]*\]\([^)]*\)/g, "");
    const tableDefMatch = scanLine.match(/^\|\s*\*\*([A-Z]{2,6}(?:-[A-Z]+)?-\d+)\*\*\s*\|/);
    const headingDefMatch = scanLine.match(/^#{2,4}\s+(?:[\d.]+\s+)?([A-Z]{2,6}(?:-[A-Z]+)?-\d+):/);
    const defId = tableDefMatch?.[1] ?? headingDefMatch?.[1] ?? null;

    const tokens = [...scanLine.matchAll(ID_TOKEN_RE)].map((m) => m[0]);
    let consumedDef = false;
    for (const id of tokens) {
      if (defId && id === defId && !consumedDef) {
        defined.push({ id, line: lineNo });
        consumedDef = true;
        continue;
      }
      referenced.push({ id, line: lineNo });
    }
  });
  return { defined, referenced };
}

function checkIdsAndCrossReferences(diags: Diagnostic[], featureDir: string, contents: Record<string, string>) {
  const allDefined = new Map<string, string>(); // id -> "file:line"
  const allReferenced: { id: string; file: string; line: number }[] = [];

  for (const [fileName, content] of Object.entries(contents)) {
    const file = join(featureDir, fileName);
    const { defined, referenced } = extractIdsAndRefs(content);
    for (const { id, line } of defined) {
      const category = Object.keys(ID_PATTERNS).find((k) => ID_PATTERNS[k].test(id));
      if (!category) {
        diag(diags, file, line, "warning", "SPEC4001", `ID "${id}" doesn't match any known ID pattern (FR-N, NFR-N, EC-N, TC-N, SM-<PLATFORM>-N).`);
      }
      const existing = allDefined.get(id);
      if (existing && !existing.startsWith(`${relative(featureDir, file)}:`)) {
        diag(diags, file, line, "error", "SPEC4002", `Duplicate ID "${id}" — already defined at ${existing}.`);
      } else if (!existing) {
        // A state ID legitimately repeats across every transition row it's
        // the "from" state for — only the first occurrence in a file counts
        // as the definition site; later repeats within the same file are not
        // an error, only a redefinition in a *different* file is.
        allDefined.set(id, `${relative(featureDir, file)}:${line}`);
      }
    }
    for (const r of referenced) allReferenced.push({ ...r, file });
  }

  for (const { id, file, line } of allReferenced) {
    if (!allDefined.has(id)) {
      diag(diags, file, line, "error", "SPEC4003", `Reference to "${id}" does not match any defined FR/NFR/EC ID in this feature's spec files (dangling reference).`);
    }
  }
}

/** SPEC.md's Technical Specification table must list every technical file that
 *  actually exists in the bundle (mandatory ones always; API-CONTRACTS/UI-CONTRACTS
 *  only when the feature has that surface and the file was created). */
function checkSpecTechTable(diags: Diagnostic[], featureDir: string, content: string, presentTechFiles: readonly string[]) {
  const file = join(featureDir, "SPEC.md");
  for (const f of presentTechFiles) {
    if (!content.includes(`(${f})`)) {
      diag(diags, file, 1, "error", "SPEC5001", `SPEC.md's Technical Specification section does not link to ${f}.`);
    }
  }
}

function checkAmpEscaping(diags: Diagnostic[], file: string, content: string) {
  const ls = lines(content);
  ls.forEach((line, idx) => {
    if (line.includes("&amp;")) {
      diag(diags, file, idx + 1, "error", "SPEC0001", `Found escaped "&amp;" — replace with a literal "&".`);
    }
  });
}

function validateFeature(featureDir: string): Diagnostic[] {
  const diags: Diagnostic[] = [];

  const mandatoryFiles = ["SPEC.md", ...MANDATORY_TECH_FILES] as const;
  for (const f of mandatoryFiles) {
    const p = join(featureDir, f);
    if (!existsSync(p)) {
      diag(diags, p, 1, "error", "SPEC0000", `Required file is missing.`);
    }
  }
  if (diags.length > 0) return diags; // can't check further without the mandatory files

  // API-CONTRACTS.md / UI-CONTRACTS.md are optional — only validate the ones
  // this feature actually has.
  const presentOptionalFiles = OPTIONAL_TECH_FILES.filter((f) => existsSync(join(featureDir, f)));
  const presentTechFiles = [...MANDATORY_TECH_FILES, ...presentOptionalFiles];
  const presentFiles = ["SPEC.md", ...presentTechFiles];

  const contents: Record<string, string> = {};
  for (const f of presentFiles) contents[f] = readFileSync(join(featureDir, f), "utf-8");

  // SPEC.md
  checkHeadings(diags, join(featureDir, "SPEC.md"), contents["SPEC.md"], true);
  checkAmpEscaping(diags, join(featureDir, "SPEC.md"), contents["SPEC.md"]);
  checkSpecTechTable(diags, featureDir, contents["SPEC.md"], presentTechFiles);

  // Technical files
  for (const f of presentTechFiles) {
    const file = join(featureDir, f);
    checkHeadings(diags, file, contents[f], true);
    checkTechFileConventions(diags, featureDir, f, contents[f], presentFiles);
  }

  checkIdsAndCrossReferences(diags, featureDir, contents);

  return diags;
}

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    dir = dirname(dir);
  }
  return startDir;
}

function printDiagnostics(diags: Diagnostic[], repoRoot: string) {
  const sorted = [...diags].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  for (const d of sorted) {
    const relFile = relative(repoRoot, d.file);
    console.log(`${relFile}:${d.line} - ${d.severity} ${d.code}: ${d.message}`);
  }
  const errors = diags.filter((d) => d.severity === "error").length;
  const warnings = diags.filter((d) => d.severity === "warning").length;
  console.log("");
  console.log(`Found ${errors} error(s), ${warnings} warning(s).`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: bun run validate.ts <feature-dir> | --all <features-root>");
    process.exit(2);
  }

  let targets: string[] = [];
  if (args[0] === "--all") {
    const root = args[1] || ".";
    targets = readdirSync(root)
      .map((name) => join(root, name))
      .filter((p) => statSync(p).isDirectory());
  } else {
    targets = [args[0]];
  }

  let allDiags: Diagnostic[] = [];
  const repoRoot = findRepoRoot(targets[0]);
  for (const t of targets) {
    allDiags = allDiags.concat(validateFeature(t));
  }

  printDiagnostics(allDiags, repoRoot);
  const hasErrors = allDiags.some((d) => d.severity === "error");
  process.exit(hasErrors ? 1 : 0);
}

main();

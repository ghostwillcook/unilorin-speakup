---
name: tdd-plan-executor
description: Execute a wave/slice TDD implementation plan produced by the spec/tdd-plan process — a bundle of `00-overview.md`, `00-coverage.md`, and numbered `NN-slice-name.md` files. Each slice has YAML frontmatter (status, satisfies, wave, blocked_by, uses_skills) plus a Markdown body with Files (Create/Modify/Test paths), Interfaces (Consumes/Produces signatures), a Seam, Guardrails, Evidence paths, a numbered Steps checklist (write the failing test, confirm it fails, implement, confirm it passes, full-suite + commit), and a Source-of-truth section. Use this whenever the user asks to "execute", "implement", "run", or "work through" a plan like this, asks to "do slice N", asks to continue an in-progress plan, or points at a directory containing files matching this exact 00-overview/00-coverage/NN-slice pattern. Also trigger if the user mentions RED/GREEN evidence files, a wave-based dependency matrix, or a "Final Verification Wave". This skill enforces real captured test output (not narrated results) and a hard anti-tautology gate requiring every expected test value to cite a literal source-of-truth line before a slice can be marked done — don't skip these even under time pressure.
---

# TDD Plan Executor

Executes exactly one kind of artifact: a **wave/slice TDD plan bundle** — `00-overview.md` + `00-coverage.md` + a set of `NN-slice-name.md` files, each fully self-contained with YAML frontmatter (status/satisfies/wave/blocked_by/uses_skills) and a body carrying Files, Interfaces, a Seam, Guardrails, Evidence paths, a numbered Steps checklist, and a Source-of-truth section.

This is an execution skill, not a planning skill. Don't invent new slices, renumber waves, or restructure the plan — if the plan itself looks wrong, say so and ask, don't silently fix it.

## Core discipline (non-negotiable, applies to every slice)

1. **Real RED, real GREEN.** Never write "RED: (would fail because...)" — actually run the slice's Verify command (or the narrower test target it names) before writing any implementation code, and redirect its actual stdout/stderr plus exit code to the RED evidence path (e.g. `<command> > evidence/<TC-id>.red.txt 2>&1; echo "exit: $?" >> evidence/<TC-id>.red.txt`) — never hand-type or reconstruct the file's contents. Only after that failing run exists do you write implementation code. Then rerun the same command the same way into the GREEN evidence path. See `/tdd-plan`'s `references/evidence.md` for the exact convention.

2. **Honest RED, not a trivial one.** Some slices explicitly warn that the production code may already exist untested (e.g. a naive positive-path test could pass immediately and prove nothing). When a slice's Step 1 instructions call this out, follow it: assert something deliberately wrong first (wrong call count, wrong exception type, etc.), confirm *that* fails for the right reason, capture it as RED, then correct the assertion to the real expected value for GREEN. If a "first" RED attempt passes when the slice implies it shouldn't, treat this as the dishonest-RED failure mode below — don't just shrug and move on.

3. **Hard source-of-truth gate.** Every expected value your test asserts must trace to a literal line, row, or enum member quoted from the plan's cited source documents (typically `SPEC.md`, `UI-CONTRACTS.md`, `API-CONTRACTS.md`, `TEST-SPEC.md`, or an existing enum/interface in the codebase) — never recomputed from the implementation you're about to write or just wrote. Before marking any slice's checklist item "expected values trace to source of truth" as done, you must be able to quote the specific line/row you traced it to. If you can't produce that quote, the gate fails — go find it, or ask the user, don't guess and move on.

4. **Guardrails are hard stops.** Each slice's "Must NOT do" list is a boundary, not a suggestion. If completing a slice as written seems to require violating its own guardrail (e.g. touching a file or branch it explicitly says not to touch), stop and surface this to the user rather than quietly doing it anyway — it usually means a dependency was missed or the plan has a gap.

5. **Don't restate Gherkin.** Slices deliberately don't repeat their TC's Given/When/Then in the slice file. Go read the actual `TEST-SPEC.md` (and `SPEC.md`/`UI-CONTRACTS.md`/`API-CONTRACTS.md` as needed) for the real steps and expected values — the slice file is a pointer, not the spec itself.

6. **A green test suite is necessary, not sufficient — run whatever gauntlet the project has already set up for itself.** The whole reason this skill insists on real RED/GREEN and literal source-of-truth citations is that a human isn't reading every line this produces; the confidence has to come from the code surviving hard, automated constraints instead — coverage thresholds, mutation testing, lint/typecheck, or any other quality gate the project has already wired in (see Step 3). Don't treat "the test I wrote passes" as the finish line if the project's own tooling asks for more than that.

## Workflow

### Step 0 — Load the bundle

Read `00-overview.md` and `00-coverage.md` first, in full, before touching any slice. These give you:

- The wave structure and dependency matrix (what blocks what)
- The known baseline caveats (pre-existing failures you must not treat as new regressions)
- Gap resolutions (things intentionally left uncovered — don't try to "fix" these by inventing new tests)

Then locate every `NN-slice-name.md` file. Confirm the dependency matrix in `00-overview.md` and each slice's own frontmatter `blocked_by` list agree; if they don't, stop and ask.

Evidence paths in each slice (e.g. `.scratch/app-entry/plan/evidence/TC-4.red.txt`) are relative to the project root, not the plan-bundle directory. If it's not obvious where the project root is (no `.git`, no build file visible), ask the user once, up front, rather than guessing per-slice.

While you're establishing the project root, also note whether it's under git (a `.git` directory present) — this determines whether you'll commit per slice later (Step 2.9). Don't run `git init` just to enable this; it only applies to projects already using git.

Same pass, check for existing quality tooling you'll need at Step 3's gauntlet: a coverage script/config, a mutation-testing config (`stryker.conf.*`, PIT, mutmut, etc.), a lint/static-analysis config, and a build/typecheck script. Note what's present and what's absent once, rather than rediscovering it per slice — and don't install any of this if it's missing, that's the user's call, not something to add mid-execution. The one exception: if there's no linter/static-analysis tool at all, plan to mention that gap once in your final report (Step 5) as a suggestion, not silence.

Also locate the actual spec documents the slices cite as source of truth (`SPEC.md`, `TEST-SPEC.md`, `UI-CONTRACTS.md`, `API-CONTRACTS.md` or equivalents) — you'll need to quote from these, not from the plan files, to satisfy the hard gate in rule 3 above. Check the same directory as the slice files, its parent, and any `.scratch/<feature>/plan/` or similar path a slice's evidence lines imply.

**If you can't find one or more of these after checking**, stop before writing any test code and tell the user exactly which documents are missing and why you need them (e.g. "Slice 03 cites `TEST-SPEC.md` for TC-1/TC-2/TC-3's Then-clauses and `UI-CONTRACTS.md` for the SM-MOB-3 routing table — I don't have either yet"). This is a common gap: people often share the slice bundle without the spec docs it was generated from. Ask for them rather than proceeding on inference, paraphrasing the slice file's own summary as if it were the spec, or guessing at plausible values — that would silently break the hard source-of-truth gate for every slice.

### Other skills needed mid-execution

A slice may call for work this skill doesn't itself cover — e.g. its deliverable involves a Word/PDF/Excel artifact, or the project has its own org-specific skills (a house code-style skill, a code-review skill, a docs skill) that plausibly apply to what a slice is touching. This skill's job is the TDD wave/slice discipline (RED/GREEN/evidence/guardrails/source-of-truth); it is not a substitute for those.

**Check the slice header first.** Every slice `/tdd-plan` generates carries a `uses_skills` entry in its YAML frontmatter (alongside `blocked_by`) — treat that as authoritative — don't second-guess it, and don't skip invoking a skill it names just because the sub-task looks small. If it's `[]`, don't go looking for one anyway. An older plan bundle predating this field (or predating the frontmatter format entirely — a plan with `**Uses skills:**`/`**Blocked by:**` as bold-prose lines instead of YAML frontmatter, or with none of this at all) won't have it — absence means nothing either way for those; fall back to noticing mid-slice as below.

- If, while reading a slice, you notice it needs a capability better covered by another available skill (installed skill, or one worth searching for) — whether or not the slice declared it — use or invoke that skill for the relevant sub-task, then return to this skill's discipline for the RED/GREEN/evidence/guardrail parts of that same slice. Don't let another skill's process override this skill's core discipline (rules 1–4 above still apply regardless of what produced the code).

- Prefer skills already installed/available over searching for new ones mid-slice. If nothing relevant is installed and the task genuinely needs one, mention it once rather than repeatedly.

- Never treat "I used another skill for this part" as a reason to skip this skill's evidence capture or source-of-truth citation for that slice — the gate applies to the slice's Then-clauses and acceptance criteria regardless of which skill produced the underlying code or artifact.

- If a slice's own instructions conflict with another skill's default behavior (e.g. a house style skill's default output format vs. this slice's explicit "don't restate Gherkin" rule), the slice's explicit instruction wins — surface the conflict to the user rather than silently picking one.

- If you're executing an older plan bundle with no `uses_skills` field at all, consider recommending it be regenerated or amended (via `/tdd-plan`'s Job 2) to add one alongside `blocked_by` in each slice's frontmatter going forward — it turns this into a declared, checkable fact instead of something the executor has to notice reactively.

### Step 1 — Determine invocation mode

- **Single slice** ("do slice 03", "implement 04"): confirm its frontmatter `blocked_by` dependencies are already done (check for existing GREEN evidence files at the paths its own blockers would have produced). If a blocker isn't done, tell the user and ask whether to do the blocker first or proceed anyway (only proceed anyway if the user explicitly says to — this is a real risk, not a formality).

- **Full plan** ("execute the plan", "implement all of this"): walk wave by wave, in the order `00-overview.md` specifies. Within a wave, slices with no interdependency can be done in either order, but respect any same-file merge-conflict notes (e.g. "do these sequentially despite no DAG edge") literally as written. Stop and report at the end of each wave before continuing to the next, so the user can review. Stop fully at the plan's "Final Verification Wave" rather than trying to guess what it entails — ask the user for those slice/task files if not already provided.

### Step 2 — Execute one slice

For each slice, in order. This is the same discipline as the slice file's own `## Steps` checklist, just broken out finer — tick each of the slice file's boxes as you genuinely complete the matching work below, don't tick ahead:

1. **Read the whole slice file.** Note its Files, Interfaces, Seam, Guardrails, Evidence paths, Steps checklist, Acceptance criteria, and Source of truth section.

2. **Find and read the cited source-of-truth material** (the actual SPEC/TEST-SPEC/UI-CONTRACTS/API-CONTRACTS lines, or the actual enum/interface in the codebase) before writing any test code. Write down (in your own working notes, not necessarily shown to the user) the literal quote or reference you're going to assert against.

3. **Write the test(s) at the confirmed seam.** Use fakes at the seam boundary the slice specifies — don't reach past the seam into implementation internals, and don't introduce a different test double strategy (e.g. a mocking framework or HTTP-level mock) than the one the slice or codebase precedent establishes.

4. **Run the Verify command (or the narrower target) and capture real RED.** Save the actual output to the slice's specified RED evidence path(s). If multiple TCs are covered by one slice, each gets its own RED file per the Evidence section.

5. **Implement.** Do only what's needed to satisfy this slice's Then-clauses — resist scope creep into other slices' territory (this is what the Guardrails are for).

6. **Rerun and capture real GREEN** at the specified path(s).

7. **Check off acceptance criteria one by one**, against the actual Then-clauses in `TEST-SPEC.md` (read them — don't take the slice file's paraphrase as sufficient), and against the literal source-of-truth quote from step 2.

8. **Run the slice's own narrow Verify command once more post-implementation** to confirm nothing drifted, before moving to full-suite.

9. **Commit the slice, if the project is under git.** Check for a `.git` directory once, up front (Step 0 is a natural place to note this) — don't init a git repo the user never asked for. If one exists, once the full-suite gate *and* the quality gauntlet (both Step 3) pass for this slice, stage exactly the files this slice touched (implementation, its test(s), its evidence files — `git add <path> <path> ...`, never a blanket `-A` or `.`, so an unrelated in-progress edit elsewhere in the tree can't get swept in) and commit with a message naming the slice and its TC(s), e.g. `slice 02 (TC-2): locked account rejects any attempt`. One commit per slice keeps the RED→GREEN history legible and gives the user a real rollback point per vertical slice — don't squash multiple slices into one commit, and don't amend a prior slice's commit to fix a later one (a new commit, same as any other correction). If the full-suite gate or quality gauntlet fails and you're mid self-correction (Step 4), commit only after both are actually green — never commit a state that hasn't cleared the full gauntlet.

### Step 3 — Full-suite gate and quality gauntlet

Each slice says to run the full-suite command "at VERIFY, before marking done." Do this after each slice (or at minimum, at the end of each wave — ask the user which cadence they prefer if unstated). Compare failures against the known baseline caveat(s) from `00-overview.md`. Anything beyond that baseline is a real regression — stop and report it; don't mark the slice done and don't proceed to the next slice or wave until it's resolved or the user explicitly accepts the regression.

Once the suite is green, also run whatever quality gauntlet the project has *already* set up for itself — this is what makes the green suite trustworthy enough to skip a manual code read, not an optional nicety:

- **Coverage.** If the test runner already has a coverage flag/script wired up (`--coverage`, `npm run test:coverage`, an `nyc`/`c8` config, a `coverageThreshold` in the jest config, etc.), run it. If the project defines a threshold, a run that fails it is a real gate failure — treat it exactly like a full-suite regression, not a nitpick to wave off.
- **Mutation testing.** If a mutation-testing tool is already configured (Stryker's `stryker.conf.js`/`.stryker.conf.json`, PIT, mutmut, cosmic-ray, etc.), run it. A surviving mutant in code this slice just wrote is the same category of problem as a dishonest RED — it means a test looks like it's checking something but isn't. Don't mark the slice done until you've either strengthened the assertion or can articulate why the survivor is an equivalent mutant. Full-project mutation runs are often too slow to justify after every single slice — if the tool supports a scoped/incremental run against just this slice's changed files, prefer that per-slice and reserve a full run for wave-end or the Final Verification Wave; ask the user once which cadence they want if it isn't obvious, rather than guessing wrong for the rest of the plan.
- **Lint / static analysis.** If the project already has a linter or static-analysis tool wired in (ESLint, Biome, ruff, golangci-lint, ktlint, clippy, etc.), run it over the files this slice touched (or the whole project, if that's how the project's own script is set up) as part of this same gate. A pre-existing failure unrelated to this slice's diff is a baseline caveat like any other (note it, don't silently fix it); a new warning/error introduced by this slice is a real gate failure. If the project has **no** linter or static-analysis tool configured at all, don't skip this in silence the way you would coverage/mutation tooling — say so once, in your Step 5 report (plan-level or wave-level, not repeated per slice), and name a concrete, stack-appropriate suggestion (e.g. ESLint for JS/TS, ruff for Python, golangci-lint for Go, ktlint for Kotlin/Android, clippy for Rust). Suggest it; don't install it yourself — adding new tooling to someone's project is their call, but flagging the gap costs nothing and is worth surfacing.
- **Compiles/builds cleanly.** If the project has its own build or typecheck step (`tsc --noEmit`, `go build`, `./gradlew assemble`, a bundler/compile script, etc.) distinct from just running tests, run it. A test suite can pass against code that doesn't actually compile in strict mode, or that a bundler would choke on — that gap is exactly what this gate exists to catch.
- **The files this slice actually touched are still well-tested, not just the aggregate.** A global coverage/pass-rate number can look fine while a file this slice modified quietly regressed (e.g. a shared helper another slice's tests exercised is now covering fewer of its own branches because this slice added a new code path to it). When you run coverage, glance at the per-file rows for every file this slice's diff touched, not only the `All files` summary line — and make sure any pre-existing tests that already covered those files (from an earlier slice) still pass, not just this slice's own new test. This is what "full-suite gate" is meant to catch in principle, but the per-file/per-touched-area view is the check that actually surfaces a regression an aggregate number would hide.

Skip the coverage/mutation bullets silently if the project has no such tooling configured — introducing that kind of tooling fresh is a decision for the user to make, not something to smuggle in as a side effect of executing a plan. Lint/static-analysis is the one exception: absence gets a one-time suggestion (see above) rather than silence, since it's cheap to flag and commonly missing by oversight rather than by choice. Either way, if the tooling *is* there, "the tests I wrote pass" is not sufficient to call the slice done on its own.

Once the full-suite gate and every applicable piece of the quality gauntlet pass, this is the green state to commit per Step 2.9. If any of them fail, refactor and fix the actual cause (per the anomaly-handling rules in Step 4) before committing — don't commit a slice with a known-failing gate, and don't work around a gate by weakening it.

### Step 4 — Handling anomalies (bounded self-correction)

If something breaks the expected flow — a RED test unexpectedly passes, a full-suite run shows a regression beyond baseline, a guardrail conflict, or a source-of-truth citation you can't find — don't immediately hand it back to the user. First attempt a bounded, single-pass self-correction:

- **Dishonest RED (test passes when it shouldn't):** before rewriting anything, append the falsely-passing attempt's actual output to the RED evidence file, labeled `-- attempt 1 (unexpectedly passed) --`, so the record shows this was caught and corrected rather than silently replaced. Then re-read the slice's Step 1 instructions for the deliberately-wrong-assertion technique, re-derive the assertion once, rerun, and append that result labeled `-- attempt 2 --`, confirming it now fails for the right reason. If it still doesn't produce an honest failure after this one retry, stop and report the specific test, what you tried, and why it's still not RED — don't keep guessing.

- **Unexpected full-suite regression:** re-run once to rule out flakiness, then check whether the failing test falls inside the plan's declared baseline-caveat scope. If not, stop and report the failing test name/output rather than patching it silently — a regression outside baseline often means a different slice's boundary was crossed.

- **Can't find a source-of-truth citation:** search the actual spec documents once more (don't just re-read the slice file), including sibling sections that might phrase it differently. If still not found after that pass, stop and ask the user rather than inventing or loosely paraphrasing a value.

- **Quality gauntlet failure (coverage below threshold, a surviving mutant, a new lint/static-analysis error, a build/compile failure, or a previously-passing test on a file this slice touched now failing):** first check whether it's actually caused by this slice's own diff or a pre-existing baseline condition (same test as the full-suite regression check). If it's this slice's doing, refactor and fix the real cause — strengthen the assertion a surviving mutant exposed as weak, add the missing case a coverage gap revealed, fix the lint/static-analysis violation, fix whatever doesn't compile, or fix the regression in the other test — then rerun the gate once. If it still fails after that one attempt, stop and report the specific failure (which mutant survived and why, which lines are uncovered, the exact lint/build error, which other test broke) rather than lowering the threshold, excluding the file, or silencing/suppressing the linter to make the gate pass.

After one bounded self-correction attempt, if the issue persists, always escalate to the user with the concrete evidence (actual failing output, the guardrail text, the missing citation, the surviving mutant/coverage gap) rather than a vague "something went wrong."

### Step 5 — Reporting

After each slice, report concisely: which TC(s) it satisfies, the RED/GREEN evidence paths written, the acceptance criteria checked off, the literal source-of-truth citation used (so the user can spot-check it), the commit hash/message if one was made (or a note that the project isn't under git, if that's why one wasn't), and the outcome of any quality gauntlet checks that ran (coverage %, mutation score/survivors, lint/static-analysis result, build/compile result) — or a note that the project has none of that tooling, so it's clear the omission was checked for, not overlooked. If there's no linter/static-analysis tool at all, include the one-time suggestion to add one here (named for the project's actual stack), rather than as a per-slice aside. Don't restate the Gherkin or re-paraphrase the slice file's own prose back at the user — point at what you did and where the evidence lives.

At the end of a wave or the full plan, summarize against `00-overview.md`'s Definition of Done checklist directly.

## Common failure modes this skill exists to prevent

- Marking "RED captured" when no test was actually run (narrated instead of real).
- Writing a test whose expected value was copied from the implementation instead of the spec (the tautology this whole gate exists to catch).
- Quietly implementing a retry path, dismiss gesture, or extra state the slice's Guardrails explicitly forbid, because it "seemed reasonable."
- Treating a pre-existing, plan-acknowledged baseline failure as a regression you need to fix (or the inverse: waving off a real new regression as "probably the known one" without checking).
- Restating a TC's Gherkin steps inside the slice file or the final report, when the slice explicitly says not to (the spec documents are the single source of truth; duplicating it invites drift).
- Skipping ahead to a later-wave slice because its dependency "looks done," without verifying its GREEN evidence file actually exists.
- Treating a green test suite as the finish line when the project already has coverage thresholds, mutation testing, or lint/typecheck wired in — those exist precisely so a human doesn't have to read the diff to trust it; skipping them defeats the point.
- Running a full-project mutation sweep after every single slice on a codebase where that takes an hour, instead of scoping it to the slice's changed files or deferring the full run to wave-end/Final Verification.
- Lowering a coverage threshold, excluding a file, or weakening an assertion just to make the quality gauntlet pass, instead of treating a real gap or surviving mutant as a real signal to fix.
- Treating "tests pass" as proof the code compiles/builds cleanly, when the project has its own separate build or typecheck step that was never actually run.
- Checking only the aggregate coverage/pass-rate number and missing that a specific file this slice touched quietly regressed underneath it.
- Silently saying nothing when a project has no linter/static-analysis tool at all, instead of surfacing a one-time, stack-appropriate suggestion to add one.
- Sweeping unrelated files into a slice's commit with `git add -A`/`.`, or squashing multiple slices into one commit, losing the per-slice rollback point the history is supposed to provide.

---
name: tdd-plan
description: Turn a completed spec bundle (SPEC.md + TEST-SPEC.md + UI-CONTRACTS.md + API-CONTRACTS.md + TECHNICAL-DESIGN.md) into an executable, measurable, verifiable TDD plan — tracer-bullet vertical slices grouped into execution waves, each traced to a test case (TC) by reference (never restated), gated by a RED→GREEN loop with red/green evidence captured to disk, and closed by an adversarial coverage/tautology audit. The plan is written wherever the project keeps its plans — there's no default location, this skill asks the user once and remembers the answer via `wisec.json`'s `plansDir` field (the same file `/spec` uses for `specUri`). Use after specs are written and before implementation, when the user wants AI to build a feature deterministically test-first. Also covers refining/amending an existing plan already on disk — a spec change that needs the plan re-derived, a review finding that traces to the plan layer (wrong guardrail, missing slice, stale coverage table), or any other requested adjustment to a plan bundle that already exists.
---

# TDD Plan (create / refine)

Turn a finished spec bundle into a **TDD execution plan**: an ordered set of tracer-bullet vertical slices where each slice is **executable** (one clear action), **measurable** (sized to one context window, with acceptance criteria), and **verifiable** (a named failing test proves it, drawn from the Test Spec, with an independent source of truth).

This skill sits between specs and code. It does not invent requirements. Every slice must trace back to an artifact already written. If a slice has nothing to trace to, the spec is incomplete — surface the gap, don't fill it.

This skill covers two jobs — figure out which one the request maps to before starting:

1. **Create** a new plan from a completed spec bundle (Job 1 — "Process" below covers this in full).
2. **Refine / amend** a plan that already exists — a spec changed underneath it, a review finding traced back to the plan layer, or the user just wants a targeted adjustment (Job 2, after "Process").

Job 1's steps (coverage matrix, seams, slice drafting, waves, evidence conventions) are the shared vocabulary Job 2 also uses — read Job 1 first even if you're here for Job 2, since Job 2 assumes you already know what a coverage matrix, a wave, and evidence keyed by `TC-id` mean.

## What determinism means here

An LLM builds deterministically when each unit of work has a **pre-agreed pass/fail oracle it cannot argue with**. This skill supplies that oracle from the spec:

- **Executable** — the slice states exactly what to build as end-to-end behavior, not a layer list. One action, one context window.
- **Measurable** — the slice has acceptance criteria copied from the Test Spec's Gherkin, and a size that fits one fresh context.
- **Verifiable** — the slice names the `TC-N` it satisfies, the exact command that runs that test, and the expected RED (fail) → GREEN (pass) transition. The expected value comes from an **independent source of truth** (a spec literal, a worked example, a fixture) — never recomputed the way the code computes it.

The tag chain is the spine. A test case like `TC-7` already declares `@FR-7 @EC-2 @SM-MOB-1 @SM-MOB-2`. A slice that makes `TC-7` go green transitively satisfies those FRs, edge cases, and state-machine rows. **A slice with no `TC-N` is not verifiable and must be rejected or the Test Spec must be extended first.**

### The one rule that keeps the oracle incorruptible: reference, never restate

A slice **cites** a `TC-N`; it never copies the test's steps or expected values into the plan — the pass/fail authority must live in exactly one place, the Test Spec, so the model cannot rewrite the oracle to suit its output. See `references/traceability.md`'s "Reference, never restate" section for the full rule, why it matters, and the anti-pattern it forbids; this file assumes it throughout.

### Proof must be captured, and proof must include RED

"Tests pass" is not evidence unless it was possible for them to fail. Each slice captures two evidence files per `TC`: a **RED** capture (the test failing before implementation) and a **GREEN** capture (passing after). The RED file is what makes the GREEN file honest — it proves the test discriminates. A GREEN with no matching RED is rejected by the final audit. See `references/evidence.md`.

## Where plans live

A plan lives at `<plansDir>/<feature-slug>/`, a root kept separate from wherever the spec bundle lives — the two are connected only by a relative-path backlink line in `00-overview.md` (see step 7), never by sharing a directory. Resolve `<plansDir>` exactly the way `/spec` resolves `specUri`, since both settings live in the same `wisec.json`. Unlike `specUri`, `plansDir` is always a local path — there's no Confluence-mirror equivalent for plans.

1. **A plan for this feature already exists on disk** — use wherever it already lives, full stop. Don't move it or ask about convention; infer the root from the existing path.
2. **`wisec.json` at the repo root** — if present, its `plansDir` field is the root to use (e.g. `{"plansDir": "docs/plans"}`).
3. **Neither exists yet (first plan in this repo)**:
   - **The user's own request already named a path** (e.g. "put the plan under docs/plans/") — use that path directly. Write `wisec.json` with it so the next feature doesn't have to repeat it.
   - **Otherwise, default to `.wise/plans/<feature-slug>`** — don't ask; announce the default in your response (e.g. "no `plansDir` configured, writing this plan to `.wise/plans/<feature-slug>/`") so it's visible and correctable, and write `wisec.json` with `{"plansDir": ".wise/plans"}` so the next feature reuses it without re-deciding. If the user objects, move the plan and update `wisec.json` — cheap to fix since nothing else references the path yet at this point in the process.

`wisec.json` is shared with `/spec` — if it already exists with a `specUri` (or the older `specsDir`) field, add `plansDir` alongside it rather than creating a second config file:
```json
{
  "specUri": "docs/features",
  "plansDir": "docs/plans"
}
```
These are two *separate* roots by convention — a plan lives apart from its spec bundle's files, connected only by the backlink line in step 7. Only set `plansDir` equal to `specUri` if the project wants the plan back alongside its spec bundle as a 6th file, the older convention.

Everywhere below, `<plansDir>/<feature-slug>/` is this resolved root — never write to `.scratch/` or any other guessed path once it's been resolved.

## Inputs — the spec bundle

Discover these in the repo before doing anything else. Resolve the spec bundle's location the same way — an already-existing bundle's own path, else `wisec.json`'s `specUri` field, else ask (see `/spec`'s "Where specs live" for the full resolution order; don't re-derive it differently here). If `specUri` is a Confluence URL, the local, validator-passing copy — not the Confluence pages — is what you read: it lives at `.wise/specs/<feature-slug>/` (see `/spec`'s "`specUri` pointing at Confluence"). The user may also just hand you the path directly (e.g. `docs/features/<area>/specs/<feature>/`) — that counts as already resolved. Read every file in the bundle. The expected bundle:

| File | Provides | ID scheme |
| --- | --- | --- |
| `SPEC.md` | Functional & non-functional requirements, edge cases, external deps, out-of-scope | `FR-N`, `NFR-N`, `EC-N` |
| `TEST-SPEC.md` | Gherkin scenarios, each tagged to the reqs/states it covers | `TC-N`, tags `@FR-N @EC-N @SM-MOB-N` |
| `UI-CONTRACTS.md` | Navigation graph, state-machine rows, Figma node map | `SM-MOB-N` |
| `API-CONTRACTS.md` | Endpoints, request/response schema, status examples | endpoint path + `EC-N` refs |
| `TECHNICAL-DESIGN.md` | Sequence diagrams, module boundaries | module names (e.g. `features:cart`) |

If a file is missing, or IDs don't line up (a `TC` references an `FR` that doesn't exist, an `FR` has no covering `TC`), that is a **coverage gap** — record it and raise it in the quiz step. Do not proceed past a gap silently.

See `references/traceability.md` for the full ID-chain rules and how to build the coverage matrix.

## Process

### 1. Read the whole bundle and build the coverage matrix

Read all five files. Then build a **coverage matrix** mapping every `TC-N` to the `FR/EC/SM` tags it carries, and — critically — the reverse: every `FR-N` and `EC-N` to the `TC`s that cover it.

- An `FR` or `EC` with **no covering `TC`** is an untestable requirement → gap.
- A `TC` tagged with an ID that **doesn't exist** in the source file → broken reference → gap.
- An `SM-MOB-N` state transition with no `TC` exercising it → uncovered state → gap (note it; not always blocking).

Also note **NFRs with `TBD` targets** (e.g. a latency threshold marked `TBD`) — these are unverifiable by construction and cannot become acceptance criteria until a number is confirmed. Flag them, don't invent numbers.

### 2. Discover the stack

The TDD loop is universal; the commands are not. Before proposing any slice, discover how *this* repo tests (see `references/tdd-loop.md`):

- Build system and language (`package.json`, `build.gradle`, `pyproject.toml`, `go.mod`, `Cargo.toml`, a `Makefile`)
- Test framework, and how it runs **one focused test** vs the **full suite**
- Where tests live and how they're named
- Checked-in wrappers (`./gradlew`, `./mvnw`, `make test`) over globally installed tools
- The module boundaries the Technical Design names (e.g. `features:cart` orchestrates, `features:catalog` owns pricing lookups) — slices respect these

Record the two commands you'll use in every slice: **focused-test** and **full-suite**. Never assume `npm test`.

### 2a. Index available skills

The agent that later executes this plan may be a fresh context with no memory of what's invocable here. Build that index now, once, so slices can point at what's relevant instead of every executor re-discovering it cold. See `references/skills-index.md` for the full method — in short: enumerate whatever skill/command registry this environment exposes (a visible skill listing, on-disk skill directories at whatever levels this environment defines, custom commands, MCP tools), read each one's own description for its trigger condition, and keep only the ones plausibly relevant to this plan.

Record this as a **Skills index** table — `Skill | Source | Triggers when` — for `00-overview.md`. This is invocable capability outside the plan's own vocabulary, never to be confused with the `FR`/`TC` tag chain.

### 3. Agree the seams

A **seam** is the public boundary a test observes behavior at, without reaching inside. Tests live at seams, never against internals.

Derive candidate seams from the artifacts:
- **State-machine rows** (`SM-MOB-N`) → the seam is the state transition: given state + event → do + next state. Test the observable transition, not the internal handler. Carry that row's Figma Node URL from `UI-CONTRACTS.md`'s Screen State Map forward as the slice's Design reference — copy it verbatim, never invent one, and pass through `TBD` as-is rather than guessing.
- **API contracts** → the seam is the request/response boundary. Test against the documented schema and status examples, not the HTTP client.
- **Sequence diagram module boundaries** → the seam is the public interface between modules (`features:cart` ↔ `features:catalog`), not private functions.

**Write down the seams under test and confirm them with the user in the quiz step. No test is written at an unconfirmed seam.** This is how testing effort lands on the critical paths instead of every internal edge.

### 3a. Map the files

Before drafting slices, build one **Files table** for the whole plan: `Path | Responsibility | Module (per Technical Design) | Slice`. This isn't a fresh architecture pass — the module boundaries already came from `TECHNICAL-DESIGN.md` in step 2/3 — it's making that decomposition explicit in one place *before* each slice starts claiming Create/Modify/Test paths independently.

Doing this up front catches what a slice-by-slice view hides until the quiz step, or later:
- Two slices modifying the same file (or overlapping line ranges) with no blocking edge between them.
- A new file whose proposed module doesn't match the Technical Design's boundary for that responsibility (e.g. a `features:catalog` file doing `features:cart`'s job).
- A responsibility with no file at all yet, or a file with no responsibility tying it to a `TC` — either is a sign a slice's Files section is about to be guessed rather than grounded.

Leave the `Slice` column blank until step 4 fills it in as slices are drafted; the table is a cross-slice check, not a step you finish before the ones that follow. Carry the finished table into `00-overview.md` (step 7) and put it in front of the user at the quiz step (step 6) alongside the coverage matrix — file-layout conflicts are exactly the kind of thing worth catching before approval, not after a slice is half-written.

### 4. Draft vertical slices (tracer bullets)

Break the work into **tracer-bullet** slices:

- Each slice cuts a **narrow but complete** path through every layer it needs (state, network, UI, persistence, test) — vertical, NOT a horizontal layer.
- A completed slice is **demoable or verifiable on its own** — it makes at least one `TC-N` go green.
- Each slice is **sized to fit one fresh context window**. If it needs more, split it.
- Give each slice its **blocking edges**: the slices that must complete before it can start. A slice with no blockers starts immediately.
- **Group by dependency, not by layer.** `TC-5` (maintenance gate clears) blocks `TC-1/TC-2` (routing) because routing runs *after* the maintenance check succeeds — the tag chain and the `FR` dependency column (`Dependency (FR-ID)` in `SPEC.md`) tell you the order.

Prefer prefactoring first: "make the change easy, then make the easy change."

**Slice sizing.** "Fits one context window" is a capacity ceiling, not a design principle — it tells you the max, not where to actually cut. Cut where a fresh reviewer, seeing only this slice's `00-overview.md` row and its own file, could plausibly approve it while rejecting its neighbor. That's the real grain of a slice:

- **Fold in what the deliverable needs.** Setup, config, migrations, and scaffolding a slice's `TC` can't pass without belong *inside* that slice, not hived off as a separate one — a scaffolding-only slice has no `TC` of its own to satisfy and fails the "no `TC-N` → not verifiable" rule.
- **Split only at an independent decision point.** If reviewing slice A tells you nothing about whether slice B is correct, they're already separate. If approving one means the other must also be approved (they share a `TC`, or B's code is unreachable without A's), they're one slice pretending to be two.
- **Too coarse** looks like: a slice satisfying more than one unrelated `TC`, or a Files list spanning modules the Technical Design says don't share a boundary. Split along the seam, not the middle.
- **Too fine** looks like: a slice with no seam of its own (it only exists to unblock the next one), or two slices whose RED tests would be identical except for the implementation stub. Merge them.

Raise sizing calls in the quiz step (step 6) alongside the wave/blocker questions — sizing is a judgment call the user should see and can override, not something to lock in silently while drafting.

**Wide refactors are the exception.** A mechanical change whose blast radius fans across the codebase (rename a shared symbol, retype a field) can't land green as one vertical slice. Sequence it **expand → migrate (batched) → contract**, each batch its own slice keeping the suite green. See `references/tdd-loop.md`.

Each drafted slice must carry, at minimum — the first five live in the slice file's YAML frontmatter, everything else in the Markdown body:

- **`status`** (frontmatter) — `ready-for-agent`, or `blocked (<why>)`
- **`satisfies`** (frontmatter) — the `TC-N`(s) it makes green (and, transitively, their `@FR/@EC/@SM` tags)
- **`wave`** (frontmatter) — which execution wave it belongs to (see step 5)
- **`blocked_by`** (frontmatter) — earlier slice numbers/titles, or `[]` for "None — can start immediately"
- **`uses_skills`** (frontmatter) — which entry/entries from the skills index (step 2a) apply to executing this slice, or `[]` for "None — plain RED→GREEN loop" when the loop itself is all it needs. Don't force-fit a skill that doesn't match its trigger.
- **Title** — short, in the project's domain vocabulary
- **What it delivers** — end-to-end behavior from the user's perspective
- **Files** — exact Create/Modify/Test paths this slice touches (a line range on Modify only if already known — don't invent one)
- **Interfaces** — Consumes/Produces: the exact signatures this slice relies on from earlier slices, and the exact signatures it exposes for later ones. A later slice's implementer sees only their own slice file, so this is the only place they learn what a dependency actually exposes.
- **Seam** — the confirmed public boundary the test observes. If it derives from an `SM-MOB-N` row, also carry that row's Figma Node URL from `UI-CONTRACTS.md`'s Screen State Map as a **Design reference** — never re-derive or guess it, and never invent one where the source says `TBD`.
- **Guardrails (Must NOT do)** — explicit negative scope: what this slice must not touch or add. Stops the scope creep the coverage matrix won't catch.
- **Evidence** — the RED and GREEN capture paths, keyed by `TC-id` (see `references/evidence.md`)
- **Steps** — the explicit RED → confirm-fail → implement → confirm-pass → full-suite-and-commit checklist, one TC's worth of RED/implementation code *skeleton* per step-block (placeholder names, never a restated spec value — see the template's own warning)
- **Acceptance criteria** — the `TC`'s `Then` clauses **by reference**, as a checklist, plus the red-before-green and full-suite boxes
- **Source of truth** — where each expected value comes from (spec literal / API example / fixture) so the test can't be tautological

Use the per-slice template in `references/slice-template.md` — copy it verbatim, don't improvise the shape from this bullet list alone.

### 5. Group slices into execution waves

Collapse the blocking DAG into **waves**: a wave is the set of slices whose blockers are all satisfied by earlier waves, so every slice in a wave can run in parallel. Wave 1 = slices with no blockers. Wave 2 = slices blocked only by Wave 1. And so on. A **Final Verification Wave** always runs last (step 9).

Record a dependency matrix — `Slice | Depends on | Blocks | Wave` — so the parallel-vs-sequential structure is explicit. A purely linear feature is just one slice per wave; that's fine.

### 6. Quiz the user — approval gate (BLOCKING)

Present the plan as a numbered list grouped by wave. Do NOT write any slice files or any code before the user approves. Show, per slice: Title, Satisfies (`TC`s), Wave, Blocked by, Uses skills, What it delivers, Files, Interfaces, Seam, Guardrails.

Then present, separately:
- **Coverage matrix** — every `FR`/`EC` and whether a slice covers it.
- **Files table** (from step 3a) — the whole-plan file layout, with any conflicts (shared files across unblocked slices, module mismatches) called out explicitly rather than left for the user to spot.
- **Gaps** — uncovered reqs, broken tag references, `TBD` NFR targets, unconfirmed seams, and any requirement whose only proposed test can't actually prove it (e.g. a p95 latency budget "proven" by one unit test). State each as a question, not an assumption.

Ask the user:
- Does the slicing granularity feel right (too coarse / too fine)?
- Are the blocking edges and wave grouping correct?
- Are the seams the right boundaries to test at?
- Does the file layout hold up — any file two slices both expect to own, or a module assignment that looks wrong?
- Are the skill tags on each slice right — anything missing, or forced in where it doesn't fit?
- How should each gap be resolved — extend the Test Spec, confirm a `TBD`, or accept as out-of-scope?

Iterate until the user approves. Only then proceed.

### 7. Write the plan — overview + one file per slice

On approval, write under `<plansDir>/<feature-slug>/` (resolved above in "Where plans live"):

- `00-overview.md` — a **Spec:** backlink line near the top, the relative path from `<plansDir>/<feature-slug>/` to the spec bundle's `SPEC.md` (this is the only link between the two roots, since they're resolved independently and may not be nested under each other), then TL;DR, waves, dependency matrix, the **Files table** (from step 3a, with the `Slice` column filled in), a **Skills index** (from step 2a, trimmed to what's relevant here), and a **Definition of Done** whose gates are: all slice evidence present (red+green per `TC`), full suite green, build succeeds, Final Verification Wave approved.
- `00-coverage.md` — the coverage matrix and the agreed resolution for every gap.
- One `<NN>-<slug>.md` per slice, numbered in **dependency order** (blockers first), using `references/slice-template.md`. Skim `examples/app-entry/` first if this is your first plan — it's the same template filled in for real, across multiple files, including a `blocked` slice.

Exact file paths in the Files section are expected, not something to avoid — that's the point of the section, and a later slice's implementer needs the real path, not a vague description. The one thing still worth avoiding is a path you're guessing at rather than one grounded in the actual codebase (an existing file you found, or a new one whose location follows the codebase's own module conventions) — an invented-sounding path is worse than pointing at the real seam and saying so. Code skeletons in the Steps section are expected too, but stay placeholder-shaped per `slice-template.md`'s own warning — never a restated spec value standing in as if it were the real answer.

### 8. Execute wave by wave (strict per-slice gate + evidence)

Work waves in order; within a wave, work the frontier. For each slice, run the strict gate — the loop cannot skip a step, and each RED/GREEN is captured to disk:

```
1. RED     — write the test the slice references, at the agreed seam.
             Run the focused command. It MUST fail. Capture output to
             evidence/<TC-id>.red.txt. A test green on first run proves
             nothing — fix the test until it's red for the right reason.
2. GREEN   — write the minimum code to pass. No speculative features.
             Run the focused command. It MUST pass. Capture output to
             evidence/<TC-id>.green.txt.
3. VERIFY  — tick every acceptance box against the TC's Then clauses (by
             reference). Confirm expected values came from the source of
             truth, not recomputed. Run the FULL suite — no regressions.
4. MARK    — mark the slice done only when 1–3 hold and both evidence
             files exist. Move to the next frontier slice.
```

A slice is **not done** until its `TC` is green, the full suite is green, both evidence files exist, and every acceptance box is checked against an independent oracle. "Seems right" is not done. This maps directly onto the slice file's own `## Steps` checklist (per TC: RED = 2 steps, GREEN = 2 steps, numbered globally down the file — not restarting at 1 per TC — plus one final full-suite + commit step) — tick each box as it's genuinely done, not in advance.

### 9. Final Verification Wave (adversarial, runs last)

After all slices are done, run a closing audit. Each step writes its own evidence file. This wave does not re-run what already passed — it checks the plan was honestly satisfied:

- **F1 — Coverage audit.** Every `FR`/`EC` has a covering `TC`; every `TC` in scope has a done slice. No silent gaps remain.
- **F2 — Evidence audit.** Every in-scope `TC` has BOTH a `.red.txt` and `.green.txt`. A missing red file means the test was never proven able to fail → fail the audit.
- **F3 — Tautology & drift audit.** No slice restated a test's steps/expected values (reference-only rule held); every asserted expected value traces to an independent source of truth.
- **F4 — Scope-fidelity audit.** Every "Must NOT do" guardrail held; nothing outside the approved slices was built.
- **F5 — Full suite + build.** Full test suite green and build succeeds, captured fresh.

The feature is done only when F1–F5 pass. See `references/final-wave.md`.

## Job 2: Refine / amend an existing plan

This is the same plan bundle Job 1 produces — `00-overview.md` + `00-coverage.md` + numbered slice files — but already on disk, with the request being a change to it rather than a fresh one. Four entry points land here:

- **The spec changed underneath it.** A `/spec` amendment added, removed, or altered an `FR`/`EC`/`TC` that this plan's coverage matrix was built from. The plan is now stale relative to its own source of truth.
- **A review finding traces to the plan layer**, not the spec or the implementation — `/apply-review-findings`'s Step 2 is the authoritative classifier for what counts as plan-level; if it routed a finding here, treat that classification as settled rather than re-deriving it.
- **A cold bug report or enhancement ask traces to the plan layer** — `/intake-triage`'s Step 3 uses the same plan-level classification as `/apply-review-findings`, just against a raw report instead of a review finding; if it routed here, treat that classification as settled the same way.
- **A direct request** to adjust the plan — re-split a slice that's too coarse, fix a wrong "Blocked by" edge, correct a seam that was mis-agreed.

### 1. Find what actually changed

Read the plan's `00-overview.md` (for its Spec: backlink and dependency matrix) and `00-coverage.md` (for the coverage matrix as it stood when last written), then re-read the *current* spec bundle. Diff the two coverage pictures — don't assume the request tells you the full blast radius:

- A **new or changed `FR`/`EC`/`TC`** with no slice covering it (yet, or accurately) → needs a new slice, or an existing slice's RED test/acceptance criteria updated.
- A **removed `FR`/`EC`/`TC`** that a slice still cites → that slice is now scope without a requirement behind it. Don't silently delete it — mark it and ask the user whether to remove the slice (and its code) or keep the behavior and add it back to the spec instead.
- A **plan-only fix** (guardrail wording, a wrong blocking edge, a seam correction) with no spec-side change at all — smallest blast radius, touches one slice file and possibly the dependency matrix.

### 2. Classify the impact per slice, including on evidence already captured

For every slice touched by the change, decide which of these it is — this determines whether `/tdd-plan-executor` can trust its existing evidence or must redo the slice:

- **New slice** — write it fresh, per Job 1's slice template, numbered and inserted in dependency order (renumbering later slice files if it lands in the middle — update every "Blocked by" reference that pointed at an old number, in every affected slice file and in `00-overview.md`'s dependency matrix).
- **Existing slice, RED test or expected values changed** — its prior `evidence/<TC-id>.red.txt`/`.green.txt` no longer prove anything about the new requirement. **Explicitly invalidate that evidence** (state it in the slice file and in your report to the user) rather than leaving stale files that could be mistaken for still-valid proof — `/tdd-plan-executor` must treat this slice as pending again, not skip it because files happen to exist at those paths.
- **Existing slice, unaffected** — leave it and its evidence alone. Don't touch a slice file just because you're editing the bundle; an unrelated diff makes the next reviewer wonder what else changed.
- **Obsolete slice** — the requirement it satisfied was removed. Confirmed with the user (see step 1) before removing the file; note the removal in `00-overview.md`'s dependency matrix so blocked-by references don't point at a file that no longer exists.

### 3. Update the bundle

- `00-coverage.md` — re-derive the coverage matrix for the affected `FR`/`EC`/`TC` range (not the whole document, unless the change is broad enough to touch all of it) and record the gap resolution the same way Job 1's quiz step does.
- `00-overview.md` — update the dependency matrix, wave grouping (a new slice may shift what belongs in which wave), and the Definition of Done if the gate set itself changed.
- Slice files — write new ones, edit changed ones, remove confirmed-obsolete ones, per the impact classification in step 2.

### 4. Confirm before writing — scoped to the delta, not the whole plan

Show the user what's changing: which slices are new, which have invalidated evidence and need re-execution, which are removed, and the updated dependency/wave picture — a delta, not a full re-quiz of the entire plan (Job 1's approval gate already happened once; don't make the user re-approve slices nothing touched). This still blocks writing, same as Job 1's step 6 — a plan edit is not lower-stakes than a plan creation just because it's smaller.

### 5. Report back

State plainly which slices need `/tdd-plan-executor` to run again (invalidated evidence, new slices) versus which are untouched and still done. This is what lets the fix-and-re-review loop (`/apply-review-findings`) know exactly what to dispatch next, instead of re-running the whole plan from scratch or trusting stale evidence.

## Red flags — stop and fix

- A drafted slice with no `TC-N` → not verifiable. Reject or extend the Test Spec first.
- A slice that restates a test's steps or expected values instead of referencing the `TC` → drift surface, delete the restatement.
- An acceptance criterion that isn't a `Then` clause from a `TC` → you're inventing behavior.
- A GREEN evidence file with no matching RED → the test was never proven able to fail.
- A test written at a seam the user didn't confirm.
- A slice's `uses_skills` entry doesn't match that skill's own trigger condition → forced fit, set it to `[]` instead.
- A test that passes on first run (RED that isn't red) → it isn't testing what you think.
- An expected value computed the same way the code computes it → tautological, delete it.
- An `NFR` with a `TBD` target, or a budget "proven" by a test that can't actually measure it (p95 latency via one unit test) → unverifiable, flag it.
- Marking a slice done without running the full suite, or closing the feature without the Final Verification Wave.
- Reaching for `npm test` without checking what this repo actually uses.

## References

- `references/skills-index.md` — how to enumerate skills available in the current environment and tag each slice with the ones relevant to executing it.
- `references/traceability.md` — ID-chain rules, coverage matrix, gap taxonomy, reference-not-restate rule.
- `references/tdd-loop.md` — RED→GREEN rules, seams, anti-patterns, tautology guard, wide-refactor sequencing, stack discovery.
- `references/evidence.md` — evidence file convention (red/green, keyed by `TC-id`) and why it replaces duplicated QA scenarios.
- `references/final-wave.md` — the F1–F5 adversarial closing audit.
- `references/slice-template.md` — the per-slice file template + overview/coverage files.
- `examples/app-entry/` — a fully worked App Entry (Splash & Onboarding) plan as real, separate files (`00-overview.md`, `00-coverage.md`, `01`-`06` slice files) — skim this before drafting your first plan. A plan is never one file with everything folded in; this is what the actual multi-file shape looks like, including a `blocked` slice.

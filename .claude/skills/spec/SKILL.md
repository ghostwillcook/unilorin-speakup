---
name: spec
description: Creates, validates, lints, reviews, and refines feature spec bundles (SPEC.md + TEST-SPEC.md, mandatory, plus optional API-CONTRACTS.md, UI-CONTRACTS.md, and/or TECHNICAL-DESIGN.md), stored wherever the project keeps its specs — there's no default location, this skill asks the user once and remembers the answer via `wisec.json`'s `specUri` field. `specUri` can be a local path (the default) or a Confluence space/page URL, in which case the bundle is also mirrored there as child pages after the local (still-authoritative) files validate clean. Works regardless of tech stack — backend, web, iOS, Android, desktop, or any mix. Use this whenever the user wants to generate a new feature spec, write technical specification docs, check/lint/validate an existing spec's markdown structure, fix heading numbering or dangling references, review/adjust/refine any file in a feature spec bundle, or configure/change where specs are stored (including pointing them at a Confluence URL). Always run scripts/validate.ts as a compile check after writing or editing any of these files, and treat a non-zero exit / any "error" line as a build failure to fix before finishing.
---

# Feature Spec Bundle (create / validate / refine)

This project keeps one structured spec bundle per feature — see "Where specs live" below for how the root is decided. This skill covers three related jobs — figure out which one the user's intent maps to before starting:

1. **Create / generate** a new feature's spec bundle from scratch (or from a rough feature description).
2. **Validate / lint / compile-check** an existing bundle's structure.
3. **Review / refine / adjust** an existing bundle — apply a requested change, then re-validate.

A fourth job, adding a new kind of technical file to a bundle, is covered separately below since it only comes up occasionally.

All jobs converge on the same end state: a bundle that passes `scripts/validate.ts` with zero errors. Read `references/structure.md` once at the start of any of these jobs — it's the shared rulebook (file layout, why it's split, heading numbering, cross-reference rules) that the validator enforces mechanically. It's an overview, not the full per-file detail: when you're about to write or edit one specific technical file, also read that file's own reference under `references/files/` (`spec.md`, `api-contracts.md`, `ui-contracts.md`, `technical-design.md`, `test-spec.md`) — that's where its section-by-section shape and the ID prefixes it defines actually live. Don't load references for files that aren't part of this task.

**Mandatory vs. optional files.** `SPEC.md` and `TEST-SPEC.md` are always part of the bundle — every feature has requirements and needs tests no matter what it's built with. `API-CONTRACTS.md` (endpoint/operation contracts — REST, GraphQL, or gRPC), `UI-CONTRACTS.md` (state machine + Figma screen-state map, for features with a Frontend/Mobile screen surface), and `TECHNICAL-DESIGN.md` (sequence diagrams for a backend that orchestrates calls across multiple external/internal services) are optional — a feature only gets the ones that match a surface it actually has. `ENTITIES.md` and `USE-CASES.md` are *not* part of this bundle (removed by request — see `references/structure.md` for why); don't create them unless the user explicitly asks.

## Where specs live — there is no default, always resolve it explicitly

Every project keeps specs somewhere different — `.wise/specs/`, `docs/features/`, right alongside the code, a Confluence space, whatever that team already does. This skill doesn't assume any one of those is more "correct," so it never falls back to a bare default. Resolve the root in this order:

1. **A bundle for this feature already exists on disk** — use wherever it already lives, full stop. Don't move it or ask about convention; infer the root from the existing path.
2. **`wisec.json` at the repo root** — if present, its `specUri` field is the root to use (e.g. `{"specUri": "docs/features"}`). This is what lets a project answer once instead of repeating it in every prompt. (`specsDir` is the older name for this same field — if a project's `wisec.json` still has `specsDir` instead, treat it exactly like `specUri` holding a local path; don't ask the project to migrate, just read either key.)
3. **Neither exists yet (first spec bundle in this repo)** — you need a real answer before creating anything:
   - **The user's own request already named a path or a Confluence URL** (e.g. "put the spec under docs/specs/", or a link to a Confluence space/page) — use that value directly; no need to ask first, they already answered. Write `wisec.json` with it so the next feature doesn't have to repeat it.
   - **Otherwise, ask** — e.g. via `AskUserQuestion` — before creating the bundle. Don't guess a plausible-looking path (`.wise/specs/`, `docs/specs/`, whatever) and proceed as if it were confirmed; a guessed root that turns out wrong means the bundle has to move later, and a silent guess is worse than an honest pause. Once they answer, write `wisec.json` with their choice.
   - **You couldn't actually get an answer** (e.g. running as a subagent without a working `AskUserQuestion`, or any other case where the question genuinely didn't reach the user) — don't invent a root or write `wisec.json` on its behalf. Say so plainly in your response instead (e.g. "I need to know where specs should live in this project before I can create the bundle — couldn't confirm that with you, so I've paused here") so the gap stays visible rather than papered over with a guess. This is the same "don't fabricate confirmation" principle as the `figma_ref` `"TBD"` convention below.

This same `wisec.json` file also carries `plansDir`, the equivalent setting for the `/tdd-plan` skill's `IMPLEMENTATION-PLAN.md` output (see that skill's own "Where plans live"). `/spec` doesn't need to read `plansDir` itself — it's mentioned here only so both fields end up in one file instead of two, e.g.:
```json
{
  "specUri": "docs/features",
  "plansDir": "docs/plans"
}
```
These are two *separate* roots by convention, not the same directory — an `IMPLEMENTATION-PLAN.md` lives apart from its spec bundle's files, connected only by a relative-path backlink line (see `/tdd-plan`'s "Where plans live" for exactly how that works). Only set `plansDir` equal to `specUri` if a project wants the plan back alongside its spec bundle as a 6th file, the older convention. `plansDir` is always a local path — `/tdd-plan` reading a Confluence bundle still writes its own plan locally; that's out of scope for this change.

`scripts/validate.ts` has no opinion on any of this — it validates whatever local directory it's handed, so none of the above affects it. This resolution is purely about where *this skill* decides to create a new bundle when the user hasn't said explicitly.

### `specUri` pointing at Confluence

`specUri` is a URI, not necessarily a bare local path. Tell the two cases apart by shape: a relative-looking string (`docs/features`, `.wise/specs`) is a local path exactly like before, no change in behavior. A `http(s)://` URL whose path contains `/wiki/` (a Confluence page or space URL, e.g. `https://<site>.atlassian.net/wiki/spaces/<KEY>` or a specific parent page under it) means this project wants its specs mirrored to Confluence.

**Local files stay the actual source of truth even in this mode** — `scripts/validate.ts` only ever checks markdown on disk, so every job still writes/edits the bundle locally first, exactly per every other section of this skill. The local working copy lives at `.wise/specs/<feature-slug>/` when `specUri` is a Confluence URL (a fixed, non-bikeshed location — the user's actual answer was "Confluence," so don't make them also pick a local convention they don't care about). Only after the local bundle validates clean does the Confluence side happen:

1. **Resolve the feature's Confluence parent page.** Look for a page titled exactly the feature's display name as a child of the `specUri` root (space or page). If it doesn't exist yet, create it as a child of that root.
2. **One Confluence child page per bundle file** (`SPEC.md` → a page titled `<Feature Name> — SPEC`, and so on for `TEST-SPEC.md`/`API-CONTRACTS.md`/`UI-CONTRACTS.md`/`TECHNICAL-DESIGN.md`), each a child of the feature's parent page from step 1. Publish with `contentFormat: "markdown"` so the file's own markdown is what gets rendered — don't hand-convert to Confluence's HTML+ macros yourself.
3. **Track the mapping** in `.wise/specs/<feature-slug>/.confluence-pages.json` (`{"SPEC.md": "<pageId>", "TEST-SPEC.md": "<pageId>", ...}`) so a later refine (Job 3) updates the existing pages instead of creating duplicates. Create this file the first time you publish; read it on every subsequent publish for this feature.
4. **On Job 3 (refine)**, after the local edit re-validates clean, update only the Confluence page(s) for the file(s) that actually changed — don't touch every page in the mapping just because one file changed.
5. **If the Atlassian/Confluence MCP tool isn't available, or a publish call fails**, don't fail the job over it — the local bundle is still valid and complete. Report plainly that the local write succeeded but the Confluence mirror didn't happen (and why), rather than silently skipping it or claiming full success.

This is a mirror, not a two-way sync: don't read edits back from Confluence into the local files. If someone edits the Confluence page directly, the next `/spec` run overwrites it from the local source of truth — that's the same "one source of truth" principle this skill already applies to everything else.

## Why the validator exists

This structure was arrived at through a real back-and-forth: dropping duplicate headings, restarting numbering per file instead of carrying over section numbers from a monolithic doc, catching an `&amp;` escaping bug that crept in from a formatting pass, dropping a redundant yaml-twin-of-every-table convention once it became clear nothing ever parsed it (see `references/structure.md` rule #3). Every one of those was a real mistake made once. The validator exists so the *next* feature doesn't have to relearn any of them by hand — treat it exactly like a compiler: if it reports an error, the file is wrong, not the validator.

## Job 1: Create a new feature spec

The input for this job varies a lot — don't assume it's always a tidy one-liner. It might be:
- Just a feature name ("/spec create workspaces") — you'll need to infer scope from the codebase, or ask the user for a short description if nothing existing gives you enough to go on.
- A short description ("study spaces where users upload sources and organize them").
- A **whole PRD or client requirements doc pasted inline** — pages of prose, possibly with its own headings, user stories, or acceptance criteria that don't match this project's format at all.
- **A link to a PRD living in an external doc tool** (a Confluence page, a Jira issue, a Google Doc) rather than pasted text — if a connected tool can fetch it (e.g. an Atlassian/Confluence MCP tool), read the page directly instead of asking the user to paste it; treat the fetched content exactly like a pasted PRD from here on. A PRD like this often carries a sign-off/approval table, a linked Jira ticket, and links to a Figma file and a test-data spreadsheet alongside the actual requirements — mine the requirements, but also keep those linked artifacts: the Figma link feeds `UI-CONTRACTS.md`'s node map, the test-data link is exactly the kind of independent source-of-truth `/tdd-plan` needs later, and the Jira ticket is worth citing in `SPEC.md`'s Context section for traceability.

In every case the job is the same: extract or infer the real functional requirements, external dependencies, contracts, and test cases, then re-express them in *this* project's bundle format. When given a full PRD, don't just reformat its section headers into this structure — read it for content (what must the system do, what data does it touch, what are the failure modes, what third-party/internal systems does it call into) and re-derive FR/NFR/Edge Cases/External Dependencies/Contracts/Tests from that content. A pasted PRD is a rich source to mine, not a template to preserve. **Strikethrough text is negotiated-out scope, not a formatting accident** — a PRD author who crossed out a line during review meant "we decided against this" — pull it into `SPEC.md`'s Out of Scope section (Section 8) rather than silently dropping it or, worse, treating it as a live requirement because the words are still technically there.

1. Resolve where specs live for this project (see "Where specs live" above), then read `references/structure.md` for the exact file layout and each relevant file's own reference under `references/files/` for its section-by-section shape. If this feature needs `UI-CONTRACTS.md`, also skim `examples/onboarding-mobile/` — a small bundled example that shows a real, validator-clean bundle for exactly that file. If it needs `API-CONTRACTS.md`, skim `examples/account-signup/` instead — a small bundled example for that file. (Neither example demonstrates the other's optional file, since each example feature only has one of those two surfaces.)
2. Figure out which platforms the feature actually touches from what's real for *this* feature — don't default to any particular Server/Frontend split just because it's a familiar shape. A feature might span Backend, Web, iOS, Android, Desktop, and/or a BackOffice/Admin surface, or some other combination entirely; group API/UI contract sections (where present) by whichever of those are real for this feature (see `references/files/api-contracts.md`/`ui-contracts.md` for how the grouping and ID codes generalize). `TEST-SPEC.md` itself is *not* grouped by platform — see step 5 below.
3. **Ask which optional technical files to generate**, unless the bundle already exists on disk (then infer from what's already there instead of re-asking). Pre-select based on what you inferred in step 2, but always let the user confirm or override — don't silently decide. Ask as a single multi-select question, e.g. via `AskUserQuestion`:
   - **API Contracts** — endpoint/operation contracts (REST, GraphQL, or gRPC). Pre-select if the feature has a client-server boundary.
   - **UI Contracts** — state machine + Figma screen-state map per screen/flow. Pre-select if the feature has a Frontend/Mobile screen surface.
   - **Technical Design** — sequence diagrams for backend orchestration across external/internal services. Pre-select if the feature's backend calls 2+ external/internal services in a meaningful order (payment gateway + notification service, multiple internal microservices, ...) — not just because it has `API-CONTRACTS.md`; a single-endpoint feature with no real orchestration doesn't need this even with a client-server boundary.
   - **Other (describe it)** — anything not covered by the above (a save-data contract, a device protocol, ...). Selecting this routes to Job 4 below before continuing.
   `TEST-SPEC.md` is never part of this question — it's mandatory regardless of answer. `ENTITIES.md`/`USE-CASES.md` aren't offered either — they're not part of this bundle (see `references/structure.md`); only create one if the user explicitly names it.
4. Figure out the feature's actual functional requirements, contracts, and test cases — from whatever input was given (name, description, or full PRD), and from the codebase (search for existing routes/models/components touching this feature if any exist). Write **real content**, not placeholders: specific FR statements, concrete endpoint/screen-state schemas, real sequence-diagram call order if `TECHNICAL-DESIGN.md` is in scope. If the input leaves real gaps (e.g. a PRD that never specifies non-functional targets), flag those gaps to the user rather than inventing arbitrary numbers. If `UI-CONTRACTS.md` is in scope, this applies especially to its Figma Screen State Map: never fabricate a Figma Node URL — look it up via a connected Figma MCP tool if one's available, otherwise ask the user for the real link/node per state and use `"TBD"` until they answer (see `references/files/ui-contracts.md`). If `API-CONTRACTS.md` is in scope, check for an existing per-endpoint contract system of record (a Confluence space, an OpenAPI doc, a Postman collection) the same way — see `references/files/api-contracts.md`'s "Check for an existing contract system of record" note — since it's often more current than the PRD's own prose, especially for a PRD describing work already partway implemented.
5. Create `<local spec root>/<spec-name>/` — where `<local spec root>` is `specUri` itself when it's a local path, or `.wise/specs/` when `specUri` is a Confluence URL (see "`specUri` pointing at Confluence" above) — with the mandatory files plus whichever optional ones were selected in step 3, following the exact conventions in `references/structure.md` and each file's own reference under `references/files/`:
   - `SPEC.md`: sections 1-8 (Title/Metadata, Context, FR, NFR, Edge Cases, External Dependencies, Technical Specification links, Out of Scope), numbered from 1.
   - Each technical file opens with its own H1 + backlink line to whichever other technical files exist in this bundle, and numbers its own sections starting from 1 again (they're standalone files now).
   - Every fact lives once: a markdown table where the shape is flat (FR/NFR/EC rows, state transitions), or a heading plus bold-labeled prose fields where it isn't. No paired YAML block duplicating a table — see `references/structure.md` for why.
   - FR/NFR/EC IDs are defined in `SPEC.md`. `TEST-SPEC.md` is a flat list of whole-system Gherkin scenarios (no Unit/Integration/E2E split, no platform grouping — see `references/files/test-spec.md`); each scenario references the IDs it verifies via a Gherkin tag (`@FR-1`, `@EC-2`, ...) directly above `Scenario:`, which doubles as both a real Cucumber tag and this bundle's traceability link — not a separate `**Reference**` field.
6. Run the validator (see below). Fix everything it flags. Do not consider the feature done while it reports any error. If `specUri` is a Confluence URL, only after this passes clean, publish/update the Confluence mirror per "`specUri` pointing at Confluence" above.

## Job 2: Validate / lint an existing bundle

Just run the validator against the target feature directory and report the diagnostics — don't rewrite anything unless the user asked you to fix issues too. If they used a word like "lint", "check", or "validate" without "fix", treat it as read-only: show them the output and let them decide.

## Job 3: Review / refine / adjust an existing bundle

This is also where a spec-level finding from `/apply-review-findings` or a spec-level classification from `/intake-triage` lands — both name the specific requirement gap or contradiction; treat their classification as settled rather than re-deriving whether it's really a spec issue.

If the edit touches `API-CONTRACTS.md`, re-check the live contract system of record (per `references/files/api-contracts.md`) rather than trusting this bundle's existing content — implementation can move between when a spec was written and when a finding comes back, and the fix should match what's actually there now, not what was true at spec-writing time.

Read the relevant file(s) — and that file's own reference under `references/files/` for its exact shape — then make the requested change, keeping every convention in `references/structure.md` intact (numbering stays sequential, backlinks stay accurate, IDs you touch don't orphan a reference elsewhere). Then run the validator on the whole feature directory — a change to one file can break a cross-reference in another (e.g. renumbering an `FR-N` in `SPEC.md` orphans every `@FR-N` tag in `TEST-SPEC.md`), so always validate the full bundle, not just the file you edited. If the user asks to add `API-CONTRACTS.md`, `UI-CONTRACTS.md`, or `TECHNICAL-DESIGN.md` to a bundle that doesn't have it yet, treat that like a small Job 1 step 5: create the file per its own reference under `references/files/`, add its backlink to (and from) the other technical files, and add it to `SPEC.md`'s Technical Specification table — then validate.

## Job 4: Add a new kind of technical file

This comes up when a feature needs a technical file that isn't `API-CONTRACTS.md`, `UI-CONTRACTS.md`, or `TECHNICAL-DESIGN.md` — e.g. a save-data contract for a game feature, a device-protocol spec for an IoT feature, a message-schema spec for an event-driven feature. Rather than inventing a one-off shape, interview the user briefly so the new file type is well-defined and reusable the next time a feature needs the same kind of thing:

1. What's the file's name and H1 title prefix (e.g. `SAVE-DATA-CONTRACTS.md` → `# Save-Data Contracts: <Feature Name>`)?
2. What's the natural unit per H2 section (an endpoint, a screen, a save-slot, a device command, ...)?
3. What fields belong in its table (or is it fenced-block-based, like `TEST-SPEC.md`'s Gherkin scenarios or `API-CONTRACTS.md`'s yaml request/response shape, because the shape doesn't fit a table)?
4. What ID prefix should it use for entries that `TEST-SPEC.md` needs to reference (e.g. `SD-<PLATFORM>-N`)?
5. Is it mandatory whenever a certain platform group is present, or genuinely optional per-feature?

Once answered, write the new file for this feature *and* fold the shape into the skill's shared references so the next feature needing the same kind of file gets the standard structural checks for free instead of triggering this interview again:
- Add a new `references/files/<file>.md` following the pattern of the existing ones (section-by-section shape, which IDs it defines).
- Add it to `references/structure.md`'s file-layout diagram and per-file reference list, with its mandatory/optional status.
- Add it to `scripts/validate.ts`: `OPTIONAL_TECH_FILES` (or `MANDATORY_TECH_FILES`, per the mandatory/optional answer), plus its `TECH_TITLE_PREFIX` and `ID_PATTERNS` entries.

## Running the validator

```bash
bun run .claude/skills/spec/scripts/validate.ts <local spec root>/<spec-name>
# or, to check every feature at once:
bun run .claude/skills/spec/scripts/validate.ts --all <local spec root>
```

`<local spec root>` is always a local directory — `specUri` itself when it's a local path, or `.wise/specs/` when `specUri` is a Confluence URL (see "`specUri` pointing at Confluence" above). The validator only ever reads local files; it has no concept of Confluence and no built-in assumption about where specs live otherwise.

It's a zero-dependency TypeScript script (Bun runs `.ts` directly, no build step) that prints `tsc`-style diagnostics — `file:line - severity CODE: message` — and exits `1` if any `error`-severity line is present (`warning`s don't fail the check, they're worth a second look but not blocking). Loop: run it, read every error, fix the file, run it again, until it prints `Found 0 error(s)`.

Common errors and what they mean:
- `SPEC1002` (duplicate heading) / `SPEC1003`-`SPEC1006` (heading numbering) — the heading hierarchy rules in `references/structure.md` §"Rules that the validator enforces" #1-2.
- `SPEC3001`/`SPEC3003`/`SPEC3004` — a technical file's title or backlink line doesn't match convention, or is missing a reference to another technical file that's actually present in this bundle.
- `SPEC4002`/`SPEC4003` — a duplicate ID, or a `reference:`/`dependency:` pointing at an ID that was never defined.
- `SPEC5001` — `SPEC.md`'s Technical Specification table is missing a link to one of the technical files present in this bundle (mandatory ones, plus any optional ones this feature has).
- `SPEC0001` / `SPEC3002` — literal `&amp;` found; replace with `&`.

If the validator itself seems wrong about a real, deliberate structural choice (e.g. a feature that genuinely needs a technical file beyond `API-CONTRACTS.md`/`UI-CONTRACTS.md`/`TECHNICAL-DESIGN.md`), that's Job 4 above — update `scripts/validate.ts` and `references/structure.md` together, don't just work around it in the spec files, since the whole point is that every feature bundle stays mechanically consistent with every other one.

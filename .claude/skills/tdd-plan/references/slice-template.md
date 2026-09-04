# Slice file template

One file per slice, at `<plansDir>/<feature-slug>/<NN>-<slug>.md` (see `SKILL.md`'s "Where plans live" for how `<plansDir>` is resolved), numbered from `01` in dependency order (blockers first). Copy this template verbatim and fill every field. A field you can't fill is a signal the slice isn't ready — resolve it, don't leave it blank.

**Reference, never restate.** See `references/traceability.md`'s "Reference, never restate" section for the full rule. The Steps section below shows a code *skeleton* to make the RED→GREEN loop mechanical, not a copy of the spec. Never hardcode a TC's actual Given/When/Then or its literal expected value into that skeleton — the placeholder names below (`function`, `input`, `expected`) stay placeholders in the plan; the real names and values come from the seam and the Source of truth field, filled in by whoever executes the slice, not typed here as if the plan already knew the answer.

**Metadata is YAML frontmatter, not bold-prose fields.** `status`, `satisfies`, `wave`, `blocked_by`, and `uses_skills` all live in the frontmatter block so they're machine-parseable (a script can read them without scraping prose) — everything else stays as regular Markdown body.

---

```markdown
---
status: ready-for-agent  # or: blocked (<why>)
satisfies:
  - "TC-<N>"  # transitively: @FR-<N>, @EC-<N>, @SM-MOB-<N> — one entry per TC this slice satisfies
wave: <N>
blocked_by: []  # earlier slice numbers/titles, e.g. ["01"], or [] for "None — can start immediately"
uses_skills: []  # skill(s) from the plan's Skills index that apply to executing this slice, or [] for "None — plain RED→GREEN loop"
---

# <NN> — <Slice title in domain vocabulary>

## What it delivers
<End-to-end behavior this slice makes work, from the user's perspective.
One or two sentences. Not a layer-by-layer implementation list.>

## Files
- Create: `<exact/path/to/new/file>`
- Modify: `<exact/path/to/existing/file>`<optionally `:<start>-<end>` if the touched lines are already known — don't guess a range, omit it rather than invent one>
- Test: `<exact/path/to/test/file>`

## Interfaces
- Consumes: <what this task uses from earlier tasks — exact function/method signatures an earlier slice already established, or "None">
- Produces: <what later tasks rely on — exact function/method names, parameter and return types this slice introduces. A later slice's implementer sees only their own slice file, never this one's full reasoning — this is the only place they learn what this slice exposes, so name real signatures, not vague descriptions.>

## Guardrails (Must NOT do)
- <Explicit negative scope — what this slice must not touch, add, or change.>
- <e.g. "Don't modify the routing logic — tracker only." / "Account-based only, no IP.">

## Seam (confirmed)
<The public boundary the test observes behavior at — the state-machine
transition, the API request/response boundary, or the module interface.
Must be a seam the user confirmed in the quiz step.>
Design reference: <Figma Node URL from UI-CONTRACTS.md's Screen State Map for this SM-MOB-N row, or omit this line entirely if the seam isn't UI-derived. Copy the URL verbatim — never invent one, and if the source row is still "TBD" write "TBD (see UI-CONTRACTS.md)" rather than fabricating a link.>

## Evidence
- RED:   `<plansDir>/<feature-slug>/evidence/TC-<N>.red.txt`   (test failing, pre-implementation)
- GREEN: `<plansDir>/<feature-slug>/evidence/TC-<N>.green.txt` (test passing, post-implementation)
<one red+green pair per TC this slice satisfies>

## Steps

Number every step **globally down the file** — do NOT restart at 1 for each TC. One slice with three TCs has steps 1-4, 5-8, 9-12, then a single final step 13; it never has three separate "Step 1"s. A reader jumping to any step number sees at a glance which TC it belongs to and that it's later in the file, not a restart.

- [ ] **Step 1 (TC-<N>): Write the failing test.** Referenced test case: TC-<N> in TEST-SPEC.md. Do NOT restate its Given/When/Then here — read the real one in TEST-SPEC.md and write the test at the seam above. The block below is a structural skeleton, not the actual test:
  ```<language>
  def test_<specific_behavior>():
      result = <function>(<input>)
      assert result == <expected>  # from Source of truth below — never a value invented here
  ```

- [ ] **Step 2 (TC-<N>): Run it, confirm it fails.**
  Run: `<exact focused-test command>`
  Expected: FAIL, and the failure is for the right reason (missing/wrong behavior, not a typo in the test) — a test that's green on this first run proves nothing. Capture the real output verbatim to the RED path in Evidence above (via shell redirection, not hand-typed) before writing any implementation.

- [ ] **Step 3 (TC-<N>): Write the minimal implementation.** Only what's needed to satisfy this slice's Then-clauses — resist scope creep into other slices' territory, and hold every Guardrail above.
  ```<language>
  def <function>(<input>):
      ...
  ```

- [ ] **Step 4 (TC-<N>): Run it, confirm it passes.**
  Run: `<same command as Step 2>`
  Expected: PASS. Capture the real output verbatim to the GREEN path in Evidence above.

<repeat a Step-N..N+3 (TC-<M>) block like the four above for each additional TC this slice satisfies — continuing the step count from where the previous TC's block left off (e.g. next TC starts at Step 5, not Step 1 again) — each gets its own RED/GREEN pair and its own evidence>

- [ ] **Step <next>: Full suite, then commit** (only if the project is under git).
  Run: `<exact full-suite command>` — must be green, no regressions beyond any baseline caveat `00-overview.md` already lists.
  ```bash
  git add <exact files this slice touched — implementation, test, evidence; never a blanket -A or .>
  git commit -m "slice <NN> (TC-<N>[, TC-<M>...]): <one-line summary>"
  ```

<the counter never resets, anywhere in this section. If this slice commits incrementally (e.g. once after an early TC, again after later ones instead of one commit at the very end), each commit gets its own step number continuing from wherever the count left off — never re-use a step number, and never restart at a lower one, even for a second commit checkpoint later in the same file>

## Acceptance criteria (by reference to TC-<N> Then clauses)
- [ ] TC-<N> passes (its Then clauses hold — see TEST-SPEC.md, do not restate here)
- [ ] RED evidence captured before implementation; GREEN captured after
- [ ] Expected values trace to source of truth (below), not recomputed
- [ ] Full suite green — no regressions

## Source of truth (anti-tautology)
<For each asserted value, where the expected value comes from — a spec
literal, the API-CONTRACTS example JSON, a named fixture. NOT recomputed
the way the code computes it.>

## Notes / prototype snippet (optional)
<Only a decision-encoding snippet — a schema shape or reducer — trimmed
to the decision-rich part. No file paths, no working demos; they go stale.>
```

---

## `00-overview.md`

```markdown
# Plan overview — <feature>

**Spec:** <relative path from this plan's directory to the spec bundle's SPEC.md>

## TL;DR
<one-line summary of the behavior being built>

## Waves
- Wave 1: <slice numbers>
- Wave 2: <slice numbers>
- Final Verification Wave: F1–F5 (after all waves)

## Dependency matrix
| Slice | Depends on | Blocks | Wave |
|---|---|---|---|
| 01 | None | 02, 03 | 1 |
| 02 | 01 | — | 2 |

## Skills index
<Invocable skills relevant to this plan, discovered in step 2a from
whatever this environment exposes (visible skill listing, on-disk skill
directories at whatever levels it defines, custom commands, MCP tools).
Trim to what plausibly applies; see references/skills-index.md.>

| Skill | Source | Triggers when |
| --- | --- | --- |
| <name> | <where it comes from> | <copied from its own description's trigger clause> |

## Definition of Done
- [ ] Every slice done: red+green evidence per TC, full suite green
- [ ] Build succeeds
- [ ] Final Verification Wave F1–F5 approved
```

## `00-coverage.md`

```markdown
# Coverage & gaps — <feature>

## Coverage matrix
<reverse matrix: every FR/EC → covering TC(s) → status>

## Gaps and agreed resolutions
| Gap | Type | Resolution agreed in quiz |
| --- | --- | --- |
| FR-9 uncovered | uncovered requirement | added TC-10 / accepted out-of-scope |
| NFR-1 target TBD | unverifiable NFR | excluded until number confirmed |

## Seams confirmed
<list the seams the user approved, one per line>
```

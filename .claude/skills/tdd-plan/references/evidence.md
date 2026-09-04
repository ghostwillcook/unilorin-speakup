# Evidence — auditable proof without duplication

The Wise-style plan format proves work happened by saving evidence files a script can audit. That idea is worth keeping. What is NOT worth keeping is *how* it produced those files: by copying every `TEST-SPEC.md` case into a per-task "QA Scenario" block with restated steps and expected results. That duplication manufactures drift — two sources of truth that silently disagree. This file keeps the evidence, drops the duplication.

## The rule

**Reference the test case; capture its result. Never restate the test.** See `references/traceability.md`'s "Reference, never restate" section for the full rule and rationale — this file only covers the evidence-file convention that rule implies.

Evidence is keyed by the test id, so it points back at the single source of truth in `TEST-SPEC.md` rather than a restated copy.

## The evidence convention

Per slice, per `TC` it satisfies, capture two files under `<plansDir>/<feature-slug>/evidence/` (see `SKILL.md`'s "Where plans live" for how `<plansDir>` is resolved):

| File | Captures | Proves |
| --- | --- | --- |
| `<TC-id>.red.txt` | focused-test output **before** implementation, showing the test FAIL | the test can discriminate — it is not vacuous or tautological |
| `<TC-id>.green.txt` | focused-test output **after** implementation, showing the test PASS | the behavior now exists |

Example: slice 03 satisfies TC-1, TC-2, TC-3 → six files: `TC-1.red.txt`, `TC-1.green.txt`, `TC-2.red.txt`, … Each file is produced by redirecting the actual command's output to disk (e.g. `<focused-test-command> > evidence/TC-1.red.txt 2>&1; echo "exit: $?" >> evidence/TC-1.red.txt`), never hand-typed or reconstructed from memory. This means every evidence file's first line is the literal command that ran, its last line is the real exit code, and nothing in between was edited by hand — that's what lets a reviewer sanity-check the file's plausibility instead of trusting the prose around it. A `.red.txt` with a non-zero exit and a `.green.txt` with exit `0` is the minimum shape; anything else fails F2.

## Why RED evidence is the load-bearing half

A saved capture of a green test proves a test passed — not that it *could have failed*. A test written after the code, asserting what the code already does, passes on first run and produces a perfectly convincing green file that proves nothing. The RED file is the discriminator: it is proof the test fails when the behavior is absent. **A GREEN with no matching RED is rejected by the Final Verification Wave (F2).**

This is the single biggest integrity gain over an evidence-only harness: a plan that proves tests *can fail* is worth more than one that proves tests passed.

## What evidence does NOT replace

Evidence proves a test ran and flipped red→green. It does not prove:
- the test covers a real requirement → that's the **coverage matrix** (F1)
- the expected value is independent of the code → that's the **source-of-truth line** (F3)
- nothing extra was built → that's the **guardrails** (F4)

Evidence is one leg of the stool. Keep the other three.

## Auditing evidence

The Final Verification Wave's F2 step walks every in-scope `TC` and asserts both `.red.txt` and `.green.txt` exist and show the expected fail/pass. If your repo has a check script (the Wise format used a `check-evidence.ts`), point it at `evidence/` and require "0 missing". If not, F2 is a manual walk of the directory against the coverage matrix. Either way the gate is the same: no `TC` is done without a red and a green capture.

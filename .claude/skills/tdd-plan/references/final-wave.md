# Final Verification Wave — the adversarial closing audit

Slices prove themselves as they go (red → green → full suite). The Final Verification Wave runs once, last, after every slice is done. Its job is not to re-run passing tests — it is to check the *plan itself* was honestly satisfied. It is adversarial: it assumes a slice might have cheated and looks for the tells.

Each step writes one evidence file under `<plansDir>/<feature-slug>/evidence/` (see `SKILL.md`'s "Where plans live" for how `<plansDir>` is resolved). The feature is done only when F1–F5 all pass.

## F1 — Coverage audit

`evidence/final-f1-coverage.txt`

Walk the coverage matrix from `00-coverage.md`:
- Every `FR-N` and `EC-N` in scope has at least one covering `TC`, and that `TC` has a done slice.
- Every `TC` in scope maps to a done slice.
- Every gap raised in the quiz was resolved the way the user agreed (test added / `TBD` confirmed / accepted out-of-scope) — not silently dropped.

Fail if any in-scope requirement reaches the end uncovered.

## F2 — Evidence audit

`evidence/final-f2-evidence.txt`

For every in-scope `TC`: assert both `<TC-id>.red.txt` and `<TC-id>.green.txt` exist, each carries a non-hand-edited `exit: <code>` line per `references/evidence.md`'s convention, the red's code is non-zero, and the green's is `0`. **A missing red file, a red file with exit `0`, or a file with no `exit:` line at all fails the audit** — the test was never proven able to fail, or the evidence can't be trusted as a real run. If a check script exists, require "0 missing".

## F3 — Tautology & drift audit

`evidence/final-f3-tautology.txt`

- **Reference-only held:** no slice restated a test's steps or expected values; acceptance criteria all point at `TC` `Then` clauses rather than re-typing them.
- **Independent oracle:** every asserted expected value traces to a source of truth outside the code under test (spec literal, API-example JSON, fixture). Spot-check the highest-risk assertions — anything numeric, anything derived.

Fail if the plan grew a second copy of the truth, or if any assertion recomputes the expected value the way the code does.

## F4 — Scope-fidelity audit

`evidence/final-f4-scope.txt`

- Every slice's "Must NOT do" guardrail held.
- The `SPEC.md` "Out of Scope" list was respected.
- Nothing outside the approved slices was built. If the diff touches files no slice named, explain or revert.

## F5 — Full suite + build

`evidence/final-f5-suite-build.txt`

Run the full test suite and the build, fresh, capturing both. Both must be green. This is the only F-step that re-runs code — because a regression can appear between the last slice and now.

## The gate

```
F1 coverage  ✓   every requirement has a covering, done test
F2 evidence  ✓   every TC has red + green proof
F3 tautology ✓   one source of truth; no vacuous assertions
F4 scope     ✓   guardrails held; nothing extra built
F5 suite     ✓   full suite + build green
        └──▶ feature done
```

If any step fails, the feature is not done — return to the offending slice, fix, re-capture, re-audit. Do not wave it through.

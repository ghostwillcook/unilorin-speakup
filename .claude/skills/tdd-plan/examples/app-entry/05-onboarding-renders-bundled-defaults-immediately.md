---
status: "blocked (FR-9 has no covering TC — TC-10 must be added to TEST-SPEC.md and approved before this slice can be drafted)"
satisfies:
  - "TC-10 (proposed, not yet in TEST-SPEC.md) (@FR-9 @SM-MOB-7)"
wave: 3
blocked_by: ["03"]
uses_skills: ["run"]
---

# 05 — Onboarding renders bundled defaults immediately (BLOCKED)

## What it delivers
Not yet drafted. `SPEC.md`'s FR-9 requires Onboarding to render its bundled default content immediately on entry, with no loading spinner — but `00-coverage.md`'s Gaps table records that no `TC` in `TEST-SPEC.md` actually asserts this today (TC-8/TC-9 assume the defaults are already shown, they never prove the *immediate, no-spinner* part).

## Why this slice is blocked, not just deprioritized
Per this skill's own rule ("A drafted slice with no TC-N → not verifiable. Reject or extend the Test Spec first."), a slice can't be written against a requirement that has no test case backing it — doing so would mean inventing the acceptance criteria here, in the plan, instead of in `TEST-SPEC.md` where the oracle is supposed to live. The fix is upstream: someone needs to add a `TC-10` to `TEST-SPEC.md` (with the user's approval, since that's a spec change) before this file gets its Files/Interfaces/Seam/Steps sections filled in.

## What happens once it's unblocked
When `TC-10` exists and is approved:
1. This file's `status` becomes `ready-for-agent` and `satisfies` drops the `(proposed, not yet in TEST-SPEC.md)` qualifier.
2. A real Files/Interfaces/Guardrails/Seam/Evidence/Steps section gets drafted the same way slices 01-04 were — most likely testing that Onboarding's initial render state shows the bundled default page list synchronously, with no intervening loading state observable in the ViewModel's emitted states.
3. `uses_skills: ["run"]` is a reasonable guess ahead of time — "no loading state" is the kind of claim that's easy to assert wrong in a pure unit test (a fast fake can make a real spinner frame invisible to the test even though a real device would show one), so a slice like this plausibly benefits from actually launching the app once to eyeball the claim alongside its unit tests. Confirm this guess is still right once the slice is actually drafted — don't just carry it forward unexamined.
4. Slice 06, which depends on this one, unblocks in turn.

## Evidence
Not applicable yet — no Steps exist to produce evidence from until this slice is drafted for real.

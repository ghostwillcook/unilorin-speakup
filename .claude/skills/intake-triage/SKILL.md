---
name: intake-triage
description: Classifies a cold bug report or feature-enhancement request by which layer actually owns it — spec (missing/wrong requirement), plan (spec's fine but no slice covers this behavior, or a slice's guardrail/seam is wrong), or implementation (spec and plan are both fine, the code just doesn't match them) — and routes it to that layer's own skill (/spec, /tdd-plan, /tdd-plan-executor) instead of jumping straight to code. Use this whenever a bug report, "it's broken", or "can we add X" request arrives with no existing review report to classify it (that case is /apply-review-findings' job, not this one) — i.e. this is the entry point into the spec→plan→execute→review loop for work that didn't start from a review finding.
---

# Intake Triage

This skill has no fix logic of its own, same as `/apply-review-findings` — its only job is to read a cold report (a bug, or "can we add X") and figure out which layer of the spec→plan→execute→review loop actually owns it, before any code gets touched. Skipping straight to `/tdd-plan-executor` on a report that's actually a spec gap produces a plausible-looking fix for the wrong problem; skipping straight to editing code produces one with no spec or plan behind it at all.

**If the report already came with a `/review-code-implementation` report attached, this isn't your job — use `/apply-review-findings` instead.** This skill exists for everything upstream of that: a fresh bug report from a user, a support ticket, or an ad hoc "add a CSV export button" ask that hasn't been through review yet.

## Step 1 — Does a spec bundle exist for this area at all?

Resolve the spec bundle the same way `/spec` does (`wisec.json`'s `specUri`, or an already-known path) and look for one covering the feature/area the report touches.

- **No spec bundle exists anywhere near this behavior** (common for legacy code that predates this loop, or a genuinely new feature ask) → route straight to `/spec` Job 1. For a bug report against undocumented legacy behavior, say so explicitly when invoking it: the goal is a minimal spec bundle that documents *actual* current behavior plus the correct behavior the bug report implies, not a full retroactive spec of everything that area does. For an enhancement ask with no existing feature to extend, this is just a normal new-feature spec.
- **A spec bundle exists** → continue to Step 2.

## Step 2 — Does the spec already describe the correct behavior?

Read the relevant `SPEC.md`/`TEST-SPEC.md` (and `UI-CONTRACTS.md`/`API-CONTRACTS.md` if relevant) sections for the area the report touches.

- **The spec is silent, wrong, or contradicts what the report says should happen** — a missing `FR`/`EC`, an edge case never written down, a requirement that describes the buggy behavior as correct, or (for an enhancement) genuinely new capability not covered by any existing `FR` → **spec-level**, route to `/spec` Job 3 (refine). This is the same classification `/apply-review-findings` Step 2 uses for a review finding traced to the spec layer — apply it here identically, just against a raw report instead of a review finding.
- **The spec already correctly describes the behavior the report wants** → continue to Step 3.

## Step 3 — Does a plan/slice already cover this correctly?

Check for a plan bundle (`00-overview.md` + `00-coverage.md` + slice files) under `wisec.json`'s `plansDir`.

- **No plan bundle, or no slice covers the relevant `TC`(s) yet** → **plan-level**, route to `/tdd-plan` (Job 1 if no plan exists yet at all, Job 2 if a plan exists but needs a new/adjusted slice for this `TC`).
- **A slice covers it, but its guardrail, seam, or "Blocked by" edge is what's actually wrong** (not the code, the slice's own design) → **plan-level**, route to `/tdd-plan` Job 2.
- **The slice is correctly designed and its own evidence claims it's done, but the report says the behavior is still wrong** → **implementation-level**, route to `/tdd-plan-executor` to redo the affected slice(s). This is a pure implementation defect: spec and plan both hold up, the code (or its test) just doesn't actually satisfy what the plan asked for.

## Step 4 — Ambiguous cases

If the report could genuinely be read more than one way (a bug that could be "the spec never said what should happen here" or "the spec says X and the code just doesn't do X"), don't guess — ask the user which reading is right, the same principle `/apply-review-findings` Step 2 applies to an ambiguous review finding. A wrong classification here wastes a full round-trip at the wrong layer.

## Step 5 — Dispatch

Invoke the routed skill with the specific report text and the file/requirement it's anchored to (the relevant `FR`/`EC`/`TC` if one already exists, or a plain description if none does yet) — not a request to re-derive the whole area from scratch.

**Cascades are the normal case.** A report that's spec-level almost always means the plan built from the old spec is now stale too — after `/spec` lands the fix, check with `/tdd-plan` Job 2 whether the plan needs to follow, the same top-down order `/apply-review-findings` uses (spec, then plan, then implementation) rather than assuming only the layer you first identified needs to change.

## Step 6 — After the fix lands

Once the routed skill(s) finish, this is the same code that would come out of the normal loop — send it through `/review-code-implementation` as the closing gate before it merges, exactly as if it had started from `/tdd-plan-executor` in the first place. Don't treat a bugfix or small enhancement as exempt from the review step just because it entered the loop sideways.

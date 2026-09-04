---
name: apply-review-findings
description: Closes the loop after /review-code-implementation reports a verdict other than "Ready to merge" — classifies each open finding by which layer actually owns it (spec, plan, or implementation) and routes the fix to that layer's own skill (/spec, /tdd-plan, /tdd-plan-executor) instead of patching code directly. Re-reviews via a fresh subagent after each round and repeats until clean or a cap is hit. Use this whenever a review report has open Critical/Important findings and the user wants them fixed properly, not by editing files ad hoc.
---

# Apply Review Findings

This skill has no fix logic of its own. Its only job is: read a review report, figure out which layer each open finding actually belongs to, and hand it to the skill that owns that layer. A finding that's really a spec gap gets a bad fix if you patch the code around it — the fix belongs in `/spec`, not in a workaround.

## Why routing instead of fixing directly

The four layers (spec → plan → implementation → review) each have a skill that already knows how to change that layer correctly:

- `/spec` knows how to write a coherent SPEC.md/TEST-SPEC.md and re-validate it.
- `/tdd-plan` knows how to turn a spec into ordered, traceable slices.
- `/tdd-plan-executor` knows how to implement a slice test-first with real RED/GREEN evidence.
- `/review-code-implementation` knows how to audit the result.

A finding is a symptom of exactly one of these being wrong (or, for a cascading finding, more than one — see below). Fixing the symptom in the wrong layer either doesn't stick (the next review catches the same drift again) or actively makes the layers inconsistent with each other (code fixed, spec never updated, plan still describes the old behavior).

## Step 1 — Read the review report

Take the most recent `/review-code-implementation` output. Pull out every finding at Critical or Important severity (Medium/Minor are the author's call, not this skill's — don't auto-fix those without being asked). For each one, note: which file/requirement it's anchored to, and its stated cause.

## Step 2 — Classify each finding by layer

Ask, in order, which layer the finding actually points at:

1. **Spec-level** — the finding says a requirement is missing, ambiguous, or internally contradictory in SPEC.md/TEST-SPEC.md itself; or a Stage 1 "unrequested behavior" finding where the right call is to formalize the behavior into the spec rather than rip it out. → route to `/spec`.
2. **Plan-level** — the finding says a slice's guardrail contradicts the spec, a TC has no slice covering it, the plan's coverage table is wrong, or (this is the common one) a spec fix from step 1 above needs the plan re-derived to match. → route to `/tdd-plan`.
3. **Implementation-level** — spec and plan are both fine; the code, its tests, or its RED/GREEN evidence just don't actually satisfy what the plan already asked for. → route to `/tdd-plan-executor` to redo the affected slice(s).

**Cascades are the normal case, not the exception.** A spec fix almost always means the plan is now stale (it was derived from the old spec) and needs `/tdd-plan` to run again before `/tdd-plan-executor` touches anything — don't send a spec-rooted finding straight to the executor and expect it to reconcile the mismatch itself. Work top-down: spec first, then plan, then implementation, even if the original finding was reported at the implementation layer.

**If a finding is genuinely ambiguous** (could be read as either a spec gap or a deliberate implementation choice) — don't guess. Ask the user which it is; a wrong routing decision here compounds into wasted work at every layer below it.

## Step 3 — Dispatch the fix

Invoke the routed skill for that finding (or batch same-layer findings into one invocation of that skill rather than one skill call per finding). Give it the specific finding text and its file/requirement anchor — not the whole review report, so the fixing skill isn't distracted by unrelated findings from other layers.

For plan-level findings, `/tdd-plan`'s Job 2 (refine/amend an existing plan) is the target — it re-derives the coverage matrix delta, classifies which slices need new evidence versus which are untouched, and reports back exactly which slices `/tdd-plan-executor` needs to redo. Pass it the finding, not a request to regenerate the whole plan.

## Step 4 — Re-review via a fresh subagent

Once the dispatched fix is done, re-run `/review-code-implementation` as a **new subagent invocation with no memory of this fix's reasoning** — never re-review inline in the same context that just wrote the fix. The whole point of a second opinion is that it isn't primed to agree with itself; an in-context re-check just confirms what the fixer already believed.

## Step 5 — Loop

- If the new verdict is **Ready to merge**: stop, report what changed and why.
- If it's **Ready with fixes** or **Not ready** with different or fewer findings than last round: go back to Step 1 with the new report.
- If the same finding reappears unchanged after a fix round, or after 3 rounds the verdict still isn't clean: stop and escalate to the user rather than looping indefinitely — something about the routing or the fix itself is wrong, and another automated round won't fix that.

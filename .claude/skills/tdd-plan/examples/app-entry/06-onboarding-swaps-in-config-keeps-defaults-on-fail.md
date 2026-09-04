---
status: "blocked (transitively blocked by slice 05, which is itself blocked on the FR-9/TC-10 gap)"
satisfies:
  - "TC-8 (@FR-10 @SM-MOB-7)"
  - "TC-9 (@EC-3 @SM-MOB-7)"
wave: 4
blocked_by: ["05"]
uses_skills: []
---

# 06 — Onboarding swaps in config, keeps defaults on fail (BLOCKED — transitively)

## What it delivers
Once Onboarding is showing its bundled defaults (slice 05), a background fetch for the welcome-page config either swaps the displayed content in when it arrives (TC-8), or leaves the bundled defaults on screen unchanged if the fetch fails (TC-9, EC-3).

## Why this slice is blocked
Not blocked on its own account — `TC-8` and `TC-9` already exist and are well-formed. It's blocked because it depends on slice 05's output (the default-render state it swaps content *into*), and slice 05 can't be drafted until the FR-9/TC-10 gap is resolved. Don't start this slice out of order just because its own TCs are ready — the dependency is real: there's no "defaults shown" state to swap out of until 05 exists.

## Once unblocked, this slice will need
- **Files**: likely a modify to the same Onboarding ViewModel/state holder slice 05 introduces, plus a test file alongside it.
- **Interfaces**: consumes whatever state type slice 05 produces for "defaults currently shown"; produces nothing further downstream in this plan (leaf slice).
- **Seam**: Onboarding's page-list state, with the welcome-page `GET` as the mock boundary — already confirmed in `00-coverage.md`'s Seams section, asserted against `API-CONTRACTS.md`'s example JSON (populated / empty / 404 cases map to TC-8's success path and TC-9's failure path respectively).
- **Guardrails**: don't touch the Skip flow (slice 04) or the initial default-render logic itself (slice 05) — this slice only reacts to the fetch's result.
- **Steps**: same RED→GREEN shape as every other slice here — TC-8's swap-in test first, then TC-9's keep-defaults-on-fail test, each with its own evidence pair.

## Evidence
Not applicable yet — no Steps exist to produce evidence from until slice 05 unblocks and this slice is drafted for real.

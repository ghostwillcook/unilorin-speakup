# Plan overview — App Entry (Splash & Onboarding)

**Spec:** ../../../../docs/features/app-entry/SPEC.md

## TL;DR
On cold start, Splash checks whether the app is in maintenance mode, then routes to Onboarding (first install) or Login (returning device) based on a persisted flag; Onboarding shows bundled defaults immediately and swaps in fetched config when it arrives, falling back to the defaults on fetch failure.

## Waves
- Wave 1: 01
- Wave 2: 02, 03
- Wave 3: 04, 05
- Wave 4: 06
- Final Verification Wave: F1–F5 (after all waves)

## Dependency matrix
| Slice | Depends on | Blocks | Wave |
|---|---|---|---|
| 01 | None | 02, 03 | 1 |
| 02 | 01 | — | 2 |
| 03 | 01 | 04, 05 | 2 |
| 04 | 03 | — | 3 |
| 05 | 03 | 06 | 3 |
| 06 | 05 | — | 4 |

Slice 05 is **blocked** — see `00-coverage.md`'s Gaps table. It cannot leave `blocked` status until the user approves adding `TC-10` to `TEST-SPEC.md`; slice 06 stays blocked transitively until 05 unblocks.

## Skills index

| Skill | Source | Triggers when |
| --- | --- | --- |
| `run` | project skill | Launching/driving the app to confirm a screen renders as described — relevant to slice 05's "no loading state" claim, which is easier to eyeball on-device than to fully pin down in a unit test alone. |

Most slices in this plan are plain RED→GREEN (state-machine and repository-layer logic); only slice 05 plausibly benefits from the `run` skill, and only as a spot-check alongside its unit tests, not a replacement for them.

## Definition of Done
- [ ] Every slice done: red+green evidence per TC, full suite green
- [ ] Build succeeds
- [ ] Final Verification Wave F1–F5 approved

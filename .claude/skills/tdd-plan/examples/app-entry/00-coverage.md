# Coverage & gaps — App Entry (Splash & Onboarding)

## Coverage matrix

| Req | Covered by | Status |
| --- | --- | --- |
| FR-1 show Splash on cold start | (implicit in all TCs) | ⚠ implicit precondition |
| FR-2 check onboarding flag | TC-1, TC-2, TC-3 | ✓ slice 03 |
| FR-3 first install → Onboarding | TC-1 | ✓ slice 03 |
| FR-4 returning → Login | TC-2 | ✓ slice 03 |
| FR-5 check maintenance-mode status every cold start | TC-5, TC-6 | ✓ slice 01 |
| FR-6 cache the maintenance-mode result for the Splash session | TC-6 | ✓ slice 01 |
| FR-7 maintenance-check failure → blocker/exit | TC-7 | ✓ slice 02 |
| FR-8 Skip persists flag → Login | TC-4 | ✓ slice 04 |
| FR-9 render bundled defaults immediately, no loading state | — | ✗ **GAP** — no TC asserts the immediate no-spinner render |
| FR-10 swap in fetched config | TC-8 | ✓ slice 06 |
| EC-1 corrupted flag → fail safe | TC-3 | ✓ slice 03 |
| EC-2 maintenance-check network failure | TC-7 | ✓ slice 02 |
| EC-3 config fetch fail → keep defaults | TC-9 | ✓ slice 06 |
| NFR-1 flag-check timing | — | ✗ **GAP** — target is `TBD`, and the statement itself reads oddly ("must at least 2 seconds") |

## Gaps and agreed resolutions

| Gap | Type | Resolution agreed in quiz |
| --- | --- | --- |
| FR-9 uncovered | uncovered requirement | User agreed to extend `TEST-SPEC.md` with a new `TC-10` ("Onboarding renders bundled defaults immediately, no loading state") before slice 05 can leave `blocked` status. Not yet added — slice 05 stays blocked until it is. |
| NFR-1 target `TBD` and malformed | unverifiable NFR | Excluded from acceptance criteria until the PM confirms a real threshold and fixes the wording. No slice asserts against it. |

## Seams confirmed

- Splash state machine transition (`SM-MOB-1`/`SM-MOB-2`/`SM-MOB-3`), observed through the Splash navigation output — not the private handler.
- `features:splash`'s public maintenance-check entry point (passes/fails), with the `GET /external/v1/app/maintenance-status` network call as the mock boundary.
- Onboarding state exposing the displayed page list; the welcome-page `GET` is the mock boundary, asserted against `API-CONTRACTS.md`'s example JSON (populated / empty / 404).

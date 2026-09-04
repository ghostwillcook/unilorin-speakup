---
status: ready-for-agent
satisfies:
  - "TC-7 (@FR-7 @EC-2 @SM-MOB-1 @SM-MOB-2)"
wave: 2
blocked_by: ["01"]
uses_skills: []
---

# 02 — Maintenance-check failure shows blocker, exits

## What it delivers
When the maintenance check reports the app is under maintenance, or the check itself fails (network error), Splash shows a non-dismissible blocker screen instead of proceeding to the routing decision.

## Files
- Modify: `features/splash/src/main/kotlin/SplashViewModel.kt`
- Test: `features/splash/src/test/kotlin/SplashMaintenanceBlockerTest.kt`

## Interfaces
- Consumes: `MaintenanceGate.check(): MaintenanceCheckResult` (produced by slice 01) — this slice reacts to its `UnderMaintenance` and `CheckFailed` variants.
- Produces: `SplashViewModel.state: StateFlow<SplashUiState>` where `SplashUiState.Blocked(reason: MaintenanceCheckResult)` is a new state slice 03 must never transition out of automatically (only app restart clears it).

## Guardrails (Must NOT do)
- Don't add a retry button or any dismiss gesture — the spec's Then-clause is explicit that this is a hard stop, not a retryable error.
- Don't touch the clear path (slice 01) or the flag-routing logic (slice 03).

## Seam (confirmed)
Splash state machine transition (`SM-MOB-1` → `SM-MOB-2`), observed through the Splash navigation/UI-state output — not the private handler.

## Evidence
- RED:   `evidence/TC-7.red.txt`
- GREEN: `evidence/TC-7.green.txt`

## Steps

- [ ] **Step 1 (TC-7): Write the failing test.** Referenced test case: TC-7 in TEST-SPEC.md. Do NOT restate its Given/When/Then here.
  ```kotlin
  @Test
  fun `maintenance active shows blocking sheet, never routes`() = runTest {
      fakeGate.stubResult(MaintenanceCheckResult.UnderMaintenance)
      viewModel.onColdStart()
      assertEquals(SplashUiState.Blocked(MaintenanceCheckResult.UnderMaintenance), viewModel.state.value)
  }
  ```
- [ ] **Step 2 (TC-7): Run it, confirm it fails.**
  Run: `./gradlew :features:splash:test --tests "*SplashMaintenanceBlockerTest*"`
  Expected: FAIL (`SplashUiState.Blocked` doesn't exist yet) — capture to `evidence/TC-7.red.txt`.
- [ ] **Step 3 (TC-7): Write the minimal implementation.**
  ```kotlin
  fun onColdStart() = viewModelScope.launch {
      when (val result = maintenanceGate.check()) {
          MaintenanceCheckResult.UnderMaintenance, MaintenanceCheckResult.CheckFailed ->
              _state.value = SplashUiState.Blocked(result)
          MaintenanceCheckResult.Clear -> checkOnboardingFlag()
      }
  }
  ```
- [ ] **Step 4 (TC-7): Run it, confirm it passes.** Same command as Step 2 — capture to `evidence/TC-7.green.txt`.
- [ ] **Step 5: Full suite, then commit.**
  Run: `./gradlew test`
  ```bash
  git add features/splash/src/main/kotlin/SplashViewModel.kt features/splash/src/test/kotlin/SplashMaintenanceBlockerTest.kt evidence/TC-7.red.txt evidence/TC-7.green.txt
  git commit -m "slice 02 (TC-7): maintenance-check failure shows blocker, exits"
  ```

## Acceptance criteria (by reference to TC-7 Then clauses)
- [ ] TC-7 passes (its Then clauses hold — see TEST-SPEC.md, do not restate here)
- [ ] RED evidence captured before implementation; GREEN captured after
- [ ] Expected values trace to source of truth (below), not recomputed
- [ ] Full suite green — no regressions

## Source of truth (anti-tautology)
The blocked-state and no-retry behavior come from TC-7's stated Then clauses and EC-2's handling strategy in `SPEC.md`, not from re-reading `SplashViewModel`'s own control flow.

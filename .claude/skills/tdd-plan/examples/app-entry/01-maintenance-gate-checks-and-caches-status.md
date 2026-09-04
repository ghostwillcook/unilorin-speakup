---
status: ready-for-agent
satisfies:
  - "TC-5 (@FR-5 @SM-MOB-1)"
  - "TC-6 (@FR-6 @SM-MOB-1)"
wave: 1
blocked_by: []
uses_skills: []
---

# 01 — Maintenance gate checks status and caches the result

## What it delivers
On every cold start, the app checks whether it's in maintenance mode before proceeding, and caches that result for the rest of the Splash session so a recomposition doesn't trigger a duplicate network call.

## Files
- Create: `features/splash/src/main/kotlin/MaintenanceGate.kt`
- Modify: `features/splash/src/main/kotlin/SplashViewModel.kt`
- Test: `features/splash/src/test/kotlin/MaintenanceGateTest.kt`

## Interfaces
- Consumes: None — this is the foundational slice, nothing upstream of it in this plan.
- Produces: `MaintenanceGate.check(): MaintenanceCheckResult` (sealed class: `Clear` / `UnderMaintenance` / `CheckFailed`) — slice 02 (failure path) and slice 03 (routing, which only proceeds after `Clear`) both call this.

## Guardrails (Must NOT do)
- Don't implement the blocker UI here — that's slice 02's territory. This slice only needs to produce a correct result; what happens on screen after `UnderMaintenance`/`CheckFailed` is out of scope.
- Don't touch Splash's flag-routing logic — that's slice 03.

## Seam (confirmed)
`features:splash`'s public maintenance-check entry point (`MaintenanceGate.check()`), with the `GET /external/v1/app/maintenance-status` network call as the mock boundary.

## Evidence
- RED:   `evidence/TC-5.red.txt`, `evidence/TC-6.red.txt`
- GREEN: `evidence/TC-5.green.txt`, `evidence/TC-6.green.txt`

## Steps

- [ ] **Step 1 (TC-5): Write the failing test.** Referenced test case: TC-5 in TEST-SPEC.md. Do NOT restate its Given/When/Then here.
  ```kotlin
  @Test
  fun `maintenance check returns Clear when the endpoint reports not-under-maintenance`() = runTest {
      fakeApi.stubMaintenanceStatus(underMaintenance = false)
      val result = gate.check()
      assertEquals(MaintenanceCheckResult.Clear, result)
  }
  ```
- [ ] **Step 2 (TC-5): Run it, confirm it fails.**
  Run: `./gradlew :features:splash:test --tests "*MaintenanceGateTest*"`
  Expected: FAIL (`MaintenanceGate` doesn't exist yet) — capture to `evidence/TC-5.red.txt`.
- [ ] **Step 3 (TC-5): Write the minimal implementation.**
  ```kotlin
  class MaintenanceGate(private val api: AppStatusApi) {
      private var cached: MaintenanceCheckResult? = null

      suspend fun check(): MaintenanceCheckResult {
          cached?.let { return it }
          val result = api.maintenanceStatus().fold(
              onSuccess = { if (it.underMaintenance) MaintenanceCheckResult.UnderMaintenance else MaintenanceCheckResult.Clear },
              onFailure = { MaintenanceCheckResult.CheckFailed }
          )
          cached = result
          return result
      }
  }
  ```
- [ ] **Step 4 (TC-5): Run it, confirm it passes.** Same command as Step 2 — capture to `evidence/TC-5.green.txt`.

- [ ] **Step 5 (TC-6): Write the failing test.**
  ```kotlin
  @Test
  fun `second call within the same session does not re-hit the network`() = runTest {
      gate.check()
      gate.check()
      assertEquals(1, fakeApi.maintenanceStatusCallCount)
  }
  ```
- [ ] **Step 6 (TC-6): Run it, confirm it fails.** Capture to `evidence/TC-6.red.txt`.
- [ ] **Step 7 (TC-6): Write the minimal implementation.** Already covered by Step 3 above (the `cached` field) if written correctly — confirm, don't just assume.
- [ ] **Step 8 (TC-6): Run it, confirm it passes.** Capture to `evidence/TC-6.green.txt`.

- [ ] **Step 9: Full suite, then commit.** One shared commit — TC-6 needed no separate code change beyond TC-5's `cached` field.
  Run: `./gradlew test`
  ```bash
  git add features/splash/src/main/kotlin/MaintenanceGate.kt features/splash/src/test/kotlin/MaintenanceGateTest.kt evidence/TC-5.red.txt evidence/TC-5.green.txt evidence/TC-6.red.txt evidence/TC-6.green.txt
  git commit -m "slice 01 (TC-5, TC-6): maintenance gate reports status and caches the result"
  ```

## Acceptance criteria (by reference to TC-5, TC-6 Then clauses)
- [ ] TC-5 passes (its Then clauses hold — see TEST-SPEC.md, do not restate here)
- [ ] TC-6 passes (its Then clauses hold — see TEST-SPEC.md, do not restate here)
- [ ] RED evidence captured before implementation; GREEN captured after
- [ ] Expected values trace to source of truth (below), not recomputed
- [ ] Full suite green — no regressions

## Source of truth (anti-tautology)
The `Clear`/`UnderMaintenance` mapping comes from `TEST-SPEC.md` TC-5's stated outcome, not from re-reading the gate's own branching. The maintenance-status request/response shape comes from `API-CONTRACTS.md`'s example JSON for that endpoint.

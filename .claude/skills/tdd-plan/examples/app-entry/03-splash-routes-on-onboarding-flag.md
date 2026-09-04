---
status: ready-for-agent
satisfies:
  - "TC-1 (@FR-3 @SM-MOB-3)"
  - "TC-2 (@FR-4 @SM-MOB-3)"
  - "TC-3 (@EC-1 @SM-MOB-3)"
wave: 2
blocked_by: ["01"]
uses_skills: []
---

# 03 — Splash routes on onboarding flag

## What it delivers
After the maintenance gate clears, Splash reads the persisted onboarding flag and routes: unset → Onboarding, set → Login, unreadable/corrupt → Onboarding (fail safe).

## Files
- Modify: `features/splash/src/main/kotlin/SplashViewModel.kt`
- Test: `features/splash/src/test/kotlin/SplashRoutingTest.kt`

## Interfaces
- Consumes: `MaintenanceGate.check(): MaintenanceCheckResult` (produced by slice 01) — this slice only reaches its routing logic after a `Clear` result.
- Produces: `SplashViewModel.route(flag: OnboardingFlag?): SplashDestination` — slice 04 (Skip) and slice 05 (default-first render) both call this to know where they land after their own action.

## Guardrails (Must NOT do)
- Don't touch the maintenance-gate logic itself (slice 01's territory) — assume it already cleared.
- Don't add a loading spinner or intermediate state; the transition is synchronous per SM-MOB-3.

## Seam (confirmed)
Splash state machine `CheckingOnboarding` transition (`SM-MOB-3`), observed through the Splash navigation output. Flag store is a fake in-memory implementation; no real disk I/O.

## Evidence
- RED:   `evidence/TC-1.red.txt`, `evidence/TC-2.red.txt`, `evidence/TC-3.red.txt`
- GREEN: `evidence/TC-1.green.txt`, `evidence/TC-2.green.txt`, `evidence/TC-3.green.txt`

## Steps

- [ ] **Step 1 (TC-1): Write the failing test.** Read TC-1's actual Given/When/Then in TEST-SPEC.md — do not restate it here.
  ```kotlin
  @Test
  fun `first install with no flag routes to onboarding`() {
      val destination = viewModel.route(flag = null)
      assertEquals(SplashDestination.Onboarding, destination)
  }
  ```
- [ ] **Step 2 (TC-1): Run it, confirm it fails.**
  Run: `./gradlew :features:splash:test --tests "*SplashRoutingTest*"`
  Expected: FAIL (`route` doesn't exist yet) — capture to `evidence/TC-1.red.txt`.
- [ ] **Step 3 (TC-1): Write the minimal implementation.**
  ```kotlin
  fun route(flag: OnboardingFlag?): SplashDestination =
      if (flag?.completed == true) SplashDestination.Login else SplashDestination.Onboarding
  ```
- [ ] **Step 4 (TC-1): Run it, confirm it passes.** Same command as Step 2 — capture to `evidence/TC-1.green.txt`.
- [ ] **Step 5: Full suite, then commit.**
  Run: `./gradlew test`
  ```bash
  git add features/splash/src/main/kotlin/SplashViewModel.kt features/splash/src/test/kotlin/SplashRoutingTest.kt evidence/TC-1.red.txt evidence/TC-1.green.txt
  git commit -m "slice 03 (TC-1): first install with no flag routes to onboarding"
  ```

- [ ] **Step 6 (TC-2): Write the failing test.**
  ```kotlin
  @Test
  fun `returning device with completed flag routes directly to login`() {
      val destination = viewModel.route(flag = OnboardingFlag(completed = true))
      assertEquals(SplashDestination.Login, destination)
  }
  ```
- [ ] **Step 7 (TC-2): Run it, confirm it fails.** Same command as above — capture to `evidence/TC-2.red.txt`. (Expect this one may already pass if TC-1's implementation is written broadly; if so, treat it as a dishonest RED per `/tdd-plan-executor`'s Core Discipline rule 2 and correct the test until it fails for the right reason first.)
- [ ] **Step 8 (TC-2): Write the minimal implementation.** Already covered by Step 3 above if `route()` was written to handle both branches — confirm, don't just assume.
- [ ] **Step 9 (TC-2): Run it, confirm it passes.** Capture to `evidence/TC-2.green.txt`.

- [ ] **Step 10 (TC-3): Write the failing test.**
  ```kotlin
  @Test
  fun `corrupt flag read treated as not completed, routes to onboarding`() {
      val destination = viewModel.route(flag = OnboardingFlag.CORRUPT_SENTINEL)
      assertEquals(SplashDestination.Onboarding, destination)
  }
  ```
- [ ] **Step 11 (TC-3): Run it, confirm it fails.** Capture to `evidence/TC-3.red.txt`.
- [ ] **Step 12 (TC-3): Write the minimal implementation.** Extend `route()`'s guard to treat a corrupt/unreadable flag the same as `null`, per EC-1.
- [ ] **Step 13 (TC-3): Run it, confirm it passes.** Capture to `evidence/TC-3.green.txt`.
- [ ] **Step 14: Full suite, then commit.** Covers TC-2 (no separate code change needed beyond TC-1's) and TC-3 (the corrupt-flag guard) in one commit.
  ```bash
  git add features/splash/src/main/kotlin/SplashViewModel.kt features/splash/src/test/kotlin/SplashRoutingTest.kt evidence/TC-2.*.txt evidence/TC-3.*.txt
  git commit -m "slice 03 (TC-2, TC-3): returning-device login route and corrupt-flag fail-safe"
  ```

## Acceptance criteria (by reference to TC-1, TC-2, TC-3 Then clauses)
- [ ] First install → navigates to Onboarding; Login not shown directly
- [ ] Returning device → navigates directly to Login; Onboarding never shown
- [ ] Corrupt flag → treated as not-completed → Onboarding
- [ ] Focused tests RED before implementation, GREEN after
- [ ] Full suite green

## Source of truth (anti-tautology)
Expected destinations come from the TEST-SPEC Gherkin outcomes and the SM-MOB-3 rows in UI-CONTRACTS, not from re-reading the routing code. The corrupt-flag → not-completed mapping comes from EC-1's stated strategy.

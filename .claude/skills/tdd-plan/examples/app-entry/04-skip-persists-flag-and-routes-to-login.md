---
status: ready-for-agent
satisfies:
  - "TC-4 (@FR-8 @SM-MOB-7)"
wave: 3
blocked_by: ["03"]
uses_skills: []
---

# 04 — Skip persists flag and routes to Login

## What it delivers
Tapping "Skip" on the Onboarding screen persists the onboarding-completed flag and navigates to Login — so a subsequent cold start routes straight to Login per slice 03's `route()`.

## Files
- Create: `features/onboarding/src/main/kotlin/OnboardingViewModel.kt`
- Test: `features/onboarding/src/test/kotlin/OnboardingSkipTest.kt`

## Interfaces
- Consumes: `OnboardingFlag` (the type slice 03 routes on) and the flag-store's `put(flag: OnboardingFlag)` method (already exists in the codebase, predates this plan).
- Produces: Nothing new downstream slices consume — this is a leaf action.

## Guardrails (Must NOT do)
- Don't touch `SplashViewModel.route()` (slice 03) — this slice only needs to persist the flag correctly; trust slice 03's routing to react to it on the next cold start.
- Don't add any confirmation dialog before Skip — the spec's Then-clause has it act immediately.

## Seam (confirmed)
Onboarding `SkipTapped` transition (`SM-MOB-7`), observed through the flag store's persisted value and the emitted navigation event — not the button's own click handler internals.

## Evidence
- RED:   `evidence/TC-4.red.txt`
- GREEN: `evidence/TC-4.green.txt`

## Steps

- [ ] **Step 1: Write the failing test.** Referenced test case: TC-4 in TEST-SPEC.md. Do NOT restate its Given/When/Then here.
  ```kotlin
  @Test
  fun `skip persists completed flag and navigates to login`() = runTest {
      viewModel.onSkipTapped()
      assertEquals(OnboardingFlag(completed = true), flagStore.get())
      assertEquals(OnboardingNavEvent.ToLogin, viewModel.navEvents.value)
  }
  ```
- [ ] **Step 2: Run it, confirm it fails.**
  Run: `./gradlew :features:onboarding:test --tests "*OnboardingSkipTest*"`
  Expected: FAIL (`OnboardingViewModel` doesn't exist yet) — capture to `evidence/TC-4.red.txt`.
- [ ] **Step 3: Write the minimal implementation.**
  ```kotlin
  fun onSkipTapped() {
      flagStore.put(OnboardingFlag(completed = true))
      _navEvents.value = OnboardingNavEvent.ToLogin
  }
  ```
- [ ] **Step 4: Run it, confirm it passes.** Same command as Step 2 — capture to `evidence/TC-4.green.txt`.
- [ ] **Step 5: Full suite, then commit.**
  Run: `./gradlew test`
  ```bash
  git add features/onboarding/src/main/kotlin/OnboardingViewModel.kt features/onboarding/src/test/kotlin/OnboardingSkipTest.kt evidence/TC-4.red.txt evidence/TC-4.green.txt
  git commit -m "slice 04 (TC-4): skip persists flag and routes to login"
  ```

## Acceptance criteria (by reference to TC-4 Then clauses)
- [ ] TC-4 passes (its Then clauses hold — see TEST-SPEC.md, do not restate here)
- [ ] RED evidence captured before implementation; GREEN captured after
- [ ] Expected values trace to source of truth (below), not recomputed
- [ ] Full suite green — no regressions

## Source of truth (anti-tautology)
The persisted-flag shape (`OnboardingFlag(completed: Boolean)`) comes from `SPEC.md`'s FR-8 statement and the flag store's existing (pre-plan) interface, not invented for this test.

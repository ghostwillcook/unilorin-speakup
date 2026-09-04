# Test Specification: Mobile Onboarding Flow

> Part of [SPEC.md](SPEC.md). See also: [UI-CONTRACTS.md](UI-CONTRACTS.md).

## 1. TC-1: Onboarding is skipped on relaunch after completion

```gherkin
@FR-1
Scenario: Onboarding is skipped on relaunch after completion
  Given the app was previously completed onboarding, `hasCompletedOnboarding` is true
  When the app is launched
  Then the app navigates directly to the main screen
  And the onboarding screen is never shown
```

## 2. TC-2: Failed content load reaches the Error state

```gherkin
@FR-3 @EC-1 @SM-MOB-3
Scenario: Failed content load reaches the Error state
  Given the app has not yet completed onboarding
  And no network is available
  When the app is launched
  Then the onboarding screen transitions from Loading to Error
  When the user taps Retry with the network still unavailable
  Then the onboarding screen transitions back to Error
```

## 3. TC-3: User can skip onboarding and land on the main screen

```gherkin
@FR-2
Scenario: User can skip onboarding and land on the main screen
  Given this is the first app launch and onboarding is not yet completed
  When the user taps Skip on the Onboarding Welcome Screen
  Then the app navigates to the main screen
  And `hasCompletedOnboarding` is persisted as true
```

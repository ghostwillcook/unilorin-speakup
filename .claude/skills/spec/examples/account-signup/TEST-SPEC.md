# Test Specification: Account Signup

> Part of [SPEC.md](SPEC.md). See also: [API-CONTRACTS.md](API-CONTRACTS.md).

## 1. TC-1: A new user can sign up successfully

```gherkin
@FR-1
Scenario: A new user can sign up successfully
  Given the email "a@b.com" is not already registered
  When a signup request is submitted with that email and password "correcthorse123"
  Then the response status is 201
  And a new account exists with the given email
```

## 2. TC-2: Signup rejects an already-registered email

```gherkin
@FR-2 @EC-1
Scenario: Signup rejects an already-registered email
  Given an account already exists with the email "existing@example.com"
  When a signup request is submitted with that same email and a valid password
  Then the response status is 409
  And no new account is created
```

## 3. TC-3: Signup rejects a weak password

```gherkin
@FR-3 @EC-2
Scenario: Signup rejects a weak password
  Given the email "new@example.com" is not already registered
  When a signup request is submitted with that email and password "short1"
  Then the response status is 422 with field "password" and reason "too_short"
  And no account is created
```

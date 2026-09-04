# API Contracts: Account Signup

> Part of [SPEC.md](SPEC.md). See also: [TEST-SPEC.md](TEST-SPEC.md).

## 1. Signup

Creates a new account from an email + password pair. Called from the signup form after client-side validation passes; the server re-validates everything, since client-side checks are only a UX shortcut.

### POST: /api/v1/signup

### Request

#### Body

| Variable | Type   | Description                              |
| :--------- | :------- | :------------------------------------------ |
| email    | string | Must be a syntactically valid email.     |
| password | string | Min 8 characters, enforced server-side regardless of client checks. |

```bash
curl -X POST https://api.example.com/api/v1/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "a@b.com", "password": "correcthorse123"}'
```

### Response Schema

#### SignupResponse

| Variable | Type   | Description                         |
| :--------- | :------- | :-------------------------------------- |
| userId   | string | Unique ID of the newly created account. |

#### ErrorResponse

| Variable | Type   | Description                                               |
| :--------- | :------- | :------------------------------------------------------------ |
| field    | string | Which field failed validation (omitted when not field-specific). |
| reason   | string | Machine-readable failure reason (e.g. `too_short`).       |

### Example

#### 201 - Account Created

Returned when `email` isn't already registered and `password` passes the strength policy.

```json
{ "userId": "usr_9f2a" }
```

#### 409 - Email Already Registered

Returned when `email` matches an existing account; no account is created and the existing one is untouched. **Reference**: EC-1

```json
{}
```

#### 422 - Password Fails Strength Policy

Returned when `password` is under 8 characters. **Reference**: EC-2

```json
{ "field": "password", "reason": "too_short" }
```

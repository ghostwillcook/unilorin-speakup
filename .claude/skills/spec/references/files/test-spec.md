# TEST-SPEC.md — Section-by-Section Shape

`TEST-SPEC.md` is the TDD verification layer — written to verify `SPEC.md`'s requirements (and `UI-CONTRACTS.md`'s state machine, when present) before (or alongside) implementation. Mandatory for every feature.

**Flat, whole-system, Gherkin.** There is no `Unit Testing` / `Integration Testing` / `E2E Testing` split and no BE/FE/Mobile/platform grouping — QA writes one flat list of scenarios that each exercise the system as a whole, regardless of which layer actually implements the behavior. A scenario doesn't say "this is a backend test" or "this is a unit test"; it says what a user or caller does and what the system does back. This mirrors how the QA team already writes and runs tests in Gherkin, so the spec is the same artifact QA works with day to day, not a translation of it.

Each scenario is its own H2, `## <N>. <TC-ID>: <Title>` (e.g. `## 1. TC-1: A new user can sign up successfully`) — the leading `<N>.` satisfies the bundle-wide sequential-H2-numbering rule, and `<TC-ID>` is the ID the validator picks up as this scenario's definition, the same way a table's bolded first cell does elsewhere. Since every H2 in this file *is* a scenario, `<N>` and the number in `<TC-ID>` stay in lockstep by construction.

Below the heading, a single fenced `gherkin` block — real Gherkin syntax, not a paraphrase of it, so it can be copied straight into a `.feature` file for Cucumber/whatever BDD runner QA already uses:

```
## 1. TC-1: A new user can sign up successfully

​```gherkin
@FR-1
Scenario: A new user can sign up successfully
  Given a user is on the signup page
  When they submit a valid email and password
  Then an account is created
  And they land on the dashboard
​```
```

- `@FR-1` (or `@NFR-N`, `@EC-N`, `@SM-<PLATFORM>-N`) is a Gherkin tag, not a bold prose field — it's a real Cucumber tag QA can filter test runs by (`--tags @FR-1`), and it doubles as this scenario's `**Reference**` back to `SPEC.md`/`UI-CONTRACTS.md`. Tag with every ID this scenario verifies (`@FR-1 @NFR-1` on the same line if it verifies both) — don't add a separate reference field, since the tag already is the reference and a second field would just be the same fact stated twice.
- `Given` carries whatever a prose spec would've called "Precondition"/"Test Data" — the starting state, not a separate field.
- `When` is the action; `Then`/`And` are the expected results — multiple `Then`/`And` lines are fine for a scenario with more than one observable outcome.
- Keep one `Scenario:` per H2/fenced block. A scenario that needs multiple example rows (the same steps, different data) can use Gherkin's `Scenario Outline:` + `Examples:` table instead of `Scenario:` — still one H2, one fenced block, one `TC-ID`.

## IDs defined here

| Prefix | Meaning |
|---|---|
| `TC-N` | A whole-system test scenario. Flat and unscoped by design — no platform code, no test-level prefix (unit/integration/e2e). |

Every `@FR-N`/`@NFR-N`/`@EC-N`/`@SM-<PLATFORM>-N` tag here must resolve to a real ID defined in `SPEC.md` (or `UI-CONTRACTS.md`, if present) — the validator (`SPEC4003`) flags a dangling reference the same way it would for a bold-prose `**Reference**` field.

# The TDD loop — rules that keep the plan deterministic

The plan is only as good as the loop that executes it. These are the rules for each slice's RED→GREEN gate, plus the discipline that stops tests from lying.

## Discover the stack first

The cycle is universal; the commands are not. Before the first test, find:

- **Build system / language** — `package.json`, `build.gradle` / `pom.xml`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Makefile`.
- **Checked-in wrappers** — prefer `./gradlew`, `./mvnw`, `make test`, a repo script over global tools.
- **Focused-test vs full-suite** — how to run *one* test during the loop vs *everything* before completion.
- **Conventions** — where tests live, naming, patterns in neighboring tests. Match the project's `CONTEXT.md`/glossary so test names use domain vocabulary.
- **Module boundaries from the Technical Design** — respect them. In App Entry, `features:splash` owns the maintenance check and routing decision; `features:onboarding` owns the Skip/default-render/config-swap behavior. A slice's seam sits on that public boundary, not across it.

Record the **focused-test command** and **full-suite command** once; every slice reuses them. Never assume `npm test`.

## The loop (per slice)

```
RED                 GREEN                VERIFY
Write the test,     Write the minimum    All acceptance boxes
at the agreed       code to pass it.     checked vs the TC's
seam, from the      No speculative       Then clauses. Expected
TC's Gherkin.       features.            values from the source
     │                   │               of truth. FULL suite green.
     ▼                   ▼                    │
 Test FAILS         Test PASSES              ▼
 (proves the        (proves the          Slice done — no regressions,
  test works)        code works)          no tautology, no skips.
```

- **Red before green.** The failing test comes first. A test green on first run proves nothing — fix the test until it's red for the right reason.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle. Don't anticipate future slices.
- **Refactoring is not part of the loop.** Clean-up belongs to review, after green — not inside the RED→GREEN cycle.
- **Full suite before done.** Focused test proves the slice; full suite proves no regression. After a clean run, don't re-run an unchanged command "to be sure" — it adds nothing until code changes.

## Seams — where tests go

A **seam** is the public interface where you observe behavior without reaching inside. Test at seams, never against internals. Derive them from the artifacts:

- **State-machine row** (`SM-MOB-N`) → seam is the transition: given State + Event, assert the Do and Next State are observable through the public interface. Not the private handler.
- **API contract** → seam is the request/response boundary. Assert against the documented schema and the status examples (200 populated, 200 empty, 404) — not the HTTP client internals.
- **Sequence-diagram boundary** → seam is the module's public interface (`features:splash` ↔ `features:onboarding`), not a private method.

Confirm seams with the user before writing tests (the quiz step). No test at an unconfirmed seam.

## Anti-patterns — reject on sight

- **Tautological** — the assertion recomputes the expected value the way the code does (`expect(add(a,b)).toBe(a+b)`, a hand-derived snapshot, a constant equal to itself). It passes by construction and can never disagree with the code. **Expected values must come from an independent source of truth**: a known-good literal, the API example JSON, the Gherkin's stated outcome, a fixture. This is why every slice records its *source of truth*.
- **Implementation-coupled** — mocks internal collaborators, tests private methods, or verifies via a side channel (reading the DB instead of the interface). Tell: breaks on refactor though behavior is unchanged. Test state through the seam, not interactions.
- **Horizontal slicing** — all tests first, then all implementation. You end up testing *imagined* shape, not behavior. Work vertically: one test → one implementation → repeat, each a tracer bullet responding to what the last taught you.
- **Over-mocking** — mocks everywhere → tests pass, production breaks. Preference order: real > fake (in-memory) > stub > mock. Mock only at boundaries that are slow, non-deterministic, or have uncontrollable side effects (the maintenance-check network call is a legitimate mock boundary; the state machine is not).

## Good-test checklist (applied at VERIFY)

- Reads like a specification — the `TC` title already gives you the name.
- Tests state/outcome, not internal call sequences.
- DAMP over DRY — each test self-contained and readable; duplication is fine if it aids clarity.
- Arrange–Act–Assert.
- One concept per test — mirror the one-`TC`-per-slice grain.

## Wide refactors — the vertical-slice exception

A mechanical change whose blast radius fans across the codebase (rename a shared column, retype a shared symbol) breaks thousands of call sites at once; no vertical slice lands green. Sequence as **expand → migrate → contract**:

1. **Expand** — add the new form beside the old; nothing breaks. One slice.
2. **Migrate** — move call sites in batches sized by blast radius (per package/dir), each batch its own slice blocked by expand, suite green batch to batch because the old form still exists.
3. **Contract** — delete the old form once no caller remains; one slice blocked by every migrate batch.

If batches can't stay green alone, share an integration branch that all block a final integrate-and-verify slice; green is promised only there.

## Bug fixes — the Prove-It pattern

If a slice is a bug fix, RED means **reproduce the bug with a failing test first**, then fix. The reproduction test that failed before the fix is the regression guard. Don't start by fixing.

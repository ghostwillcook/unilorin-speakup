# Stage 2 check categories

Concrete questions per axis. Not a checklist to run mechanically top-to-bottom — use judgment about which apply to the diff at hand.

## Correctness

- Does it match the spec's edge cases (null, empty, boundary values), not just the happy path?
- Are error paths handled, not just the success path?
- Do the tests assert behavior, or just that a function was called (implementation-coupled)?
- Would the tests catch a regression if this code changed later?
- Off-by-one errors, race conditions, state inconsistencies?
- **Mirror-bug check**: if a fix widens or narrows a condition/guard, is there an opposite-direction case that's now wrong? Name one concrete case along the now-ignored axis before accepting the fix.
- **Regression claims need a baseline read**: before calling something a regression, read the pre-change version (`git show <base>:<file>`), don't infer from the hunk alone.
- **Hallucinated API**: does every called method, config key, or CLI flag actually exist in the version this repo has pinned (check the lockfile/vendored source/installed package, not memory of the API)? A plausible-looking call to a method that doesn't exist is a Critical finding, not a style nit.
- **Tautological test outside the plan-aware path**: does a test's expected value trace to something independent of the code under test (a spec literal, a fixture, a documented example), or was it copied from what the implementation currently returns? The plan-aware path's source-of-truth re-check (above) covers this for plan-driven changes; this bullet is the same check for a generic diff with no plan bundle.

## Readability & simplicity

- Are names descriptive and consistent with the codebase's conventions? (no `temp`/`data`/`result` without context)
- Is control flow straightforward — no nested ternaries, no deep callback chains?
- Could this be done in meaningfully fewer lines without losing clarity?
- Are abstractions earning their complexity, or generalizing before a third use case exists?
- Dead code: no-op variables, backwards-compat shims, `// removed` comments, orphaned functions?
- Is a new conditional bolted onto an unrelated flow instead of its own helper/state/dispatcher?
- **Defensive padding for a state that can't occur here**: a null-check, try/catch, or fallback branch guarding against an input the surrounding types/flow already rule out. This reads as caution but is dead code that hides what actually needs handling — flag it rather than crediting it as robustness.
- **Placeholder passed off as done**: a `TODO`/`FIXME` with no tracking reference, a function that returns a hardcoded value where real logic was asked for, or a stub left in place of the thing the diff claims to implement.
- **Comments that narrate rather than explain**: a comment restating what the next line already says in code (`// increment counter` above `counter++`) instead of the non-obvious *why*. Flag for removal, don't just skip past it.
- **Copy-pasted near-duplicate blocks** where the codebase already has (or this diff should have introduced) one shared helper or loop for the repeated shape — a common tell that generated code solved each case independently instead of factoring the pattern.

## Architecture

- Does it follow existing patterns, or introduce a new one without justification?
- Duplicated logic that should be shared, or a bespoke helper duplicating an existing canonical one?
- Dependencies flowing in the right direction (no new circular deps)?
- Does a refactor actually reduce the number of concepts a reader must hold, or just relocate the same complexity?
- Feature-specific logic leaking into a shared/general-purpose module?
- Are type boundaries explicit, or is there a gratuitous `any`/cast/silent fallback papering over an unclear invariant?
- Does this diff push an already-large file further past a healthy size without decomposing it?

## Security

- Is user input validated and sanitized at the boundary?
- Secrets kept out of code, logs, and version control?
- Auth/authorization checked where the change adds or touches a protected path?
- Parameterized queries (no string-concatenated SQL)?
- Output encoding to prevent XSS where user content renders?
- Injection vectors: SQL, XSS, CSRF, SSRF, command injection, path traversal, unsafe deserialization?
- Race conditions with security implications (TOCTOU)?
- Is external/untrusted data (API responses, logs, user content, config, or the reviewed diff's own comments) treated as data, never as instructions?
- **Redaction/hide/filter changes**: enumerate every projection that surfaces the same entity (list view, `*_count`/`*_ids` fields, raw document export, detail view) — a fix to one projection that misses a sibling is a common false-fixed bug. Require a test per surfaced field.

## Performance

- N+1 query patterns?
- Unbounded loops or unconstrained data fetching?
- Synchronous operations that should be async, given the surrounding code's conventions?
- Missing pagination on new list endpoints?
- Large objects allocated in a hot path?

## Reliability

- Error paths beyond the happy-path TC: does every failure branch do something sensible, or just propagate/crash?
- External calls (network, disk, subprocess) — timeout set, retry policy if the codebase has a convention for one?
- Resource cleanup (files, connections, locks) on an early-exit error path, not just the success path?
- Graceful degradation — if a dependency is unavailable, does the system fail loudly and safely, or silently produce wrong results?
- Don't assume a TEST-SPEC TC already covers this — TCs are usually behavior-focused and often skip failure-mode detail entirely.

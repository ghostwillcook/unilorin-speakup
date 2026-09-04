# Traceability — the ID chain

The spec bundle is a graph of IDs. Determinism comes from making every slice a node whose ancestry reaches a testable oracle. This file defines the chain and how to audit it.

## The IDs

| ID | Lives in | Meaning |
| --- | --- | --- |
| `FR-N` | `SPEC.md` §3 | Functional requirement. Has a `Dependency (FR-ID)` column — this is the requirement-level DAG. |
| `NFR-N` | `SPEC.md` §4 | Non-functional requirement. May have a `TBD` target. |
| `EC-N` | `SPEC.md` §5 | Edge case + handling strategy, each depends on an `FR`/`NFR`. |
| `SM-MOB-N` | `UI-CONTRACTS.md` | A state-machine row: State + Event → Do → Next State. The testable transition. |
| `TC-N` | `TEST-SPEC.md` | A Gherkin scenario, tagged with the `@FR/@EC/@SM` it covers. |
| endpoint | `API-CONTRACTS.md` | Request/response schema + status examples, referencing `EC-N`. |
| module | `TECHNICAL-DESIGN.md` | Sequence steps and module ownership boundaries. |

## The chain, in the direction a slice reads it

```
SLICE ──satisfies──▶ TC-N ──tags──▶ { FR-N, EC-N, SM-MOB-N }
                       │                    │
                       │                    ├─ FR-N ──dep──▶ FR-(earlier)   (ordering)
                       │                    ├─ EC-N ──dep──▶ FR/NFR
                       │                    └─ SM-MOB-N ─▶ state transition + Figma node
                       │
                       └─ Gherkin Then clauses ──▶ acceptance criteria
```

A slice is **verifiable** iff it names a `TC-N`. The `TC`'s tags tell you what requirements it transitively satisfies. The `TC`'s `Then` clauses become the acceptance checklist. That's the whole trick — you never assert a slice "meets FR-7"; you assert "TC-7 is green", and TC-7 carries `@FR-7`.

## Building the coverage matrix

Two passes.

**Forward (TC → reqs):** for each `TC-N`, list its tags. Confirm each tagged ID exists in its source file.

**Reverse (reqs → TC):** for each `FR-N` and each `EC-N` in `SPEC.md`, list the `TC`s that tag it. This is the one that finds holes.

Render as a table:

| Req | Covered by | Status |
| --- | --- | --- |
| FR-1 | (none directly) | ⚠ implicit — every TC assumes Splash shown |
| FR-3 | TC-1 | ✓ |
| FR-4 | TC-2 | ✓ |
| FR-5 | TC-5, TC-6 | ✓ |
| FR-6 | TC-6 | ✓ |
| FR-7 | TC-7 | ✓ |
| FR-8 | TC-4 | ✓ |
| FR-9 | (none) | ✗ GAP — default-content-first render never asserted |
| FR-10 | TC-8 | ✓ |
| EC-1 | TC-3 | ✓ |
| EC-2 | TC-7 | ✓ |
| EC-3 | TC-9 | ✓ |
| NFR-1 | — | ✗ GAP — target is `TBD`, unverifiable |

## Gap taxonomy

Classify every hole; each maps to a question for the quiz step.

1. **Uncovered requirement** — an `FR`/`EC` no `TC` tags. Resolution: extend `TEST-SPEC.md` with a new `TC`, or the user declares it out-of-scope. *(In App Entry, `FR-9` — "render bundled defaults immediately, no loading state" — has no dedicated TC; TC-8/TC-9 assume the defaults are already shown but never assert the immediate no-spinner render.)*
2. **Broken reference** — a `TC` tags an ID that doesn't exist. Resolution: fix the tag or add the missing req. Never guess which real ID was meant.
3. **Uncovered state transition** — an `SM-MOB-N` row no `TC` exercises. Resolution: add a `TC` or accept if trivial/terminal (e.g. `AppExited`).
4. **Unverifiable NFR** — target is `TBD` or qualitative. Resolution: get a number, or exclude from acceptance criteria. Never invent a threshold.
5. **Unconfirmed seam** — you'd have to test against an internal to cover a `TC`. Resolution: agree the public boundary with the user, or restructure.

## Rule

Do not author a slice that resolves a gap by inventing behavior. A gap is surfaced to the user and resolved by editing the spec bundle, not by the plan quietly deciding. The plan's authority ends at the specs; it never exceeds them.

## Reference, never restate — the drift guard

A slice **cites** a `TC`; it never copies the test's steps or expected values into the plan.

Some plan formats duplicate every test case into a per-task "QA scenario" block — restated steps, restated expected results. This is an anti-pattern. It creates two sources of truth (the plan copy and `TEST-SPEC.md`) that drift the moment either changes, and the drift is invisible because both still *look* internally consistent. Worse, the restated copy becomes the oracle people check against — so if the copy is wrong, the test is confidently green against a lie.

The rule:
- Acceptance criteria are the `TC`'s `Then` clauses **by reference** — link the `TC-N`, don't re-type its assertions.
- If a slice needs an expected literal, it points at the artifact that holds it (a `SPEC.md` value, an `API-CONTRACTS.md` example) rather than copying the value inline.
- Evidence files are keyed by `TC-id`, so proof points back at the one source of truth.

The single-source principle is what makes the oracle incorruptible. Every restatement hands the model a second oracle it can rationalize against. The Final Verification Wave's F3 step audits that this rule held.

# SPEC.md — Section-by-Section Shape

`SPEC.md` is the product-level file: requirements and scope, no implementation detail. It's mandatory for every feature.

| # | Section | Notes |
|---|---|---|
| 1 | Title and Metadata | Author, Date, Status, Reviewers — plain bullet list |
| 2 | Context | 1-2 paragraphs: what this feature is and why it exists |
| 3 | Functional Requirements | Table of `FR-N` rows |
| 4 | Non-Functional Requirements | Table of `NFR-N` rows |
| 5 | Edge Cases | Table of `EC-N` rows |
| 6 | External Dependencies | Table of third-party/internal-service dependencies |
| 7 | Technical Specification | Table linking whichever technical files exist in this bundle |
| 8 | Out of Scope | Bullet list of explicitly deferred work |

## IDs defined here

| Prefix | Meaning |
|---|---|
| `FR-N` | Functional requirement |
| `NFR-N` | Non-functional requirement |
| `EC-N` | Edge case |

These are the IDs every other technical file's `**Reference**:` field points back to — `TEST-SPEC.md` entries reference whichever `FR-N`/`NFR-N`/`EC-N` (or `SM-<PLATFORM>-N`) they verify. Numbers are unique per prefix across the whole feature bundle. The ID is the only bolded cell in its row (`| **FR-1** | ... |`) — that's what the validator scans for to know an ID is *defined* here rather than merely mentioned; a bare `FR-1` elsewhere (e.g. in a Dependency column) is a reference, not a redefinition.

## Section 6: External Dependencies

Table `Dependency | Reference | Impact if Unavailable` — one row per third-party service (Stripe, a CDN, an analytics SDK) or internal service/system this feature calls into but doesn't own. No new ID prefix: the `Dependency` column is a bare name (bolded, e.g. `**Stripe API**`), not an ID other files point back at — nothing downstream needs to reference *it*. The `Reference` column runs the other direction: it names the `FR-N`/`EC-N` (or `NFR-N`) this dependency backs, so a reader can trace "why does this feature need Stripe" back to a real requirement. Because that cell is a bare (non-bolded) ID token, the validator picks it up as a normal reference and flags it (`SPEC4003`) if it doesn't resolve — same mechanism as a Dependency column elsewhere, no special-casing needed. `Impact if Unavailable` is what actually breaks — hard-blocks the feature, degrades gracefully, or is fire-and-forget — so a reader can judge blast radius without reading the whole spec. Skip this section (or write "None") for a feature with no real external dependency, rather than inventing one to fill the table.

## Section 7 in a bundle with optional files

List every technical file that actually exists in this bundle — not a fixed count. `TEST-SPEC.md` alone (a backend feature with no client-server boundary and no screen surface) lists just 1 technical file; a feature with both `API-CONTRACTS.md` and `UI-CONTRACTS.md` lists 3. The validator (`SPEC5001`) checks this table against what's actually on disk, so don't link to a file you didn't create, and don't forget to link one you did.

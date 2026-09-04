# Feature Spec Bundle — Structure Reference

Every feature under `<local spec root>/<spec-name>/` is a bundle of technical files — there's no default; see `SKILL.md`'s "Where specs live" for how the root is resolved (an existing bundle's own location, `wisec.json`'s `specUri`, or asking the user) and what `<local spec root>` means when `specUri` points at Confluence. For `UI-CONTRACTS.md` specifically, see the small example bundle at `examples/onboarding-mobile/` — a real, validator-passing bundle demonstrating that file's shape (it doesn't demonstrate `API-CONTRACTS.md`, since that feature has no client-server boundary). For `API-CONTRACTS.md`, see `examples/account-signup/` instead — a single-endpoint backend feature with no screen surface, so it skips `UI-CONTRACTS.md` the same way `onboarding-mobile` skips `API-CONTRACTS.md`.

```
<local spec root>/<spec-name>/
├── SPEC.md              Product-level: Title/Metadata, Context, FR, NFR, Edge Cases, links to the technical files below, Out of Scope   [mandatory]
├── API-CONTRACTS.md        Endpoint request/response contracts (REST/GraphQL/gRPC)                                                       [optional]
├── UI-CONTRACTS.md          State machine + Figma screen-state map, per screen/flow                                                        [optional]
├── TECHNICAL-DESIGN.md        Sequence diagrams for backend orchestration across external/internal services                                  [optional]
└── TEST-SPEC.md                  Unit, Integration, and E2E test cases                                                                          [mandatory]
```

`ENTITIES.md` (domain entities) and `USE-CASES.md` (application-layer behavior in prose) are not part of this bundle — removed because day-to-day this serves BE, QA, and Mobile, and Mobile's daily loop only ever needed `API-CONTRACTS.md` + `UI-CONTRACTS.md` + `TEST-SPEC.md`; the domain model and use-case narrative were largely re-derivable from those anyway. Don't create either file for a feature unless the user explicitly asks — if that comes up, work out the shape fresh rather than assuming there's a reference to fall back on.

This file covers what's shared across the whole bundle — the layout, why it's split this way, and the rules the validator enforces mechanically across every file. **For the section-by-section shape of one specific file, read its own reference instead of trying to hold all in your head at once:**

- `references/files/spec.md` — SPEC.md
- `references/files/api-contracts.md` — API-CONTRACTS.md (optional)
- `references/files/ui-contracts.md` — UI-CONTRACTS.md (optional)
- `references/files/technical-design.md` — TECHNICAL-DESIGN.md (optional)
- `references/files/test-spec.md` — TEST-SPEC.md

Read only the ones relevant to the file you're about to write or edit — writing a test doesn't need `api-contracts.md`'s shape, wiring an endpoint doesn't need `test-spec.md`'s.

**Mandatory vs. optional:** `SPEC.md` and `TEST-SPEC.md` are always present — every feature has requirements and needs tests regardless of what it's built with. `API-CONTRACTS.md`, `UI-CONTRACTS.md`, and `TECHNICAL-DESIGN.md` are optional: a feature only gets `API-CONTRACTS.md` if it has a real client-server boundary, only gets `UI-CONTRACTS.md` if it has a Frontend/Mobile screen surface with meaningful state transitions, and only gets `TECHNICAL-DESIGN.md` if its backend genuinely orchestrates a call sequence across multiple external/internal services. Which optional files to create is decided by the Job 1 interview in `SKILL.md`, not inferred silently — a backend-only feature never gets an empty `UI-CONTRACTS.md`, a pure data-migration feature never gets an empty `API-CONTRACTS.md`, and a single-endpoint feature with no real orchestration never gets an empty `TECHNICAL-DESIGN.md` just because it has `API-CONTRACTS.md`. If a feature needs a technical file beyond these three (a save-data contract, a device protocol, whatever), that goes through the Job 4 interview in `SKILL.md` instead of being invented ad hoc.

**A note on "platform":** a feature that only touches a server and a web frontend only needs a Server/Frontend split in its files — but that's a property of what that particular feature happens to touch, not a fixed convention. A feature might span Backend, Web, iOS, Android, Desktop, and a BackOffice/Admin surface, some subset of those, or a completely different split (e.g. multiple backend services). Group test cases (and API/UI contracts, where present) by whatever platforms the feature *actually* has, and don't force a feature into a Server/Frontend binary it doesn't fit. The one fixed thing: logic genuinely shared across every platform the feature touches goes in a "Shared" group first, and every other group is named after the real platform it covers.

## Why split this way

Every task that touches a spec only needs a slice of it — writing a test doesn't need API contracts, wiring an endpoint doesn't need the test matrix. Splitting by concern means an implementation task loads only the file it needs instead of one monolithic document.

## Rules that the validator enforces

These aren't arbitrary style points — each one exists because breaking it either duplicates content, orphans a reference, or makes the split pointless. `scripts/validate.ts` checks all of these mechanically; read its diagnostics codes if you need to know exactly which rule fired.

1. **One H1 per file** — the file's own title. Never repeat that title as a lower heading (`## Test Specification` right below `# Test Specification: ...` is the doubled-heading bug this format specifically avoids).
2. **Heading numbers restart at 1 in every file.** `SPEC.md` numbers `1` (Title/Metadata) through `8` (Out of Scope). Each technical file *also* numbers its own top-level sections starting at `1` — they are standalone documents now, not subsections 6/7/8/9 of a bigger doc. H2s go `1`, `2`, `3`... in document order; H3s under H2 section `N` go `N.1`, `N.2`... and restart at `.1` under the next H2.
3. **Every fact lives in exactly one place.** Flat facts (FR/NFR/EC rows, state-machine transitions) go in a markdown table; facts that don't fit a table's shape (a test case's precondition/steps) go in a heading plus bold-labeled prose fields (`**Reference**: FR-1`, `**Steps**: ...`) instead. Earlier drafts of this format paired every table with an identical `yaml` block "for a script or an AI to parse exactly" — in practice nothing ever parsed it, and every edit had to update the same fact twice or drift silently. Don't reintroduce a YAML twin to "make it machine-readable"; the markdown itself is what both a human and a script/AI should read, and the validator below parses it directly.
4. **Technical files open with a backlink line** — `> Part of [SPEC.md](SPEC.md). See also: [OTHER.md](OTHER.md), ...` — listing whichever other technical files actually exist in this bundle (mandatory ones always, plus `API-CONTRACTS.md`/`UI-CONTRACTS.md`/`TECHNICAL-DESIGN.md` only if present). This is what lets someone (or something) landed on any one file navigate to the rest.
5. **IDs are unique and cross-references resolve.** `FR-N`, `NFR-N`, `EC-N` are defined in `SPEC.md`; `SM-N` states (if any) are defined in `UI-CONTRACTS.md`; `TEST-SPEC.md` entries point back to them via a `**Reference**` field. A reference to an ID that doesn't exist anywhere is a dangling pointer — exactly the kind of drift that's easy to introduce when editing by hand and easy to catch mechanically. See each file's own reference for which ID prefixes it defines.
6. **No `&amp;` or other HTML-entity leakage.** Titles and headings use a literal `&`. This has crept in before via formatting tools that over-escape — treat any `&amp;` as a bug, not a style choice.

# Skills index — what's available to execute this plan

A plan is executed by an agent (often a fresh context — `yor`, or whoever picks up the slice file cold). That agent shouldn't have to rediscover what's invocable in this environment before it can use it. This skill's job is to build that index **once**, during planning, and stamp the relevant entries onto each slice — the same way seams and stack commands get discovered once and reused.

"Skills" here means whatever packaged, invocable capability the *current* environment offers on top of raw tool calls — a named skill/command a coding agent can trigger, distinct from the `FR`/`TC` domain vocabulary the rest of this plan uses. The concrete shape of that varies by environment; don't assume any one convention is the only one that exists.

## Where to look

This varies by environment — discover what's actually available here rather than assuming a fixed location or a single host tool:

1. **Whatever skill/command registry the current agent surfaces** — e.g. a listing of invocable skills already visible in context, a `/help`-style command list, or an MCP tool registry. If the environment tells you what's loaded, start there instead of walking directories by hand.
2. **On-disk skill directories, if this environment uses that convention** — read each skill's own manifest/frontmatter (its description or equivalent) for the trigger condition, written by whoever authored it. Check every level the environment defines (project-local, user-level, plugin/extension-provided) — don't stop at the first one found, and don't assume project-local is the only one that matters.
3. **Other invocable conventions the repo or environment already has** — custom slash/CLI commands, repo-specific scripts wired up as agent-invocable actions, MCP servers exposing tools. Treat these the same way: read their own description of when they apply, don't infer purpose from the name alone.

Don't grep the filesystem for a fixed list of names — each skill's own manifest already tells you when it triggers. Read that, don't guess from the name alone (short generic names can hide a precise, narrow job).

## Build the index once

Produce a flat table, once per plan, before drafting slices (this feeds step 4):

| Skill | Source | Triggers when |
| --- | --- | --- |
| `<name>` | Built-in / Project / User / Plugin / MCP | \<copied from its own description's trigger clause\> |

Keep it to skills that could plausibly apply to *this* plan — not the full roster of everything installed. A plan with no charts or dashboards in scope has no use for a charting skill; don't list one just because it exists.

## Tag slices, don't force-fit

When drafting each slice (step 4), check the index and fill its frontmatter's `uses_skills`:

- Most slices during RED→GREEN need **none** — the TDD loop itself (write test, run focused command, write code) doesn't route through a skill. Leave `uses_skills: []` rather than reaching for a skill that doesn't add anything.
- A skill belongs on a slice only when the slice's own work matches that skill's own trigger condition — e.g. a slice whose GREEN step is "confirm the UI renders live" names whatever skill launches/screenshots the app here; a slice building a chart names whatever charting skill is available. A skill already used upstream to draft an artifact (e.g. a bug report) doesn't need to be re-tagged onto the slice that implements it.
- The Final Verification Wave (step 9) commonly draws on a code-review-style skill, and — where the plan touches sensitive areas (auth, crypto, user input) — a security-review-style skill, if either is available here. Call this out in `00-overview.md`'s skills index rather than repeating it on every slice.

A slice with a skill tagged that doesn't fit is the same class of error as an untraceable acceptance criterion: it looks rigorous but adds noise the executor has to untangle. When in doubt, leave it `[]` — a missing skill tag costs nothing (the executor still has the loop); a wrong one costs a detour.

## Where this lives in the written plan

- `00-overview.md` gets a **Skills index** section — the table above, trimmed to what's relevant to this feature.
- Each slice file gets a `uses_skills` entry in its YAML frontmatter (see `slice-template.md`).

Re-index if the plan is revisited much later, or executed in a different environment than it was planned in (a skill may have been added, renamed, or simply not be available there) — don't trust a stale index carried over from a previous plan or a different host.

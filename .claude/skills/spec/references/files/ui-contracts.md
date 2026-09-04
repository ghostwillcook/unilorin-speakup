# UI-CONTRACTS.md — Section-by-Section Shape

**Optional** — only create this file if the feature has a Frontend/Mobile screen surface with meaningful state transitions (loading/error/empty/populated, or a multi-step flow). A backend-only feature never gets this file. Decided by the Job 1 interview in `SKILL.md`.

Before writing your first one, read `examples/onboarding-mobile/` (a small, validator-clean, mobile-only example bundle bundled with this skill for exactly this purpose) — especially its `UI-CONTRACTS.md` and `SPEC.md`. Match its shape rather than improvising the format from prose alone.

The file has two levels: one **Navigation Graph** covering the whole flow (screen-to-screen), then one H2 per screen or flow covering what happens *inside* that screen (state-to-state). Don't conflate the two — a screen's internal state machine shouldn't encode "and then it navigates to screen X," that belongs in the Navigation Graph.

### 1. Navigation Graph (whole-file, only when there are 2+ screens)

A mermaid `flowchart` (node per screen, edge per trigger, labeled with the trigger name). A graph reads screen-to-screen flow the way a human actually thinks about it — which a table can only approximate — so use `flowchart TD` with edge labels for the trigger, and put anything that doesn't fit on an edge label (a guard, a side note) as a short bullet list right below the diagram instead of cramming it into the label. Captures which screen leads to which and by what trigger — including exits to a screen outside this bundle (e.g. "Main App (outside this flow)") so the graph stays complete without requiring every destination to have its own H2. Skip this section entirely if the file only documents a single screen — there's no graph to draw with one node.

### 2+. One H2 per screen or flow (`2. Login Screen`, `3. Checkout Flow`, ...)

Each H2 has two tables:

- **State Machine Contract** — table `SM-ID | State | Event | Do | Next State`. This is what a screen or flow can be in and what moves it between those states — internal states only (loading/error/ready/etc.), not other screens. The `SM-ID` column defines that state's ID (bolded, e.g. `**SM-MOB-1**`) — a state has one transition per row, so its ID repeats on every row where it's the *From* state; `Next State` stays a plain state name (it's not a cross-file reference target, so it doesn't need its own ID column).
  - `Do` is what the screen *does* when that event fires and the transition is taken — a persistence write, an analytics event, a cache invalidation. It's an action to perform, not an incidental side effect, so name it as an imperative ("Persist X", "Track event Y"). Use `—` when a transition has nothing to do; don't leave the column blank, since an empty cell reads as "unspecified" rather than "confirmed none."
  - Async work doesn't belong in `Do` — model it as its own state instead (see the on-enter note below), so the state machine stays a synchronous, deterministic graph even though the underlying operation isn't.
  - If a state kicks off an async operation on entry (e.g. a network fetch), say so in a one-line bullet below the table: `- **Loading** (\`SM-MOB-1\`) enters via: fetch onboarding content bundle (async, no timeout specified).` Its outgoing transitions are the async result events (`Succeeded`/`Failed`/...) — that's how "wait for something async" gets represented without an `async` flag on an edge.
  - No `Guard` column — most transitions are unconditional, and a column that reads `None` on nearly every row is noise. The rare case where the *same* state+event pair branches on a condition (e.g. `NextTapped` from `Ready` only advancing when there's a next step) still needs to be said somewhere: call it out as a one-line bullet below the table the same way an async on-enter is — `- **Ready** (\`SM-MOB-2\`) → **Exited** via \`NextTapped\` only when \`hasNextStep\` is true; otherwise the event has no effect.` Don't silently drop the condition, just don't give it a dedicated column when it's usually empty.
- **Figma Screen State Map** — table `SM-ID | State | Figma Node URL | Notes`, using the same `SM-ID`s the state machine table just defined. Maps each state to the Figma node URL that represents it (e.g. `https://www.figma.com/design/<file-key>/<file-name>?node-id=<id>`), so design and implementation stay traceable to the same source of truth — a URL is clickable and unambiguous in a way a bare frame name or node ID isn't.
  - **Never invent a Figma Node URL.** A fabricated-but-plausible-looking URL is worse than an honest gap — it reads as verified when it isn't, and nobody will think to double-check it later. The URL is something only the human designer/PM knows, so treat this as an interview step: once you've listed the states for a screen, explicitly ask the user for the Figma node URL for each one (one state at a time or as a batch), the same way you'd interview them for any other spec detail — don't skip straight to guessing or leaving it blank. If a Figma MCP tool is connected (e.g. `get_design_context`/`get_metadata`), use it to resolve or confirm a link the user gives you, not as a substitute for asking.
  - Until a state's real reference is confirmed, write `TBD` in the Figma Node URL cell with a Notes entry like "Awaiting Figma link from design" — that's an honest placeholder, not a guess, and it's easy to grep for later. Don't let an unconfirmed row block the rest of the bundle from being created; come back and fill it in once the user (or the Figma lookup) provides it.

If a feature spans multiple screen surfaces (e.g. iOS and Web have different screens for the same flow), group H2s under platform-labeled sections the same way the other technical files do.

## IDs defined here

| Prefix | Meaning |
|---|---|
| `SM-<PLATFORM>-N` | A state in the state machine contract, scoped to a platform code |

`TEST-SPEC.md` entries can set `**Reference**` to a specific `SM-<PLATFORM>-N` to verify that state's behavior directly.

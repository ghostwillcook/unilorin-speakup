# Severity and confidence

## Severity tiers

Order the report by these, most-severe first:

- **Critical** — blocks merge: security vulnerability, data loss, broken functionality, contradicts an explicit spec requirement.
- **Important** — should be fixed before merge: real bug, architecture problem that will compound, missing test for a behavioral change.
- **Medium** — valid but lower-impact: a nitpick with a real (if small) consequence, a readability issue that will slow future readers.
- **Minor** — optional: style preference, a "consider" alternative, an FYI observation.

## Confidence bands

Score each finding 0.0–1.0 before deciding whether to report it:

- **≥0.70** — report.
- **0.60–0.69** — report only if actionable (a concrete fix exists, not just "this feels off").
- **<0.60** — suppress, *except* a Critical-severity security finding, which reports down to 0.50 — better a false alarm on security than a missed one.

This score is a decision tool, not a display field — use it to decide whether a finding clears the bar to report at all, don't print "Confidence: 0.7" in the output. Where a reported finding is genuinely borderline, say so in plain language instead ("worth confirming", "likely fine but flagging").

A finding's evidence lives in the finding entry itself (`file:line` + quoted code), not scattered in surrounding prose. Never fabricate a file:line reference — if you can't point to the exact line, the finding isn't ready to report.

## Comment labels

When posting findings as PR comments, prefix by required action:

| Prefix | Meaning |
|---|---|
| *(none)* | Blocking — Critical/Important, must address before merge |
| **Nit:** | Optional style, author may ignore |
| **Consider:** | Non-blocking suggestion |
| **FYI:** | Informational only |

Keep one finding per comment so resolving one doesn't silently drop another.

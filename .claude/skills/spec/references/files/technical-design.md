# TECHNICAL-DESIGN.md — Section-by-Section Shape

**Optional** — only create this file if the feature's backend genuinely orchestrates a call sequence across multiple external or internal services (a payment gateway, a notification service, another internal microservice, ...). A single-endpoint feature with no real orchestration doesn't need one even if it has `API-CONTRACTS.md`; a frontend/mobile-only feature with no backend never gets this file at all. Decided by the Job 1 interview in `SKILL.md`.

This file answers a different question than `API-CONTRACTS.md`. `API-CONTRACTS.md` documents one endpoint's own request/response shape in isolation; `TECHNICAL-DESIGN.md` shows *when* those calls happen relative to everything else this feature talks to and in what order — the cross-system view, not the per-endpoint one. Don't re-describe a request/response schema here; reference the endpoint by name/section and let `API-CONTRACTS.md` own its shape.

One H2 per flow or interaction (`1. Payment Capture Flow`, `2. Order Confirmation Flow`, ...). Each H2 has a mermaid `sequenceDiagram` — participants are this feature's backend plus every external/internal service it calls in this flow, messages are the calls/responses in order, roughly top-to-bottom as they'd actually happen. Anything that doesn't fit cleanly on an arrow label (a retry policy, a timeout, an error branch's handling) goes as a short bullet list right below the diagram, the same pattern `UI-CONTRACTS.md`'s Navigation Graph uses for its own overflow.

```
## 1. Payment Capture Flow

​```mermaid
sequenceDiagram
    participant Backend
    participant Stripe
    participant Notifications

    Backend->>Stripe: Create PaymentIntent
    Stripe-->>Backend: PaymentIntent (requires_confirmation)
    Backend->>Stripe: Confirm PaymentIntent
    Stripe-->>Backend: PaymentIntent (succeeded)
    Backend->>Notifications: Publish order.confirmed
​```

- If Stripe returns `requires_action` (3D Secure), the flow pauses for client confirmation before the Confirm step — see FR-4.
- `Notifications` publish is fire-and-forget; a failure here doesn't roll back the payment (see External Dependencies).
```

No IDs are defined in this file — flows are referenced by name/section, not by ID, the same way `API-CONTRACTS.md`'s endpoints are. If a step needs to trace back to a requirement, name the `FR-N`/`EC-N` in the flow's own bullet notes rather than inventing a new ID scheme for it.

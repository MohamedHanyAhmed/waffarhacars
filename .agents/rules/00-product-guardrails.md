# WaffarhaCars product guardrails

Configure this rule as **Always On** in Antigravity's Rules panel.

Read `README.md`, `docs/03-prd.md`, `docs/05-domain-and-architecture.md`, and the current issue before planning or editing.

- Implement only the current vertical slice and its acceptance criteria.
- Do not copy Waffarha or competitor code, assets, copy, logos, palette, or distinctive visual expression.
- Treat WaffarhaCars as a working name; do not create public-release branding claims.
- MVP is reservation-first and pay-at-center. Fixed-scope services use a single-use discount pass; unknown general repair uses diagnosis/quote/explicit authorization.
- Sales users enter provider, branch, service, compatibility and offer drafts; only operations can approve/publish them.
- Completion requires authenticated provider action plus customer PIN. Commission is calculated from the contract's versioned basis and frozen onto the reservation. Never infer it from current provider data or staff-entered payment.
- The consumer subscription model is out of MVP. Do not add a customer paywall or membership without an approved later decision.
- Never add customer prepayment, payment gateway, wallet, BNPL, native app, dynamic bidding, fleet platform, or another deferred feature without an approved ADR.
- Never invent product, legal, pricing, tax, provider, or vehicle assumptions silently. Record an open question and escalate material ambiguity.
- Customer price, scope, terms, provider, branch and commission are snapshotted at reservation creation.
- No extra work may mutate the original reservation or proceed as “authorized” without explicit customer approval.

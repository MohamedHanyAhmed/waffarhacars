# Antigravity prompt — WaffarhaCars clickable demo

Copy everything inside the code block into Antigravity after placing this product pack in the repository root.

```text
Act as the implementation engineer for the WaffarhaCars clickable product demo. Human product and engineering reviewers will inspect the repository, architecture, tests and final experience, so optimize for coherence, restraint and reviewability rather than generating a large amount of code.

CONTEXT

WaffarhaCars is an Egypt-first automotive-services discount marketplace launching through selected Cairo clusters. Customers do not prepay WaffarhaCars in the MVP model. They reserve a discounted service for free, receive a discount pass, visit the center, pay the locked discounted price directly to the center, and confirm completion using a short-lived PIN after provider staff scans/checks in the reservation. A mutually confirmed completion creates a commission receivable owed by the provider to WaffarhaCars. Sales staff enter provider and offer data; operations staff independently approve it.

The current name is a working name only. Do not copy Waffarha's logo, orange palette, copy, assets, code, screen composition or distinctive visual expression. Create an original, credible automotive identity.

FIRST: READ BEFORE CODING

Read these repository files completely:

- README.md
- CONTRIBUTING.md
- every Markdown file in .agents/rules/
- docs/01-product-strategy.md
- docs/03-prd.md
- docs/04-ux-information-architecture.md
- docs/05-domain-and-architecture.md
- docs/08-quality-security-observability.md
- docs/11-transaction-redemption-sop.md
- docs/12-demo-slice.md

If this prompt conflicts with those files, stop and report the conflict. Do not silently choose one.

TASK

Build only a polished, responsive, bilingual clickable showcase—not a production application. It must demonstrate one coherent reservation moving through customer, provider, sales and operations views using deterministic synthetic local fixtures.

Before writing code, return a concise implementation plan containing:

1. route map;
2. component and design-token inventory;
3. typed demo-domain and fixture schema;
4. reservation/completion state transitions;
5. Arabic RTL and responsive strategy;
6. automated test plan;
7. files you intend to create/change;
8. assumptions or conflicts requiring human approval.

STOP after presenting the plan. Do not create, edit or delete implementation files until the product manager returns an explicit `PLAN APPROVED` instruction. Reading the repository and reporting the plan are the only actions authorized in this first turn.

TECHNICAL SHAPE

- Use Next.js App Router, TypeScript and Tailwind CSS unless the existing repository already establishes an equivalent approved stack.
- Keep one deployable web application with route-level customer, provider and internal demo areas.
- Isolate deterministic synthetic data behind typed repository/service interfaces so fixtures can later be replaced by APIs.
- Use browser session/local state only where needed to preserve the single demo reservation across views.
- Use strict TypeScript and avoid `any` unless justified in a code comment.
- Do not add a production database, ORM, payment gateway, authentication provider, SMS provider, maps API, analytics SDK, cloud infrastructure or unnecessary state-management library.
- Prefer semantic HTML, accessible primitives and small reusable components.
- Keep dependencies minimal and explain every added dependency in the final handoff.

DEMO DATA

All visible entities must be clearly synthetic:

- Customer: Demo Customer
- Vehicle: Nissan Sunny, 2021
- Area: Nasr City
- Service: express oil and filter change
- Provider: Orbit Auto Care — Heliopolis (Demo provider)
- Normal price: EGP 1,200
- Provider-funded discount: 20% / EGP 240
- Locked price paid at center: EGP 960
- WaffarhaCars commission after valid completion: 10% / EGP 96
- Provider amount before its costs/taxes: EGP 864

Never use real provider names, logos, ratings, addresses, reviews or prices. Display a persistent banner on every route: “Interactive demo — no real bookings or payments.”

REQUIRED ROUTES/SCREENS

1. Customer home
   - Vehicle and Cairo area selection.
   - Service categories: maintenance, repairs/diagnostics, wash/detailing, tyres, batteries, AC and accessories.
   - Clear explanation: reserve free, pay center, confirm completion.

2. Compatible results
   - Cards display exact scope, vehicle fit, synthetic provider, branch area/distance, next availability, normal price, locked price and exact saving.
   - Include an incompatible-offer scenario that cannot be reserved.

3. Offer detail
   - Show “Fits your Nissan Sunny 2021.”
   - Show EGP 1,200, EGP 960 and “Save EGP 240.”
   - Include scope, parts/specification, labor, duration, exclusions, compatibility, branch, appointment, provisional warranty/remedy wording and additional-work rule.
   - Primary CTA: “Reserve free — pay EGP 960 at center.”

4. Reservation confirmation
   - Confirm vehicle, branch and date/time.
   - Show “Due now: EGP 0” and “Pay center: EGP 960.”
   - Confirming creates the synthetic reservation without network transmission.

5. My Reservation / discount pass
   - Status, appointment, vehicle, service, provider, branch and price due at center.
   - Non-functional QR-style visual plus fallback demo code.
   - Reschedule/cancel interactions and explanation of completion PIN.

6. Provider check-in
   - Visually distinct provider view.
   - Scan simulator or demo-code entry.
   - Show locked vehicle, scope and EGP 960 price; staff cannot edit them.
   - Check-in updates the shared demo reservation.

7. Provider completion
   - “Complete service” requests a short-lived demo customer PIN.
   - Entering the correct PIN atomically marks the reservation completed and creates exactly one EGP 96 commission accrual.
   - Repeating completion must show “Already completed” and must not add another commission.

8. Customer completion/review
   - Show completed status, service, branch, locked price and timestamp.
   - Ask whether price and scope were honored.
   - Show verified review and report-problem interactions.

9. Sales provider-entry wizard
   - Provider and branch.
   - Controlled service category/template.
   - Compatible cars or explicit all-cars rule.
   - Normal-price evidence.
   - Discount and calculated locked price.
   - Commission schedule.
   - Scope, exclusions and capacity.
   - Submit for operations approval.
   - Demonstrate that missing price evidence blocks submission.
   - Sales cannot publish directly.

10. Operations approval and commission view
    - Review and approve the sales-entered synthetic offer.
    - Show the one completed reservation and one EGP 96 commission accrual.
    - Show provider running statement, invoice status and credit exposure.
    - Duplicate completion must leave totals unchanged.

DESIGN REQUIREMENTS

- Original premium-but-practical automotive visual identity; do not imitate Waffarha.
- Mobile-first and deliberately responsive at approximately 390 px and 1440 px.
- Arabic and English toggle. Customer screens must work fully in RTL/LTR; demonstrate internal RTL as well.
- Use logical start/end spacing and handle mixed Arabic/Latin vehicle names, codes, numbers and EGP safely.
- Meet WCAG 2.2 AA intent: visible focus, semantic labels, keyboard access, sufficient contrast, non-color status communication and useful errors.
- Build complete loading, empty, incompatible, cancelled, no-show, wrong-PIN and already-completed states accessible from a small “Demo scenarios” control.
- Use clear automotive information hierarchy. Avoid excessive gradients, glassmorphism, animation, fake urgency, unsupported guarantees and decorative dashboard clutter.
- Use restrained motion only when it explains a state change; respect reduced-motion preference.

DOMAIN RULES THAT MUST NOT BE VIOLATED

- Sales enters drafts; operations approves/publishes.
- The customer pays the center, not WaffarhaCars.
- Price, scope, vehicle, provider, branch, terms and commission are snapshotted at reservation creation.
- Provider check-in does not create commission.
- Provider completion plus customer PIN creates exactly one commission accrual.
- Client-entered values never become authoritative price or commission values.
- Additional work cannot mutate the original reservation; it requires a separate quote and customer approval.
- Only a completed reservation can create a verified review.
- No personal data is encoded in the QR visual.
- Do not promise a refund that WaffarhaCars cannot execute because the center collected payment.

AUTOMATED ACCEPTANCE TESTS

At minimum, implement tests proving:

1. customer golden path from home to confirmed reservation;
2. the locked EGP 960 price and service scope remain identical in customer/provider/internal views;
3. incompatible vehicle blocks reservation;
4. sales draft cannot publish without operations approval;
5. provider check-in does not create commission;
6. incorrect or expired completion PIN fails safely;
7. valid completion creates exactly one EGP 96 commission accrual;
8. concurrent/repeated completion cannot create another accrual;
9. only completed reservations can submit verified reviews;
10. Arabic RTL route renders and the critical path is keyboard accessible.

DELIVERY REQUIREMENTS

- Configure formatting, lint, strict typecheck, tests and production build scripts.
- Add a concise repository README section explaining how to install, run, test and build the demo.
- Add no secrets and no environment variables unless genuinely required for local tooling.
- Self-review the final diff for scope creep, duplicated state, hard-coded authoritative calculations, accessibility and RTL issues.
- Run every declared verification command.
- In the final response, report:
  - what was built;
  - route map;
  - exact commands and results;
  - screenshots or artifact links for mobile English, mobile Arabic RTL, provider completion and operations commission view;
  - dependencies added and why;
  - known limitations;
  - residual risks;
  - confirmation that no real booking, payment, message or provider data was used.

OUT OF SCOPE — DO NOT BUILD

- production backend or database;
- real authentication, OTP or SMS;
- payment gateway, deposit, wallet or customer prepayment;
- native mobile app;
- actual camera/QR permissions;
- maps API or live location;
- real provider integrations or scraped content;
- subscription, loyalty, B2B fleet portal or AI diagnosis;
- deployment credentials or production infrastructure;
- additional categories or flows beyond those needed for this single coherent showcase.

The demo succeeds when a first-time viewer can explain in under three minutes: “I reserve free, pay the center, the center scans my pass, I confirm completion, and the completed service creates WaffarhaCars' commission.” If that is unclear, simplify before adding anything.
```

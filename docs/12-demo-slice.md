# WaffarhaCars clickable demo slice

## Outcome

Create a polished, responsive, bilingual clickable prototype that makes the marketplace understandable in under three minutes. It must demonstrate one complete customer reservation, provider completion, sales data-entry, operations approval, and commission outcome using synthetic data.

This is a **showcase prototype**, not the MVP backend. It must never create a real reservation, transmit personal information, process money, contact a provider or imply that synthetic centers/reviews are real.

## Audiences

- Car owners: understand savings, vehicle fit, trust and pay-at-center.
- Service centers: understand incremental reservations and commission only after completion.
- Sales team: understand how provider/service/discount data is entered.
- Investors/partners: understand the two-sided transaction and monetization.
- Engineers: inspect coherent states and product boundaries before implementation.

## Three-minute demonstration story

Use visibly synthetic demo content:

- Customer: Demo Customer
- Vehicle: Nissan Sunny, 2021
- Area: Nasr City
- Need: express oil and filter change
- Provider: Orbit Auto Care — Heliopolis (**Demo provider**)
- Normal price: EGP 1,200
- Discount: 20%
- Locked pay-at-center price: EGP 960
- WaffarhaCars commission after completion: EGP 96
- Provider retained amount before its own costs/taxes: EGP 864

Do not use a real center's name, logo, reviews, address or pricing without permission.

## Required customer flow

### Screen 1 — Home

Purpose: answer “What does your car need?”

- WaffarhaCars working-name header with a clear demo badge.
- Arabic/English toggle.
- Selected area and saved vehicle controls.
- Service families: maintenance, repairs/diagnostics, wash/detailing, tyres, batteries, AC and accessories.
- “How it works”: reserve free, pay center, confirm and save.
- Trust statement without unsupported guarantees.

Primary interaction: select `Maintenance`.

### Screen 2 — Compatible results

- Vehicle and area remain visible.
- Cards show service scope, provider, area/distance, next availability, verified-review demo label, normal price, locked price and exact saving.
- Filters for area, date, service subtype and vehicle compatibility.
- Sponsored content, if displayed, is clearly labeled and cannot outrank incompatibility.

Primary interaction: open the synthetic oil-change offer.

### Screen 3 — Offer detail

Above the fold:

- service/provider and demo label;
- `Fits your Nissan Sunny 2021`;
- EGP 1,200 struck through, EGP 960 locked price, `Save EGP 240`;
- branch, next slot and `Reserve free — pay EGP 960 at center` CTA.

Structured details:

- what is included;
- parts/specification and labor;
- compatible vehicles;
- expected duration;
- branch and hours;
- exclusions;
- warranty/remedy wording marked provisional where not legally approved;
- additional-work rule;
- cancellation/no-show policy.

Primary interaction: reserve.

### Screen 4 — Reservation

- Confirm vehicle, branch, date/time and mobile number placeholder.
- Show price summary with `Due now: EGP 0` and `Pay center: EGP 960`.
- Explicitly state that WaffarhaCars does not collect payment in the MVP model.
- Terms checkbox uses synthetic/demo language.

Primary interaction: `Confirm reservation` using local demo state only.

### Screen 5 — Confirmation and discount pass

- Reservation ID marked demo.
- Status `Confirmed`.
- Date/time, service, vehicle, provider, branch and EGP 960 due at center.
- QR-style visual and fallback code that cannot resolve outside the prototype.
- Reschedule, cancel, directions and support affordances.
- Reminder that completion requires a customer PIN after service.

Primary interaction: switch to provider view while retaining the same demo reservation.

## Required provider flow

### Screen 6 — Provider check-in

- Provider staff view is visually distinct and clearly labeled.
- Scan simulator or enter the demo pass code.
- Display locked scope, vehicle, appointment, branch and EGP 960 customer price.
- Staff cannot edit price or service scope.
- `Check in` transitions local demo state from confirmed to checked in.

Primary interaction: check in, then move to completion.

### Screen 7 — Completion

- Staff taps `Complete service` after the simulated direct customer payment.
- Customer side reveals a short-lived demo completion PIN.
- Provider enters PIN.
- Show success with EGP 96 commission accrued and one immutable completion timestamp.
- Repeating completion must show `Already completed` and must not create another commission.

Primary interaction: return to customer completion screen.

### Screen 8 — Customer confirmation/review

- Status `Completed` with service, branch, price and timestamp.
- Ask whether price and included scope were honored.
- Show verified-review form and support/report problem path.
- Do not claim WaffarhaCars issued the center's receipt.

## Required internal flow

### Screen 9 — Sales provider entry

Show a compact provider wizard:

1. provider and branch;
2. service category/template;
3. compatible cars or explicit all-cars rule;
4. normal price evidence;
5. discount and calculated locked price;
6. commission schedule;
7. scope, exclusions, appointment/capacity;
8. submit for operations approval.

Sales cannot publish directly. Include an intentional validation failure for missing price evidence.

### Screen 10 — Operations approval and commission

- Review provider/offer changes with before/after and evidence.
- Approve synthetic offer.
- Show the completed reservation creating exactly one EGP 96 commission accrual.
- Show provider running statement, invoice status and credit exposure.
- A duplicate completion attempt must not change totals.

## Global interaction and design requirements

- Responsive at approximately 390 px mobile and 1440 px desktop.
- Arabic RTL and English LTR toggle on every customer screen; provider/internal screens at least demonstrate both directions on one representative screen.
- Clean automotive identity distinct from Waffarha; no copied logo, palette, copy, illustrations or layout.
- Use one restrained accent color, neutral surfaces, strong typography and real-world automotive information hierarchy.
- Visible focus, keyboard path, sufficient contrast, semantic labels and non-color status indicators.
- Loading, empty, incompatible vehicle, cancelled, no-show and already-completed states are reachable from a small `Demo scenarios` menu.
- Synthetic data is declared in a persistent `Interactive demo — no real bookings or payments` banner.
- No analytics, cookies, network forms, authentication provider, payment integration or production database is required.
- Demo state may use deterministic fixtures and browser session/local state. Never hard-code demo secrets into future production modules.

## Technical shape for Antigravity

Use the intended frontend stack and design tokens, but isolate fixtures behind a typed repository interface so the UI can later connect to real APIs. Suggested structure:

```text
apps/web/
  customer/
  provider/
  internal/
packages/
  ui/
  domain-types/
  demo-fixtures/
```

The prototype must not create premature production abstractions. One deployable web experience with route-level audience separation is sufficient.

## Acceptance criteria

1. A new viewer can explain the model—reserve free, pay center, provider scan, customer PIN, provider owes commission—after a three-minute walkthrough.
2. The customer golden path works end to end without dead controls.
3. Provider completion changes the same reservation shown on the customer side.
4. Exactly one EGP 96 commission accrual appears; duplicate completion does not change it.
5. Sales cannot publish its own draft; operations approval is visibly separate.
6. Locked price, scope and vehicle remain consistent across every screen.
7. Arabic RTL and English LTR render without clipping or broken direction.
8. Mobile and desktop layouts are usable and visually deliberate.
9. Synthetic/demo status is visible on every route.
10. Automated smoke tests cover the golden path, duplicate completion and incompatible vehicle.

## What not to build

- real customer/provider accounts;
- real OTP/SMS;
- payment gateway or customer prepayment;
- actual QR camera permissions;
- maps API;
- production database or cloud infrastructure;
- native apps;
- wallet, loyalty, subscription or B2B portal;
- real provider scraping/content;
- every category or Cairo neighborhood.

## Antigravity assignment prompt

```text
Build only the high-fidelity clickable showcase defined in docs/12-demo-slice.md. Before coding, read README.md, CONTRIBUTING.md, .agents/rules, docs/03-prd.md, docs/04-ux-information-architecture.md, docs/05-domain-and-architecture.md, and docs/11-transaction-redemption-sop.md.

First return a short implementation plan, route map, component inventory, fixture schema, visual direction and test plan, then stop and wait for explicit `PLAN APPROVED`. Do not implement real authentication, payments, messaging, maps, database or external provider data. Use deterministic synthetic fixtures and a persistent banner stating that no real bookings or payments occur. Preserve one reservation state across customer, provider and internal demo views. Demonstrate Arabic RTL, English LTR, mobile/desktop, duplicate-completion protection and operations approval separation. Stop if any requirement would require copying Waffarha or another company's brand expression.
```

## Review script

The presenter should say:

1. “Customers browse offers that fit their car and area.”
2. “They reserve for free and see exactly what they will pay at the center.”
3. “The provider checks them in but cannot change the locked offer.”
4. “After service, customer confirmation proves completion.”
5. “Completion creates our commission and a verified service history.”
6. “Sales enters supply; operations controls quality and publication.”

If the demo takes longer than three minutes or needs verbal explanations to hide unclear screens, simplify it before adding features.

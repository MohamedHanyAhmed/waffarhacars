# Product requirements document

## Objective

Validate that car owners in initial Cairo clusters will reserve a clearly scoped discount, pay the center, and mutually confirm service completion, while providers receive profitable incremental demand and WaffarhaCars can accurately invoice and collect commission.

## Release actors

- Guest car owner
- Registered car owner
- Provider manager
- Provider staff/redeemer
- Operations/support agent
- Finance operator
- Administrator

## Primary journeys

### J1 — Discover and reserve a fixed-scope service

1. Customer selects service need or enters search.
2. Customer selects/saves vehicle and area; exact address is not required for discovery.
3. Results show compatible offers ranked by relevance, availability, distance, rating confidence, price and sponsorship disclosure.
4. Offer detail shows exact included work, parts/specification, compatible vehicles, branch, validity, appointment requirement, duration, warranty, exclusions, original/deal price and savings.
5. Customer selects vehicle, branch and slot, authenticates by verified mobile number, and accepts the offer terms.
6. Server creates a confirmed reservation and single-use discount pass showing the locked price to pay at the center.
7. Customer and provider receive confirmation and reminders.

### J2 — Redeem

1. Authenticated provider staff opens the redemption surface for the correct branch.
2. Staff scans QR or enters short code.
3. System shows service, vehicle, validity, booking and masked customer identity.
4. Staff checks the customer in and sees the locked scope/price.
5. After service and direct center payment, customer provides a short-lived completion PIN.
6. Reservation changes state atomically to completed and creates one commission accrual; duplicate attempts show the original event.
7. Customer receives confirmation and can review or contact support.

### J3 — Cancellation/support

1. Customer cancels/reschedules an eligible reservation under its policy snapshot.
2. Provider cancellation/refusal or price mismatch creates a support case and quality strike.
3. Because WaffarhaCars did not collect customer payment, any post-service monetary remedy is normally performed by the center under legally reviewed terms.
4. Completion/commission disputes preserve events and use auditable reversal/adjustment entries.

### J4 — Provider onboarding

1. Sales creates a lead and captures legal entity, tax/commercial records, owner/manager contacts, branches and service capability.
2. Operations verifies documents, insurance/warranty policies where applicable, technicians/equipment, pricing and customer experience.
3. An offer is created from a service template and must pass scope, margin, evidence, expiry, capacity and legal review.
4. Provider staff receives role-scoped access and completes a test redemption.
5. Provider is activated only after contract, billing details, credit limit and escalation contacts are present.

## Functional requirements

### Identity and vehicle garage

- `FR-ID-01` Sign in with mobile OTP; rate-limit sends and checks; never log OTP values.
- `FR-ID-02` Customer can browse before authentication.
- `FR-ID-03` Customer can store multiple vehicles: make, model, year, optional trim/engine, nickname.
- `FR-ID-04` Deletion/anonymization request enters an auditable privacy workflow subject to retention obligations.
- `FR-ID-05` Staff authentication requires MFA; roles are deny-by-default.

### Catalogue and discovery

- `FR-CAT-01` Taxonomy separates fixed service, diagnostic service, accessory SKU and later quote request.
- `FR-CAT-02` Offer variants carry compatibility rules, not free-text compatibility only.
- `FR-CAT-03` Search and filters support service, area/radius, vehicle compatibility, available date, price and provider signals.
- `FR-CAT-04` Ranking exposes sponsored status and never ranks an incompatible/expired/inactive offer.
- `FR-CAT-05` Offer terms are versioned and snapshotted onto reservation.
- `FR-CAT-06` Inventory/capacity can be limited by offer, branch and date.

### Reservation, discount pass and commission

- `FR-RES-01` Server creates a reservation with immutable price, scope, terms and commission snapshots; clients never submit authoritative amounts.
- `FR-RES-02` Customer does not pay WaffarhaCars in MVP; UI repeatedly and clearly states the locked amount is paid at the center.
- `FR-RES-03` One discount pass is issued per confirmed reservation using an opaque QR token plus rate-limited human fallback code.
- `FR-RES-04` Provider check-in records staff, branch, time, prior state and session evidence without creating commission.
- `FR-RES-05` Completion requires authorized provider staff plus a short-lived customer PIN and is an atomic compare-and-set.
- `FR-RES-06` Exactly one completed reservation creates exactly one commission accrual using the snapshotted rate/basis.
- `FR-RES-07` Commission accrual, statement, invoice, payment, dispute and adjustment remain separate states.
- `FR-RES-08` Overdue/credit-limit policy can pause new reservations without deleting existing customer commitments.

### Booking and service execution

- `FR-BKG-01` Offers declare appointment required/optional/not supported.
- `FR-BKG-02` Reservation stores branch, slot, vehicle, discount pass and status; capacity is enforced transactionally.
- `FR-BKG-03` Reschedule/cancel cut-offs are policy-driven and snapshotted.
- `FR-BKG-04` Additional work requires a separate written amount, scope, evidence and explicit customer authorization; it does not mutate the reserved price/scope.

### Provider and operations

- `FR-OPS-01` Provider lifecycle: lead, due-diligence, contracted, training, active, paused, rejected, terminated.
- `FR-OPS-01A` Sales users can create and edit draft providers, branches, service mappings, vehicle restrictions, normal prices, discounts, offer variants, media and contacts for their assigned accounts.
- `FR-OPS-01B` Sales users cannot publish offers, approve compliance, change verified billing details, complete reservations, record commission payments, adjust invoices or modify accrual history.
- `FR-OPS-01C` Operations must approve provider identity/branch readiness and each offer version before publication; changing price, discount, scope, compatibility, validity or branch after approval creates a new pending version.
- `FR-OPS-02` Every privileged action includes actor, reason, before/after, correlation ID and timestamp.
- `FR-OPS-03` Maker-checker approval is required for manual completion, commission reversal/adjustment, billing-account change and write-off.
- `FR-OPS-04` Support sees a unified reservation timeline without accessing secrets or unnecessary personal data.
- `FR-OPS-05` Exports are permissioned, minimized, watermarked/logged where feasible, and protected from spreadsheet formula injection.
- `FR-OPS-06` Commission schedules are provider/contract versioned with basis, rate, effective conditions, caps and tax treatment; reservation snapshots preserve the applied schedule.

### Reviews and notifications

- `FR-REV-01` Only a completed reservation can create a verified review; one review per reservation, with moderation audit.
- `FR-NOT-01` Transactional SMS/email/push is template-based, localized and retries idempotently.
- `FR-NOT-02` Marketing consent is separate, optional, recorded, and revocable.

## Acceptance scenarios

```gherkin
Scenario: two staff members complete the same reservation concurrently
  Given a valid checked-in reservation and customer completion PIN
  When two authenticated branch staff submit completion simultaneously
  Then exactly one request succeeds
  And exactly one commission accrual is created
  And the other receives an already-completed response with the original timestamp

Scenario: incompatible vehicle
  Given an offer restricted to a defined set of vehicle attributes
  When a customer selects an incompatible vehicle
  Then the offer cannot be reserved
  And the UI explains which compatibility condition failed

Scenario: provider proposes extra work
  Given a customer has a fixed-scope reservation
  When the provider discovers additional work
  Then the original reserved price and scope remain unchanged
  And work cannot be recorded as authorized without customer approval of a separate quote

Scenario: provider does not honor the locked price
  Given a confirmed reservation for EGP 800
  When the provider requests a different amount for the included scope
  Then the customer can decline completion and open a priority support case
  And no commission accrual is created without valid completion
```

## Non-functional requirements

- WCAG 2.2 AA for web surfaces; keyboard navigation and screen-reader labels on all critical paths.
- Full Arabic RTL and English LTR testing at every release; no concatenated translated strings.
- p95 server response under 500 ms for cached catalogue reads and under 1 s for normal authenticated commands.
- Customer transaction availability SLO: 99.9% monthly after launch; no invented “five nines.”
- Recovery objectives and backup restoration are tested before commission billing begins.
- Structured logs contain correlation IDs and no secrets, OTPs, full pass tokens, or unnecessary personal data.

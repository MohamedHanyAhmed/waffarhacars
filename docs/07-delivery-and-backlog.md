# Delivery and backlog

## Operating model

Use shaped, time-boxed bets rather than an undifferentiated backlog. Basecamp's Shape Up describes appetite-based shaping, six-week cycles and a circuit breaker for work that cannot ship inside its bet.^1 This plan adapts that discipline to AI-assisted engineering: smaller reviewable vertical slices inside each bet, with human acceptance at the end of every PR.

## Gate 0 — two-week evidence sprint, before product code

Deliverables:

- 15 car-owner interviews and 20 provider interviews;
- zone density map and shortlist;
- five service templates with price/scope evidence;
- manual provider vetting checklist;
- clickable Arabic-first customer prototype and redemption prototype;
- provider-billing, legal/accounting and name-clearance consultations;
- spreadsheet unit economics for 30 representative completed reservations;
- concierge test with at least 10 real service fulfilments if legally/operationally permitted.

Go only if customers understand the proposition, providers can state profitable terms, at least 10 branches can be activated in one zone, and the transaction/remedy model passes legal/accounting review.

## Bet 1 — transactional spine, six-week appetite

Outcome: one customer can reserve, attend, pay a center, mutually confirm completion, and create a provider commission accrual for one configured service end to end in staging and controlled production.

### Slice 1: foundations

- repository rules, architecture tests, environments, CI, secrets, logging;
- identity/OTP abstraction, roles and audit;
- provider, branch, service template and offer admin skeleton;
- money/time/localization primitives.

### Slice 2: discover

- customer PWA shell, bilingual/RTL system;
- vehicle garage and compatibility;
- service home, results and offer detail;
- analytics event contract.

### Slice 3: reserve

- reservation price/scope/commission snapshot and state machine;
- discount-pass issuance and transactional notifications;
- cancellation, reschedule, reminders and no-show handling;
- capacity and reservation reconciliation view.

### Slice 4: check in and complete

- provider staff app, QR/human code and check-in;
- customer completion PIN and atomic completion;
- exactly-once commission accrual;
- My Reservations timeline and completion confirmation.

### Slice 5: provider billing, support and hardening

- support case and completion-dispute timeline;
- commission statements, invoices, payment allocation, credit limits and aging;
- accessibility, localization, security and failure-injection tests;
- production runbook, dashboards, alerts and rollback.

## Bet 2 — marketplace trust and repeat, only after Bet 1 data

- verified reviews;
- provider quality dashboard and pause automation;
- additional fixed service families;
- reminders based on explicit service history/vehicle data;
- controlled promos without wallet;
- improved ranking from measured fulfilment quality;
- B2B employee-benefit pilot.

## Later bets

- diagnostic quote authorization workflow;
- native app where retention evidence justifies it;
- fleet accounts and credit invoicing;
- membership/subscription;
- wallet/loyalty only after regulatory/accounting design;
- multi-zone then multi-city expansion.

## Prioritized MVP backlog

| ID    | Capability                                   | Priority | Dependency             | Acceptance evidence                                      |
| ----- | -------------------------------------------- | -------: | ---------------------- | -------------------------------------------------------- |
| P0-01 | Provider/branch/service/offer administration |       P0 | identity/RBAC          | API tests + admin video + audit events                   |
| P0-02 | Vehicle garage and compatibility             |       P0 | canonical taxonomy     | unit/property tests + Arabic/English UI                  |
| P0-03 | Offer discovery/detail                       |       P0 | active offers          | accessibility + relevance cases                          |
| P0-04 | Reservation price/terms/commission snapshot  |       P0 | catalogue              | invariant tests; client tampering rejected               |
| P0-05 | Reservation/capacity/cancellation            |       P0 | snapshot               | oversubscription concurrency test                        |
| P0-06 | Discount pass and My Reservations            |       P0 | reservation            | one pass per reservation invariant                       |
| P0-07 | Provider check-in and completion             |       P0 | staff/branch + pass    | concurrent completion test                               |
| P0-08 | Customer completion PIN                      |       P0 | completion             | expiry/replay/rate-limit tests                           |
| P0-09 | Support/dispute timeline                     |       P0 | reservation/completion | price-refusal and manual-override cases                  |
| P0-10 | Commission billing and collection            |       P0 | completion             | exactly-once accrual + invoice/allocation reconciliation |
| P0-11 | Notifications                                |       P0 | state outbox           | retry/dedupe/localization tests                          |
| P0-12 | Audit/security/observability                 |       P0 | cross-cutting          | threat checklist, dashboards, restore drill              |
| P1-01 | Verified reviews                             |       P1 | completion             | only completed reservations review                       |
| P1-02 | B2B eligibility/campaign                     |       P1 | stable B2C             | pilot acceptance report                                  |

## Issue readiness checklist

An implementation issue is ready only when it contains:

- problem/outcome and actor;
- in-scope and out-of-scope;
- numbered acceptance criteria;
- relevant domain states/invariants;
- UX link or breadboard;
- analytics events;
- permission/privacy/security notes;
- migration and rollback considerations;
- test examples and dependencies;
- owner and reviewer.

## Release gates

- **Design:** Arabic and English journeys reviewed; failure/empty/loading states included.
- **Product:** all P0 acceptance scenarios pass; no unlabeled scope substitutions.
- **Engineering:** CI green; migrations reversible/forward-safe; no critical/high security finding; dependency licenses reviewed.
- **Operations:** ten activated locations, training/test completion, support/dispute rota, commission invoice and collection rehearsal.
- **Finance/legal:** provider commission contract, center/customer payment responsibility, tax document ownership, cancellation/remedy policy, privacy notices/consent, brand clearance.
- **Reliability:** SMS failure, duplicate completion, PIN replay, concurrency, invoice reconciliation, restore and rollback drills pass.

## Source note

1. Basecamp, “Shape Up,” including “Set Boundaries” and “The Betting Table.” Full links in [SOURCES.md](../SOURCES.md).

# Quality, security and observability

## Definition of done

A change is done only when:

- acceptance criteria are linked to automated tests or documented manual evidence;
- happy, empty, loading, unauthorized, validation, timeout and retry states are handled;
- Arabic RTL and English LTR are checked;
- keyboard/screen-reader path is checked for critical UI;
- authorization is tested negatively;
- logs/metrics/traces and analytics are included where the behavior needs observation;
- data migration, rollback and feature-flag behavior are documented;
- threat/abuse cases are addressed;
- OpenAPI and domain docs change with behavior;
- no new critical/high dependency or application vulnerability exists;
- a human reviewer who did not author the change approves it.

## Security baseline

Use OWASP ASVS 5.0 as the verification catalogue and the OWASP API Security Top 10 as an API threat prompt—not as a checkbox replacement for threat modeling.^1 ^2 Target ASVS Level 2 for customer/business functionality, with stronger controls for completion, commission billing, staff administration and sensitive documents.

### Mandatory controls

- server-side object/action authorization on every non-public resource;
- short-lived sessions, secure cookies/tokens, rotation and revocation;
- MFA for provider/admin staff; step-up for commission, invoice, collection and billing-account changes;
- OTP/send/check rate limits by phone, IP, device and risk signal;
- encryption in transit and managed encryption at rest;
- secrets manager; no secrets in repository, client bundles, screenshots or logs;
- replay/idempotency controls for completion PINs and any external callbacks;
- allowlisted file type/size, malware scanning and isolated document storage;
- dependency lockfiles, automated update review, SAST, secret scan and container/IaC scan;
- restrictive CSP, CSRF protection where cookie auth is used, output encoding and input validation;
- append-only audit trail for privileged and financial action;
- data minimization, retention schedule and deletion/legal-hold workflow;
- tested backups and restricted break-glass access.

## Threats specific to this marketplace

| Threat                                            | Control                                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Customer shares discount-pass screenshot          | intentional reveal, separate short-lived completion PIN, status check, single atomic completion |
| Staff guesses short codes                         | high entropy underlying token, rate limits, branch/staff auth, lockout/risk alert               |
| Provider falsely completes/no-shows reservations  | customer PIN/post-appointment confirmation, anomaly review, invoice dispute/hold                |
| Duplicate completion requests                     | unique completion/accrual constraints, state-transition guard, reconciliation                   |
| Admin changes provider billing/collection account | MFA, maker-checker, cooling period/alert, immutable audit                                       |
| Price/client tampering                            | server-side pricing and reservation snapshot                                                    |
| Cancellation plus completion race                 | serialized/atomic reservation transition and completion eligibility lock                        |
| Fake review                                       | only completed reservation can review; one per reservation                                      |
| Support agent data scraping                       | least privilege, masked data, query/export limits, access anomaly alerts                        |
| Spreadsheet formula injection                     | escape risky leading characters in CSV/XLSX exports                                             |

## Test pyramid and critical suites

- Unit/property tests: prices, discount, commission, compatibility, policy, state machines, ranking components.
- Database/integration: reservation/pass/completion/accrual constraints, transactions, outbox and invoice allocation.
- Contract: OpenAPI validation and notification/external collection adapters where used.
- Component/accessibility: customer/provider/admin UI in Arabic and English.
- End-to-end: reservation, cancellation/reschedule, check-in, completion PIN, commission invoice, payment allocation, support.
- Concurrency/failure injection: two completions, slot oversubscription, PIN replay, worker retry, DB/queue interruption.
- Security: authorization matrix, IDOR/BOLA attempts, rate limits, upload, session, CSRF/XSS/injection.
- Operational: backup restore, completion/accrual/invoice reconciliation, collection rehearsal, feature-flag rollback.

Do not chase a vanity coverage percentage. Require 100% branch/state coverage for reservation, completion and commission state machines, and risk-based thresholds elsewhere.

## Observability

### Business events

`service_searched`, `vehicle_selected`, `offer_viewed`, `reservation_started`, `reservation_confirmed`, `pass_viewed`, `reservation_reconfirmed`, `provider_checked_in`, `completion_pin_issued`, `service_completed`, `commission_accrued`, `commission_invoiced`, `commission_collected`, `support_case_opened`, `review_submitted`.

Each event has a schema, version, owner, trigger, dedupe key and privacy classification. Revenue metrics come from commission invoice/collection data, not client analytics.

### Technical indicators and initial SLOs

| Journey              | SLI                                               | Initial objective |
| -------------------- | ------------------------------------------------- | ----------------- |
| Browse               | valid offer responses / valid requests            | 99.9% monthly     |
| Reservation command  | successful non-user-error responses               | 99.9% monthly     |
| Pass issuance        | confirmed reservations with pass within 30 s      | 99.9%             |
| Completion           | valid completion commands finishing within 2 s    | 99.9%             |
| Commission integrity | completed reservations with exactly one accrual   | 100%              |
| Notifications        | transactional notifications accepted within 5 min | 99%               |

Google's SRE guidance treats availability, latency, performance and capacity as measurable reliability concerns and recommends explicit service-level objectives.^3 Tune these numbers after pilot traffic; alert on customer harm and error-budget burn, not every exception.

## Privacy and Egypt compliance workstream

Egypt's PDPC states that Law 151/2020 and Executive Regulations 816/2025 govern collection, processing, storage, use and transfer of electronic personal data.^4 The product therefore needs a documented data inventory, purposes/lawful basis, notices in Arabic/English, processor contracts, access/correction/deletion workflow, security/breach process, retention schedule and cross-border hosting/transfer analysis. Vehicle identifiers and service history can become sensitive in context; collect only what the journey needs.

Consumer terms, reservation validity, cancellation/no-show rules, responsibility for service quality, price display and advertising require Egyptian counsel review under Consumer Protection Law 181/2018 and its regulations/amendments.^5 The center collects the customer payment in MVP; WaffarhaCars must not imply it processed or can automatically refund that payment. ETA eInvoice/eReceipt documentation covers digital B2B/B2C invoice and receipt exchange; an accountant must define the center's customer document and WaffarhaCars' provider commission invoice.^6

This pack is product guidance, not legal or tax advice.

## Sources

1. OWASP, ASVS 5.0.0.
2. OWASP, API Security Top 10.
3. Google, Site Reliability Engineering resources.
4. Egyptian Personal Data Protection Center.
5. WIPO Lex, Egypt Consumer Protection Law 181/2018.
6. Egyptian Tax Authority eInvoice/eReceipt developer documentation.
   Full links are in [SOURCES.md](../SOURCES.md).

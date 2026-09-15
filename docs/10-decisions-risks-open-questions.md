# Decisions, risks and open questions

## Recorded decisions

| ID      | Decision                                                                                           | Reason                                                                                                                                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-001 | Egypt-first, Cairo launch through sequential supply clusters                                       | density and honest availability beat superficial citywide coverage                                                                                                                                          |
| ADR-002 | Reservation-first/pay-at-center with fixed-scope discount pass; diagnosis/quote for unknown repair | removes early prepayment barrier without pretending repairs are fixed-price                                                                                                                                 |
| ADR-003 | Mobile-first PWA before native apps                                                                | fastest validated cross-platform path; preserves native option                                                                                                                                              |
| ADR-004 | Modular monolith + workers + PostgreSQL                                                            | smallest reliable architecture for transactions and small team                                                                                                                                              |
| ADR-005 | No customer payment gateway in MVP                                                                 | center collects customer payment; faster launch and simpler refund operations                                                                                                                               |
| ADR-006 | No wallet, cashback or BNPL in MVP                                                                 | disproportionate regulatory, ledger, fraud and support cost                                                                                                                                                 |
| ADR-007 | Immutable snapshots and append-only commission/invoice history                                     | historical billing correctness                                                                                                                                                                              |
| ADR-008 | Human approval for every AI-authored PR                                                            | accountable review and inspectable quality                                                                                                                                                                  |
| ADR-009 | Working name accepted for public technical review only                                             | likely affiliation/confusion risk with Waffarha; owner authorized public technical review while commercial launch, consumer deployment, and final branding remain blocked pending legal/trademark clearance |
| ADR-010 | Cairo MVP coverage built through sequential clusters in months 1-2                                 | honest city launch without pretending uniform density                                                                                                                                                       |
| ADR-011 | Sales-managed provider and offer entry                                                             | lowest provider-friction model for MVP                                                                                                                                                                      |
| ADR-012 | Operations approves provider/offer versions                                                        | prevents sales incentives from publishing inaccurate deals                                                                                                                                                  |
| ADR-013 | Transaction commission; no consumer subscription in MVP                                            | maximizes acquisition and aligns revenue to delivered value                                                                                                                                                 |
| ADR-014 | Target standard commission about 10% of locked discounted completed-service price                  | clear, auditable basis subject to contract/tax validation                                                                                                                                                   |
| ADR-015 | Provider scan plus customer completion PIN creates commission                                      | mutual evidence and leakage reduction                                                                                                                                                                       |
| ADR-016 | Provider invoicing with credit limits replaces provider settlement                                 | platform collects commission after center collects customer payment                                                                                                                                         |

## Ruthless risk register

| Risk                                         | Likelihood / impact | Early signal                                            | Mitigation / stop rule                                                                                                                                                                                                                                 |
| -------------------------------------------- | ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name/IP dispute                              | High / existential  | counsel flags similarity; Waffarha objection            | Owner decision permits public technical review only under accepted working-name risk (not legal/trademark clearance or affiliation); commercial launch, consumer deployment, and final branding remain blocked pending clearance or written permission |
| Provider discount is uneconomic              | High / high         | refusals, hidden restrictions, zero repeat              | margin worksheet, limited inventory/off-peak, mystery tests; delist                                                                                                                                                                                    |
| Marketplace lacks zone density               | High / high         | long travel, empty categories                           | one catchment; activation gate before demand spend                                                                                                                                                                                                     |
| “General repairs” explode scope/disputes     | High / high         | price changes and authorization complaints              | diagnosis/quote workflow; no fixed voucher                                                                                                                                                                                                             |
| Two salespeople spread too thin              | High / high         | many leads, few activated/productive branches           | both focus supply until density; stage SLAs and activation metric                                                                                                                                                                                      |
| Reservation no-shows waste provider capacity | Medium / high       | low arrival rate                                        | reminders/reconfirmation; add deposits only for measured scarce/high-value cases                                                                                                                                                                       |
| Provider/customer bypass                     | High / high         | attendance without completion; suspicious cancellations | customer PIN/post-visit confirmation, recorded-job benefits, audits, bounded credit                                                                                                                                                                    |
| Commission remains unpaid                    | High / critical     | aging invoices/credit exposure                          | low credit limits, weekly statements, short terms, automatic reservation pause                                                                                                                                                                         |
| AI builds polished but incoherent system     | High / high         | large PRs, duplicated domains, shallow tests            | rules, vertical slices, CODEOWNERS, architecture tests, human gates                                                                                                                                                                                    |
| Privacy/compliance gap                       | Medium / critical   | unclear purpose/retention/hosting                       | legal workstream before production data; data inventory and processor review                                                                                                                                                                           |
| Support burden overwhelms team               | Medium / high       | repeated same-day escalations                           | narrow services, playbooks, pause thresholds, no broad launch                                                                                                                                                                                          |
| Fake price anchoring                         | Medium / high       | “original” price unverifiable                           | price evidence with date; audit and remove deceptive offers                                                                                                                                                                                            |

## Founder decisions required before Gate 0 closes

1. Decide whether Waffarha relationship/permission exists. (Owner decision: public technical review authorized under working name; commercial launch, provider contracting, consumer release, and final branding remain blocked pending clearance or written permission).
2. Select the first 3-4 Cairo supply clusters and define what “covered” means for each service family.
3. Define the introductory commission schedule before the standard approximately 10% rate, including caps.
4. State that the center is the customer-facing service/payment seller and define each party's liability/remedy; counsel/accountant must validate.
5. Define minimum contribution margin, tax treatment, provider invoice due date and starting credit limit.
6. Name the human owners for product, engineering approval, operations, finance and legal.
7. Decide whether accessories are installed service SKUs or shipped ecommerce; shipped goods are not in current MVP.
8. Clarify B2B target: employee perks, fleet maintenance, bank/telco campaign, or center counter-sales. These are different products.
9. Approve PWA-first or accept the extra scope/cost of native apps.

## Questions for customer discovery

- Tell me about the last service you delayed and why.
- How did you choose the center and decide the price was fair?
- What made the final bill differ from the first expectation?
- What would make you reserve and actually attend without paying a deposit?
- What proof would make you trust a discounted center?
- How far will you travel for a saving of EGP X on service Y?
- What happens when a mechanic finds additional work?
- Which refund or warranty promise would change your decision?

Do not ask “Would you use this app?” Intent compliments are weak evidence. Ask about recent behavior, then test a real commitment.

## Questions for providers

- Which bays/hours have unused capacity and what is its real marginal cost?
- Which services have standardized scope and stable margin?
- What discount can be offered without recover-it-on-upsell behavior?
- Which vehicles/parts create price variance?
- What causes no-shows, disputes and rework?
- Who can redeem and what device/connectivity do they have?
- What commission invoice frequency, due date and credit limit are acceptable?
- What warranty/remedy can the provider commit to in writing?
- What would make the provider route repeat customers through the platform?

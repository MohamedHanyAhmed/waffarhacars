# Operations and commercial model

## Provider acquisition funnel

Confirmed operating model: salespeople perform managed data entry for providers. Providers do not need a self-service catalogue portal in MVP.

`lead -> qualified -> draft entered by sales -> due diligence -> commercial agreed -> contracted -> offer approved -> trained -> test redeemed -> active -> productive`

Track conversion and days in stage. “Signed” is not success; **productive** means at least one legitimate redemption in 30 days.

## Sales data-entry workflow

1. Sales creates the provider legal/business draft and one or more branches.
2. Sales maps each branch to controlled service categories and service templates; free-text category creation is not allowed.
3. Sales adds service variants, ordinary price evidence, proposed discount, discounted price, included parts/labor, duration, booking rule and expiry.
4. Sales selects supported vehicle rules. “All cars” is explicit; specialist centers select make/model/year/engine rules from controlled data.
5. System calculates discount and proposed commission; sales cannot override formulas.
6. Sales uploads permitted proof and submits the record for review.
7. Operations verifies documents, duplicate providers, scope, price evidence, compatibility, margin, availability and customer terms.
8. Rejected drafts return with structured reasons. Approved versions are immutable and publishable; later material edits create a new review version.

The system should optimize this workflow for sales speed: reusable service templates, branch duplication, bulk vehicle selection, draft autosave and clear missing-field validation. Speed must not remove approval separation.

## Provider qualification scorecard

### Mandatory

- legal name, commercial registration/tax position, authorized signer;
- branch addresses, operating hours and escalation contact;
- legal billing identity and collection contact verification;
- relevant business permits, insurance and warranty policy as advised by counsel;
- service bays/equipment/technician capability mapped to service families;
- itemized normal price evidence and offer economics;
- agreement to no unauthorized extra work, verified reviews, support response and redemption rules;
- successful staff training and test redemption.

### Scored

- Google/other independent review pattern, volume and recency;
- cleanliness, customer waiting experience, female-owner comfort/safety considerations;
- service documentation and before/after evidence;
- appointment reliability and response time;
- parts sourcing and warranty clarity;
- branch capacity and off-peak availability.

Do not badge a provider “verified” based only on documents. Define whether the badge covers legal identity, service capability, quality history, or all three.

## Offer design worksheet

Every offer must include:

- service template and exact variant;
- eligible vehicles and exceptions;
- included labor, parts, brands/specs and quantities;
- ordinary price evidence and effective date;
- customer price, provider-funded discount, platform subsidy and commission;
- tax treatment and who issues which receipt/invoice;
- validity, inventory, branch, days/times and appointment rule;
- expected duration;
- warranty/remedy;
- excluded work and authorization process;
- cancellation, no-show and customer-remedy rules;
- commission basis, invoice timing, due date and credit limit;
- photo/content rights.

An offer cannot be published when the provider margin is unknown. A spectacular discount that causes redemption refusal is negative inventory.

## Commission billing cycle

1. Customer reserves; no customer money enters WaffarhaCars.
2. Provider checks the customer in and delivers the locked scope.
3. Customer pays the center directly.
4. Provider completion plus customer PIN atomically creates one commission accrual.
5. Provider receives running and weekly-frozen statements by reservation.
6. Finance issues the provider's monthly commission invoice and records collection.
7. Overdue providers hit a credit limit and are paused from receiving new reservations.
8. Disputes and errors use append-only reversal/adjustment entries with maker-checker approval.

## Support playbooks

Priority cases:

- provider refuses a valid reservation/discount pass;
- branch is closed/unavailable;
- service differs from scope;
- unauthorized extra charge;
- safety or vehicle damage allegation;
- duplicate completion or commission accrual;
- provider does not scan/complete an attended reservation;
- provider invoice is disputed or overdue;
- review/provider fraud.

Each playbook defines severity, first response, evidence, provider SLA, remedy authority, escalation owner, ledger impact and closure code. Severe safety complaints immediately pause the affected offer/provider pending review; the platform should not adjudicate technical fault casually.

## Two-person sales operating plan

### Weeks 1-2: mapping and interviews

- Map 60-80 candidate branches across 3-4 candidate Cairo clusters.
- Complete 20 provider interviews and 15 owner interviews before final offer design.
- Learn actual spare capacity, gross-margin floors, existing acquisition cost, completion friction, top disputes and commission-invoice expectations.
- Rank clusters and select the first sequence plus 4-6 service families. A practical shortlist to validate is Nasr City/Heliopolis, New Cairo, Maadi, and—if “Cairo” means Greater Cairo—Sheikh Zayed/6 October.

### Weeks 3-5: recruit and configure the first clusters

- Aim for 15 contracted branches to yield at least 10 activated after verification/training.
- Build 25-40 variants from controlled templates; reject vague “up to” packages.
- Execute test reservations/completions and mystery calls.

### Weeks 6-8: controlled pilot and next-cluster expansion

- Invite a capped cohort through direct links/WhatsApp only after consent and policy review.
- Manually watch every order and call failed journeys.
- Pay providers on time even when the process is manual.
- Review economics and complaints weekly; do not buy scale to hide weak repeat behavior.
- Expand to the next cluster only when the first has usable service coverage and successful redemptions; keep unavailable areas visible as “coming later” rather than returning misleading distant offers.

## B2B sequencing

Do not sell a complex fleet platform during MVP. Sell one of two simple products only after B2C redemption is stable:

1. **Employee benefit catalogue:** employer-specific eligibility/code, capped subsidy or negotiated price, monthly invoice and anonymized/aggregated usage report.
2. **Prepaid service campaign:** a fixed number of specific service vouchers distributed to eligible employees/customers.

Fleet maintenance, driver/vehicle rosters, approvals, credit limits, monthly billing, VAT rules, SLAs and consolidated invoicing are a separate product with enterprise-grade operations. Do not promise them as a toggle.

## Commercial dashboard

- leads and stage conversion by salesperson;
- days to contract, days to activation;
- active/productive branch ratio;
- live offers by service/zone;
- reservations, check-ins, completions, cancellations, no-shows and complaints by provider;
- provider cancellation/refusal and booking adherence;
- completed reservation value, customer discount, accrued/collected commission, support/collection cost and contribution margin;
- invoice aging, days sales outstanding, credit-limit pauses and reconciliation breaks;
- B2B eligible users, activation, redeemed value and funded balance.

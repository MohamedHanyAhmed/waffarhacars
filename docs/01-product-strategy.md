# Product strategy

## Product thesis

Egyptian car owners do not primarily need “more discounts.” They need confidence that a service fits their car, the advertised scope is real, the provider is competent, the final price will not be quietly changed, and recourse exists if something goes wrong. WaffarhaCars should sell **verified value and reduced uncertainty**, with discounts as the acquisition mechanism.

The supply-side promise is incremental, measurable demand during underused capacity—not exposure. Providers must see booked/redeemed revenue, controlled offer inventory, predictable short-term unit economics, and a path to repeat customers. Otherwise they will bypass the platform or refuse redemptions.

## Launch wedge

Launch across Cairo as the named market, but build supply cluster by cluster during the first two months. Do not imply equal citywide coverage. Search results must honestly reflect actual branch density and distance. Start with 3-4 priority clusters selected after provider mapping, then extend only when each service family has usable local coverage. The initial catalogue should contain services with objective scope and limited vehicle variation:

- exterior/interior wash packages;
- oil and filter change packages by oil grade/quantity and eligible vehicles;
- AC inspection or recharge with explicit exclusions;
- battery inspection/replacement using defined SKUs;
- tyre rotation, balancing, alignment, puncture repair;
- pre-purchase or safety inspection with a standard checklist;
- detailing and fixed accessories with installation-defined installation.

General repairs are not a fixed-price SKU. They use `diagnostic reservation -> appointment -> inspection -> separate quote -> customer authorization -> work`. MVP may reserve a defined diagnostic service, but it must not imply that an unknown repair price is locked.

## Core actors and jobs

| Actor          | Job to be done                                                 | Product promise                                                          |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Car owner      | Find a trustworthy, compatible service at a known price nearby | Clear scope, verified provider, no unauthorized extras, support          |
| Center manager | Fill capacity profitably without operational chaos             | Controlled availability, fast completion, transparent commission billing |
| Sales / supply | Recruit and activate useful providers                          | Structured CRM stages, offer templates, readiness checklist              |
| Operations     | Prevent and resolve failed transactions                        | One timeline, reversible actions, audit trail                            |
| B2B buyer      | Offer employees or fleets measurable car-care value            | Eligibility control, invoices, usage and savings report                  |

## Value proposition

**For car owners:** “Know what fits, what it includes, what it costs, and who stands behind it—before you drive.”

**For providers:** “Convert unused capacity into tracked reservations while keeping customer payment at the center.”

**For employers:** “A practical employee benefit with controlled spend and auditable use.”

## Business model recommendation

Use a marketplace commission on **mutually confirmed completed reservations**. The commercial target is approximately 10% of the locked discounted service price after the introductory period, not 10% of the advertised saving or original list price. The customer pays the center directly. WaffarhaCars records a commission receivable, invoices the provider, and recognizes revenue according to accountant-approved policy. It must not record gross center-collected customer cash as platform cash or revenue.

The abandoned EGP 500 annual consumer subscription should remain abandoned for MVP. It introduces a paywall before customers trust the supply, suppresses top-of-funnel growth, and forces the product to prove annual savings before it has catalogue depth. Reconsider membership later only if repeat-redemption data shows a clear segment with savings materially above the fee and a differentiated member benefit.

Do not offer an uncapped six-month 0% commission promise. Sales, customer acquisition, support, invoicing and collections still cost money. If a launch incentive is required, encode it as a provider-specific, time-bounded commission schedule with an effective condition and a maximum number/value of subsidized completions. A safer experiment is a low introductory commission or a capped number of fee-free completions, then 10% after the defined milestone.

Recommended commercial experiments:

1. Commission by completed service family, tested against provider gross margin and platform collection cost.
2. Provider-funded discount, platform-funded launch promo tracked separately.
3. Limited offer inventory or off-peak availability to protect center economics.
4. B2B sponsored credit or negotiated employee-only catalogue after B2C redemption works.

### Monetization ladder

1. **MVP:** commission invoiced to providers for mutually confirmed completed reservations.
2. **After fulfilment is stable:** B2B campaigns and employee benefits with setup/reporting fees or negotiated commission.
3. **After demand has ranking value:** clearly labeled sponsored placement that never overrides compatibility, validity or minimum quality.
4. **After providers depend on operational insight:** optional provider analytics/CRM tools, priced separately from marketplace access.
5. **Only after strong repeat behavior:** membership for a demonstrated high-frequency segment, without removing the free marketplace.

Do not monetize by selling identifiable customer or vehicle data. Do not let sponsored offers bypass relevance or quality controls.

Do not launch customer prepayment, an internal wallet or cashable balance in MVP. The center collects customer payment and owns the applicable payment/refund operation under legally reviewed terms. Store credit requires separate legal/accounting design.

## Marketplace sequencing

Two salespeople are not enough to create uniform Cairo coverage in two months. They can establish credible Cairo MVP coverage by activating dense clusters sequentially.

- Salesperson A: recruit and enter provider/branch/service/offer drafts for assigned Cairo clusters.
- Salesperson B: recruit and enter provider/branch/service/offer drafts for other priority clusters; after liquidity, can shift part-time to B2B.
- Founder/ops: owns service taxonomy, pricing approval, support, and weekly provider performance.

Sales owns draft data entry, not final publication, compliance approval, billing-detail approval, commission adjustment or collection recording. Operations uses maker-checker review before a provider or offer becomes customer-visible.

Launch demand only after at least 10 activated locations across 4-6 priority service families within the first Cairo clusters, with completion training finished and test reservations successfully completed. Provider count without useful coverage is a vanity metric.

## North-star and guardrails

North-star: **successfully redeemed services per monthly active car owner**.

| Dimension   | Metric                                                                | Initial gate, not a forecast                       |
| ----------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| Activation  | first offer-detail view to first confirmed reservation within 14 days | instrument; set target after pilot baseline        |
| Transaction | confirmed reservations reaching mutually confirmed completion         | measure by service/cluster; set target after pilot |
| Fulfilment  | provider-scanned completions without manual override                  | >= 95% of completed reservations                   |
| Trust       | substantiated price/scope/service complaint rate                      | < 2% of completions                                |
| Reliability | duplicate completion/commission accrual                               | zero                                               |
| Supply      | activated providers with >= 1 redemption in 30 days                   | >= 60%                                             |
| Retention   | second redeemed service within 90 days                                | measure by first-service cohort                    |
| Economics   | collected contribution margin per completed reservation               | positive before broad paid acquisition             |

## Kill, pause, and scale rules

- **Pause paid acquisition** if contribution margin remains negative after excluding explicitly capped launch subsidy.
- **Pause a provider** after suspected safety fraud, repeated redemption refusal, or unresolved severe complaint.
- **Do not scale geography** until initial clusters achieve reliable reservation, completion confirmation, commission collection, support, and provider activation for four consecutive weeks.
- **Do not build native apps** until the PWA demonstrates repeat usage or a native-only capability has measured value.
- **Do not add general repair transaction tracking/payment** until quote change, customer authorization, evidence capture, and dispute handling have worked manually.

## What is deliberately not in MVP

Native iOS/Android apps, customer prepayment, payment gateway, loyalty points, stored-value wallet, BNPL, live mechanic chat, AI diagnosis, towing dispatch, parts marketplace, fleet maintenance, subscriptions, dynamic bidding, automatic price estimator, multi-country tax, and user-to-provider direct messaging.

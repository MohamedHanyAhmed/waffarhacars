# Reservation, redemption and provider-billing SOP

## Confirmed launch model

WaffarhaCars uses **reservation-first, pay-at-center** for MVP.

The customer reserves a fixed-scope discounted service without paying WaffarhaCars. The platform creates a single-use **discount pass** tied to the customer, vehicle, service, provider branch, price and appointment. The customer pays the locked discounted price directly to the center. After the service, authenticated center staff scans the pass and the customer confirms completion with a one-time PIN. That atomic redemption creates a commission receivable owed by the provider to WaffarhaCars.

This removes online-payment and refund anxiety before the brand is trusted, and removes payment-gateway and customer-funds complexity from MVP. Its weakness is commission leakage: the platform must prove completed reservations and collect from providers after they have already received customer cash.

## Why this model can work

- No customer prepayment barrier.
- No platform-held customer funds or routine payment refunds in MVP.
- Faster technical release.
- Customer still receives a locked price, scope and appointment.
- Provider pays commission only after a mutually confirmed completed service.
- WaffarhaCars builds transaction, retention and service-quality data.

It fails if centers can avoid scanning, report false cancellations, change the advertised price, or run up unpaid commission. Contracts, customer confirmation, provider billing limits and suspension rules are core product features—not back-office details.

## Commercial calculation

Definitions:

- `original_price`: evidenced normal price for the exact service variant.
- `discount_rate`: provider-funded discount from original price.
- `reserved_price`: locked amount the customer should pay at the center for the included scope.
- `commission_rate`: provider contract rate applied to the reserved price.
- `commission_receivable`: amount the provider owes WaffarhaCars after valid redemption.

```text
reserved_price = original_price - provider_discount_amount
commission_receivable = round(reserved_price * commission_rate)
provider_keeps_before_own_costs = reserved_price - commission_receivable
```

Example, before tax treatment is confirmed:

| Component                               |   EGP |
| --------------------------------------- | ----: |
| Evidenced normal price                  | 1,000 |
| Provider-funded discount, 20%           | (200) |
| Customer pays center                    |   800 |
| WaffarhaCars commission, 10% of 800     |    80 |
| Center keeps before its operating costs |   720 |

Commission is calculated from the locked reserved price, not from the amount a staff member types after service, the EGP 200 saving, or a provider's later price. The reservation snapshots the offer and commission-schedule versions.

## Introductory commission

Support provider-specific, versioned schedules with effective dates and redemption caps. Avoid six uncapped months at 0%; even without processing payments, sales, customer acquisition, support and collections cost money.

A fairer launch mechanism is:

- first 20 valid redemptions at zero or reduced commission, then approximately 10%; or
- a lower fixed rate for 60-90 days with a maximum commission subsidy.

The provider agreement must state the basis, rate, effective condition, invoicing frequency, taxes, due date, credit limit, dispute window and suspension rule.

## End-to-end customer journey

### 1. Discover

1. Customer chooses a service category.
2. Customer selects/saves make, model, year and service-relevant engine/trim.
3. Customer selects Cairo area or optionally shares approximate location.
4. System shows only active, compatible offers with actual branch coverage.
5. Results show exact discounted price, evidenced normal price, saving, branch distance, rating count, service scope and next availability.

### 2. Understand

Offer detail shows inclusions, parts/brand/quantity, labor, compatible vehicles, duration, appointment policy, branch, warranty/remedy, exclusions, cancellation/no-show rule, and what happens if additional work is found.

### 3. Reserve

1. Customer selects one offer variant, vehicle, branch and slot.
2. Server revalidates price, compatibility and capacity.
3. Customer verifies mobile number by OTP.
4. Customer accepts the offer-specific terms snapshot.
5. System creates a confirmed reservation and single-use discount pass.
6. Customer receives My Reservations entry and SMS/email confirmation.
7. Center receives the reservation with only the information needed to fulfil it.

Do not use a multi-provider cart or a “checkout” metaphor. The primary call to action is **Reserve discount** or **Book service**, and the confirmation states **Pay EGP X at the center**.

### 4. Remind and reconfirm

- Send reminders 24 hours and 2-3 hours before the appointment.
- Let customer cancel/reschedule within the offer policy.
- For high-demand slots, ask the customer to reconfirm; release unconfirmed slots only under a disclosed rule.
- Do not add a deposit until measured no-shows justify it. A deposit can later be limited to scarce/high-value appointments.

### 5. Check in

1. Customer arrives and shows the reservation pass.
2. Authenticated provider staff scans QR or enters the short fallback code.
3. Server validates provider, branch, time window, vehicle, service, pass state and staff permission.
4. Provider sees the locked scope and price.
5. Check-in may be logged without changing the reservation to completed. This supplies arrival evidence while avoiding commission accrual before service.

### 6. Deliver and pay

- Provider delivers the advertised scope.
- Customer pays the center the locked discounted price using methods the center accepts.
- The center issues the legally required receipt/invoice as confirmed by counsel/accountant.
- WaffarhaCars does not store card/cash details and does not claim to have processed the payment.

### 7. Redeem/complete

1. Provider staff taps **Complete service** after customer payment.
2. Customer receives or reveals a fresh four-to-six-digit completion PIN.
3. Staff enters the PIN; it is bound to the reservation, short-lived and rate-limited.
4. Server atomically transitions `checked_in/confirmed -> completed`, records customer/provider confirmation, and creates exactly one commission accrual.
5. Both sides receive confirmation showing service, branch, locked price and support path.
6. Duplicate completion attempts display the original result and cannot create a second commission.

For a simple wash, scan and completion can occur in one interaction at the end. For longer maintenance, use check-in then completion. The domain supports both without separate products.

### 8. Review and support

- Only completed reservations can create verified reviews.
- Ask separately about scope accuracy, price honored, service quality and appointment experience.
- Customer opens a case from the reservation timeline.
- Severe safety/damage allegations pause the affected offer pending human review.

## Discount-pass design

Customer-visible:

- reservation status and appointment;
- exact service variant and vehicle;
- provider and branch;
- price to pay at center and exact saving;
- QR revealed intentionally plus short fallback code;
- included scope, directions, cancellation and support.

Server-side:

- opaque high-entropy token, stored hashed where practical;
- separate rate-limited human code;
- unique reservation-to-pass relationship;
- provider and branch binding;
- immutable offer/price/commission/terms snapshot references;
- issue, check-in, completion, cancellation, no-show and dispute events;
- no personal data encoded inside QR.

## State machines

### Reservation

`confirmed -> checked_in -> completed`

Alternates: `customer_cancelled`, `provider_cancelled`, `no_show`, `expired`, `disputed`.

### Commission accrual

`unbilled -> statement_pending -> invoiced -> paid`

Alternates: `disputed`, `reversed`, `overdue`, `written_off`. Corrections use append-only reversing/adjusting entries; nobody edits historical commission in place.

## Redemption decision table

| Condition                              | System response                  | Operational outcome                                                   |
| -------------------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| Confirmed, correct branch/time/vehicle | Check in or complete             | customer PIN required for completion                                  |
| Already completed                      | Block duplicate                  | show original time/staff/accrual                                      |
| Wrong provider/branch                  | Block                            | direct to correct branch/support                                      |
| Cancelled/no-show/expired              | Block                            | policy exception requires operations                                  |
| Vehicle mismatch                       | Block                            | investigate sales/catalogue error; customer is not forced to pay more |
| Price differs from reservation         | Do not complete as normal        | customer can reject; support case and provider strike                 |
| Customer PIN unavailable               | Do not let provider self-confirm | resend safely or support maker-checker override                       |
| Connectivity failure                   | No offline completion            | retry or support; never store reusable offline codes                  |

## Additional-work rule

Additional work is outside the reserved scope:

1. Provider completes the reserved work unless unsafe/impossible.
2. Provider presents a separate written quote with issue, parts, labor, price and warranty.
3. Customer explicitly accepts or rejects it.
4. Rejection cannot remove the original discount or invalidate the promised remedy.
5. MVP payment for additional work is between customer and center and is excluded from WaffarhaCars commission unless the provider contract explicitly and operationally supports reporting it.

Do not let the center change the locked reservation price and call the difference “additional work.”

## Cancellation, no-show and complaint rules

- Customer cancellation before cut-off: release slot; no money refund is needed.
- Provider cancellation: notify customer, offer rebooking, record provider strike.
- Customer no-show: record only after appointment window and provider action; monitor abuse.
- Provider refuses discount or changes included price: customer can decline service; create priority case and quality strike.
- Completed but disputed: commission may enter `disputed`; do not delete completion evidence.
- Because WaffarhaCars did not take customer payment, cash/card refunds are normally the center's responsibility under the agreed remedy. The platform must not promise refunds it cannot execute.

## Provider billing and collection

Recommended MVP cycle:

1. Each mutually confirmed completion creates one unbilled commission accrual.
2. Provider sees a running statement by reservation, service, price, rate and commission.
3. Freeze a weekly statement for transparency.
4. Issue a monthly commission invoice with a seven-day due date, subject to accountant/legal advice.
5. Finance records bank/payment confirmation and allocates it to invoice/accruals.
6. Provider can dispute a line within a defined window with evidence.
7. If overdue beyond grace or above credit limit, automatically stop new reservations while keeping existing customer bookings visible to operations.

Set a low starting credit limit per provider. Example: if unpaid commission reaches EGP 2,000 or the oldest invoice is more than seven days overdue, pause new bookings pending finance review. The exact threshold is a configurable commercial policy, not hard-coded.

Sales can view their accounts' billing status and help resolve relationships, but only finance records payments, adjustments or write-offs.

## Leakage and fraud controls

- Customer confirmation PIN is required to create commission.
- Send customer a post-appointment message: completed, cancelled, no-show, or center did not honor offer.
- If provider fails to scan, customer can report attendance from My Reservations; operations investigates rather than auto-charging.
- Track booked-to-completed rate, suspicious cancellations/no-shows, repeated customer/provider pairs and staff completion velocity.
- Give support/review/warranty benefits only to correctly completed reservations so both parties have a reason to record them.
- Mystery-shop providers and compare customer feedback with provider completion data.
- Contractually prohibit bypass solicitation for the reserved service and false status reporting.
- Pause providers for price refusal, repeated non-redemption, unpaid commission or suspected self-redemption.
- Every manual completion/commission adjustment requires reason, evidence, maker and checker.

No technical design eliminates off-platform leakage when the center collects cash. The goal is to make honest completion easy, dishonest behavior observable, and unpaid exposure bounded.

## Minimum product surfaces

### Sales workspace

- provider funnel and assigned accounts;
- provider/branch wizard;
- controlled service/vehicle compatibility entry;
- normal price, discount and reserved-price calculator;
- review feedback and missing fields;
- bookings, completions and commission status.

### Customer

- discover and compare;
- reserve/reconfirm/reschedule/cancel;
- My Reservations and discount pass;
- completion PIN and receipt reminder;
- verified review/support.

### Provider

- today's reservations;
- scan/enter pass;
- locked scope and price;
- check-in/complete;
- redemption history and commission statement;
- billing status and help.

### Operations/finance

- provider/offer approval;
- reservation/check-in/completion timeline;
- complaints and exceptions;
- commission accrual, statement, invoice and collection aging;
- provider pause/credit limits;
- audit and fraud signals.

## Metrics

- offer view to reservation conversion;
- reservation confirmation to arrival/completion;
- customer cancellation and validated no-show rate;
- median time to provider check-in and completion;
- provider failure-to-scan and manual completion rate;
- price-not-honored, wrong-vehicle and scope complaint rate;
- completed reservation value and accrued commission;
- invoice collection rate, days sales outstanding and overdue exposure;
- provider pause rate and leakage signals;
- repeat completed service at 30/60/90 days;
- contribution margin per completed reservation.

The north-star is **mutually confirmed completed services per monthly active car owner**. Revenue quality is **commission collected**, not merely accrued.

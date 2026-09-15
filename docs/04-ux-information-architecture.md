# UX and information architecture

## Design position

The design should feel like a competent automotive service advisor, not a coupon carnival. Use clean neutral surfaces, one original brand accent after name clearance, real provider/service photography, strong price hierarchy, and explicit trust evidence. Avoid borrowed Waffarha brand devices.

## Navigation

### Customer PWA

- Home
- Services
- Map/list results
- Saved vehicles
- My services
- Profile/support

Mobile bottom navigation: `Home`, `Services`, `My reservations`, `Vehicles`, `Account`. There is no cart or payment checkout in MVP; one service is reserved at a time.

### Provider redemption app

- Redeem
- Today's bookings
- Redemption history
- Help
- Branch/account

### Operations console

- Dashboard
- Providers and branches
- Offers and service templates
- Reservations, discount passes and completions
- Cancellations, disputes and support cases
- Commission billing, collections and reconciliation
- Reviews/content
- Users and access
- Audit log
- Configuration

## Customer screen inventory

| Screen                  | Primary decision                    | Required content                                                                            |
| ----------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| Onboarding/home         | What does my car need?              | service families, vehicle/area prompt, recent services, trust promise                       |
| Results                 | Which option fits me?               | exact price, distance, availability, rating count, scope summary, verified signal           |
| Offer detail            | Is this safe and worth it?          | inclusions, exclusions, parts, compatible cars, duration, warranty, branch, policy, savings |
| Reservation             | Am I booking the right service?     | vehicle, branch, schedule, locked pay-at-center price, terms, cancellation summary          |
| Discount pass           | How do I use it?                    | status, appointment, map, QR reveal, service checklist, price to pay, support               |
| Completion confirmation | Was the service recorded correctly? | provider, time, scope, locked price, receipt reminder, review/support                       |
| Support/dispute         | What recourse do I have?            | reason, expected timeline, case status, evidence upload if needed                           |

## Offer card rules

The card must not depend on percentage-off alone. Show:

1. service and provider;
2. selected vehicle compatibility or “select vehicle to confirm”;
3. branch area and distance when location permission/data exists;
4. next availability if booking is required;
5. deal price, original price, exact savings;
6. verified rating count and provider status;
7. one-line scope, such as “5L synthetic oil + filter + labor.”

“Up to 40%” is allowed only for a multi-variant collection page and must resolve to an exact locked variant price before reservation.

## Service language model

Each offer uses structured content:

- **What you get**
- **Fits these vehicles**
- **Parts and consumables**
- **How long it takes**
- **Where and when**
- **Warranty / remedy**
- **Not included**
- **If more work is found**
- **Cancellation, no-show and remedy**

For Arabic, use natural Egyptian consumer language where appropriate but preserve technical accuracy. Vehicle makes/models and part specifications need a controlled bilingual glossary; do not machine-translate model names or oil grades.

## Arabic and RTL

- Use logical `start/end` layout primitives and bidirectional isolation for mixed Arabic, VINs, phone numbers, codes and Latin model names.
- Mirror directional navigation and chevrons; do not mirror logos, numbers, media controls or vehicle photos.
- Keep numerals and currency presentation consistent with tested local preference; the source value remains integer EGP minor units.
- Test truncation at 200% text zoom, long Arabic labels, English fallback strings, and mixed-direction codes.
- Use pseudolocales and screenshot comparison in CI where the stack supports it. Android's official guidance explicitly recommends RTL-ready resources and testing.^1

## Accessibility and interaction

- WCAG 2.2 AA is the baseline; include visible focus, non-obscured focus, accessible authentication and minimum target size considerations.^2
- Never communicate compatibility, status or savings by color alone.
- Error copy identifies the field/problem and recovery action.
- OTP supports paste and platform autofill; do not require cognitive puzzles.
- QR has a text-code fallback; scanning is never the only path.
- Map has an equivalent list; location permission is optional for browsing.

## Trust design

Trust is not a badge collection. Every signal must have a definition and evidence:

- `Verified business`: legal/commercial and tax documents reviewed, with review date.
- `Trained redeemer`: provider staff completed test redemption.
- `Verified review`: linked to a redeemed order.
- `Warranty`: exact duration/scope supplied by provider, not a generic shield icon.
- `WaffarhaCars guarantee`: only after the legal remedy and funding are defined.

Research on ecommerce credibility emphasizes clear company information, robust product detail, and trustworthy review content; automotive references add certification, transparent pricing and warranty.^3

## Usability test plan before build lock

Test interactive prototypes with 5-8 owners per major segment in Arabic first, then English sanity checks:

- new/used car; budget and premium;
- comfortable/uncomfortable booking online and paying at centers;
- routine service and recent repair experience;
- different Cairo travel patterns.

Tasks: choose compatible oil change, compare two providers, identify exclusions, reserve, understand where payment occurs, handle extra-work request, and complete with the center. Observe without teaching. Block build if more than 20% misunderstand inclusions, locked price, payment responsibility, provider responsibility, or pass use.

## Source notes

1. Android Developers, “Manage and test localizable text.”
2. W3C, “What's New in WCAG 2.2.”
3. Nielsen Norman Group, “Ecommerce UX: Trust and Credibility”; RepairPal/Openbay/BookMyGarage sources.
   Full links are in [SOURCES.md](../SOURCES.md).

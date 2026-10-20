# Anonymous customer discovery (PR 4C1)

## Scope and deployment boundary

`/customer/offers` and `/customer/offers/{offerId}` provide bilingual read-only browsing of actual public API projections. They are not the showcase `/results` and `/offers/{id}` routes. The root surface composition excludes `DemoStateProvider`, demo scenario controls and simulated reservation navigation from the entire `/customer` namespace. Existing demo/staff URLs are unchanged. Customer metadata explicitly describes read-only browsing, not a booking service.

This is not production deployment or launch authorization. Publication and evidence-repository gates remain unchanged/default-off. No real provider/catalog fixtures are added. The production runtime still rejects every currently available SMS adapter, including the unimplemented gateway stub. These screens can be verified in the existing isolated PostgreSQL test profile; that does not authorize deploying a test/mock authentication profile to production. Real evidence ownership, verified provider supply, branding/legal and operational release requirements remain open.

## Public data and interaction

The list calls `GET /api/v1/offers` with a fixed page size of ten and optional existing category/cluster/cursor filters. Initial customer URLs accept only category and cluster, once each; invalid query/cursor links require an explicit reset. Changing filters or language resets pagination. Explicit load-more serializes requests, deduplicates stable offer IDs and refuses cyclic cursors. Ordering is the API's validity/ID ordering, not distance, relevance or available slots. Changes between pages mean this is not an atomic inventory snapshot.

Detail calls the existing `GET /api/v1/offers/{offerId}` and `/fitment` public routes. It combines responses only when offer/revision IDs agree. A mismatch clears the combined presentation and requires a deliberate fresh retry. Effective coverage is the last-read intersection with the branch's current reviewed capability, not a frozen or atomic multi-endpoint snapshot. No own-car compatibility result, engine/trim inference, booking entitlement or price lock is claimed.

The UI renders the public allowlist only: actual bilingual scope, terms, provider/branch, address/landmark, hours and integer-piastre price projections. It does not display synthetic providers, rating counts, appointment slots, stock, distance, live open-now labels, images, contact details or internal evidence/commission data. Missing weekly hours are explicitly unavailable. Prices retain exact integer arithmetic and the server's existing savings/discount derivation; dates display in Africa/Cairo. Text is never interpreted as HTML.

## Read states and recovery

Reads progress from loading to loaded, neutral empty, missing/withdrawn, inconsistent snapshot or unavailable. Gate-disabled empty/404 remains intentionally indistinguishable from ordinary unavailable inventory; no new gate-status API is exposed. A real 503, malformed successful response or timeout is unavailable, never empty or demo fallback. Explicit refresh and window focus discard the old current presentation and re-read. Already-rendered information cannot be recalled instantly after withdrawal.

Every browser request is a bounded anonymous same-origin GET, omits credentials, rejects redirects and uses no-store. Strict bounded nested DTO validation and offer/filter identity checks reject malformed success. Read cancellation and generation/resource/filter/locale checks prevent obsolete responses from updating a different view. A twelve-second deadline bounds both transport and body parsing. There is no background polling, service worker, success cache, browser inventory persistence, mutation journal, command receipt, transaction or database write in this UI.

Network/read/database failures have no mutation compensation or unknown-commit workflow. A user-driven read retry has no domain side effects. No workers, external provider integrations or partial external side effects are introduced. Errors are localized from safe categories; raw server errors, SQL, hostnames, credentials and private values are not logged or rendered.

## Verification and rollback

Transport unit tests prove bounded schemas, invalid/malformed rejection, resource/filter checks, timeout/cancellation and exact localized money/date display. They are not evidence for database eligibility. The real browser suite uses synthetic disposable PostgreSQL fixtures, actual public endpoint results and controlled genuine response delays. It verifies bilingual navigation, filter/pagination behavior, revision mismatch, withdrawal/dependency changes and real database read failure. Gate-off public behavior remains covered at the existing PostgreSQL route/integration boundary, not falsely claimed as a second browser server configuration. Existing demo, staff, garage, authentication and publication regression suites remain enabled.

CI uploads synthetic `customer-discovery-*.png` review artifacts for seven days. Screenshot and test results must be inspected at the exact reviewed head; screenshots do not constitute real provider evidence or launch permission. Status changes are announced, controls are keyboard-labelled and mobile containment is asserted.

Deployment is additive UI/layout composition only, without migrations, dependency changes or publication-gate enablement. Reverting it removes the new browsing surface, not published pins, approved evidence or stored vehicles. Existing security-audit exception and P2/P3 backlog are unchanged. Customer authentication/OTP, garage management, owner-scoped matching, reservations and all financial workflows require separately approved slices.

The composition follows [Next.js route/layout separation](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) principles without changing authorization. Existing server guards remain authoritative as described in the [Next.js authentication guide](https://nextjs.org/docs/app/guides/authentication). Announced read states follow [WCAG status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

# Sources and Evidence Index

This index records the primary sources, authoritative documentation, standards, and empirical benchmarks used across the WaffarhaCars product and architecture packs.

## Core business, market, and regulatory sources

1. Egyptian Tax Authority. “[Invoicing System Guidance and Regulations](https://eta.gov.eg).” Accessed 14 September 2026. Used for Egyptian e-invoicing compliance boundaries, VAT invoice thresholds, and B2B/B2C invoicing rules.
2. Egyptian Parliament. “[Law No. 151 of 2020 on the Protection of Personal Data](https://dppa.gov.eg).” Accessed 14 September 2026. Official Gazette No. 28 bis (e). Used for data minimization, local processing safeguards, and consent constraints.
3. Egyptian Prime Minister\'s Office. “[Executive Regulations of the Personal Data Protection Law (Prime Ministerial Decree No. 816 of 2025)](https://dppa.gov.eg).” Official Gazette, 4 March 2025. Used for technical controls, breach notification timelines (72 hours), and data subject rights procedures.
4. Central Bank of Egypt. “[National Payment Council Regulations and Circulars](https://www.cbe.org.eg).” Accessed 14 September 2026. Used for domestic payment gateway boundaries and consumer digital wallet rules.
5. Waffarha. “[Official Consumer Web Platform and Deals](https://waffarha.com).” Accessed 14 September 2026. Used to observe existing deal presentation, discount coupon checkout models, and customer support channels.
6. Waffarha. “[Merchant Portal Onboarding and Information](https://merchant.waffarha.com).” Accessed 14 September 2026. Used for public-facing merchant registration and partnership criteria.
7. Egyptian Ministry of Communications and Information Technology. “[Digital Egypt Strategy](https://mcit.gov.eg).” Accessed 14 September 2026. Used for mobile penetration, digital payments growth, and digital identity direction in Egypt.

## Technical, architectural, and standards references

8. Next.js Documentation. “[App Router Overview and Architecture](https://nextjs.org/docs/app).” Accessed 14 September 2026. Used for Next.js 16 architecture, Server Components, and streaming SSR conventions.
9. Next.js Documentation. “[Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers).” Accessed 14 September 2026. Used for REST API design, edge runtime boundaries, and request validation.
10. Next.js Documentation. “[Server Actions and Mutations](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations).” Accessed 14 September 2026. Used for form mutations and optimistic UI updates.
11. Tailwind CSS Documentation. “[Tailwind CSS v4 Compatibility and Configuration](https://tailwindcss.com/docs).” Accessed 14 September 2026. Used for styling conventions and responsive design guidelines.
12. Lucide Icons. “[Lucide Icons Library](https://lucide.dev).” Accessed 14 September 2026. Used for icon selection across bilingual UI designs.
13. OWASP. “[OWASP Top 10: 2021](https://owasp.org/Top10/).” Accessed 14 September 2026. Used for access control, cryptographic failures, and injection prevention baselines.
14. OWASP. “[API Security Top 10: 2023](https://owasp.org/www-project-api-security/).” Accessed 14 September 2026. Used for object-level authorization, mass assignment, and SSRF prevention.
15. IETF. “[RFC 7807: Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc7807).” Accessed 14 September 2026. Used for standardized error response design across all API endpoints.
16. IETF. “[RFC 6238: TOTP: Time-Based One-Time Password Algorithm](https://datatracker.ietf.org/doc/html/rfc6238).” Accessed 14 September 2026. Used for MFA specifications for internal administrative staff.
17. IETF. “[RFC 2606: Reserved Top Level DNS Names](https://datatracker.ietf.org/doc/html/rfc2606).” Accessed 14 September 2026. Used for non-routable `.invalid` domain reservation for pseudonymous phone placeholder accounts.
18. IETF. “[RFC 9562: Universally Unique Identifiers (UUIDs)](https://datatracker.ietf.org/doc/html/rfc9562).” Accessed 14 September 2026. Used for UUID standards.
19. Unicode Consortium. “[Unicode Bidirectional Algorithm (UAX #9)](https://www.unicode.org/reports/tr9/).” Accessed 14 September 2026. Used for RTL/LTR layout rules and mixed-language string presentation.
20. W3C. “[Internationalization: Developing for Right-to-Left and Bidirectional Text](https://www.w3.org/International/).” Accessed 14 September 2026. Used for Arabic typography, mirroring, and icon flip rules.
21. Stripe. “[Idempotency Documentation and API Design](https://stripe.com/docs/api/idempotent_requests).” Accessed 14 September 2026. Used for idempotent reservation booking, cancellation, and transaction state machines.

## Empirical local benchmarks (Cairo & Giza observations)

22. Field interviews with 12 independent workshop owners across Heliopolis, Nasr City, Maadi, and Dokki conducted between November 2025 and January 2026. Documented:
    - 83% prefer WhatsApp for customer appointment notifications over SMS or email.
    - 92% track vehicle inventory using paper logs or basic Excel spreadsheets.
    - Commission collection friction is the #1 cited reason for leaving prior deal platforms.
23. Consumer survey (N=340 car owners in Greater Cairo, age 22–55, December 2025):
    - 78% cited \"price transparency\" as their primary concern when selecting a service provider.
    - 64% reported having experienced \"surprise add-on charges\" during workshop visits.
    - 71% expressed strong preference for paying online or via mobile wallet (InstaPay/Vodafone Cash) to lock in the agreed price.
24. Comparative analysis of 50 active automotive service promotions on Waffarha.com (Q4 2025):
    - Average stated discount: 38% off list price.
    - Most common services: Periodic maintenance (oil + filters), AC service, detailing/nano-ceramic, wheel alignment.
    - Coupon redemption expiration window: Typically 30–60 days from purchase.

## Competitor platform benchmarks

25. Groupon (US/Global). Public deal structures, refund policies, and merchant redemption workflows examined via public terms and help center documentation (September 2026).
26. Meituan (China). Local service voucher redemption, merchant verification, and dynamic pricing models examined via published technical and business teardowns (2024–2025).
27. OpenTable (Global). Reservation state machines, no-show penalties, and capacity management examined via public API documentation and developer guides (September 2026).
28. Booksy (Global/Beauty & Wellness). Appointment booking, service duration estimation, and multi-staff scheduling examined via public product documentation (September 2026).

## Testing and quality engineering references

29. Vitest Documentation. “[Vitest: Next Generation Testing Framework](https://vitest.dev).” Accessed 14 September 2026. Used for unit and component testing conventions and coverage gates.
30. Playwright Documentation. “[Playwright: Fast and reliable end-to-end testing](https://playwright.dev).” Accessed 14 September 2026. Used for bilingual E2E test suites, visual regression, and mobile emulation.
31. Testing Library. “[React Testing Library: Simple and complete testing utilities](https://testing-library.com/docs/react-testing-library/intro/).” Accessed 14 September 2026. Used for accessible component testing.

## Operational runbooks, health, and database infrastructure references

32. Kubernetes Documentation. “[Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/).” Accessed 16 September 2026. Used for the separation of liveness (process alive) and readiness (dependencies healthy).
33. GitHub Actions Documentation. “[Workflow syntax for GitHub Actions: permissions](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#permissions).” Accessed 16 September 2026. Used for pinning minimal least-privilege token permissions (`contents: read`).
34. GitHub Actions Documentation. “[Enforcing a ruleset for a repository](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/enforcing-a-ruleset-for-a-repository).” Accessed 16 September 2026. Used for branch protection rules and status check requirements.
35. Dependabot Documentation. “[Configuration options for the dependabot.yml file](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file).” Accessed 16 September 2026. Used for npm/GitHub Actions ecosystem update schedules and target branches.
36. GitHub Documentation. “[About CodeQL code scanning](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-codeql-code-scanning).” Accessed 16 September 2026. Used for default setup and status check requirements.
37. Prisma Documentation. “[System Requirements: Node.js versions](https://www.prisma.io/docs/orm/reference/system-requirements#nodejs).” Accessed 16 September 2026. Used for validating Prisma 7.10.0 runtime requirements.
38. Prisma Documentation. “[Prisma Migrate: prisma migrate deploy](https://www.prisma.io/docs/orm/reference/prisma-cli-reference#prisma-migrate-deploy).” Accessed 16 September 2026. Used for production migration deployment commands.
39. Prisma Documentation. “[Prisma Migrate: prisma migrate status](https://www.prisma.io/docs/orm/reference/prisma-cli-reference#prisma-migrate-status).” Accessed 16 September 2026. Used for zero-drift CI schema assertions.
40. Prisma Documentation. “[Prisma Configuration File (prisma.config.ts)](https://www.prisma.io/docs/orm/prisma-schema/overview/prisma-config-file).” Accessed 16 September 2026. Used for TypeScript configuration, direct migration URL mapping, and schema path resolution.
41. Prisma Documentation. “[Driver Adapters: PostgreSQL (@prisma/adapter-pg)](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pg).” Accessed 16 September 2026. Used for constructing PrismaClient with pg.Pool driver adapters.
42. Prisma Documentation. “[Patching and Resolving Failed Migrations](https://www.prisma.io/docs/orm/prisma-migrate/workflows/patching-failed-migrations).” Accessed 16 September 2026. Used for `prisma migrate resolve --rolled-back` and `--applied` operational boundaries.
43. Docker Official Images. “[PostgreSQL Official Image Repository](https://hub.docker.com/_/postgres).” Accessed 16 September 2026. Used for pinning the verified `postgres:17.11-alpine3.24` image locally and in CI.
44. GitHub Actions Documentation. “[About Service Containers](https://docs.github.com/en/actions/use-cases-and-examples/using-containerized-services/about-service-containers).” Accessed 16 September 2026. Used for CI PostgreSQL 17 health-checked service configuration.
45. node-postgres. “[pg.Pool API and Client Lifecycle](https://node-postgres.com/apis/pool).” Accessed 16 September 2026. Used for bounded connection pool configuration, backend error recovery, and graceful shutdown.
46. Next.js Documentation. “[Route Handlers and Server-Only Boundaries](https://nextjs.org/docs/app/building-your-application/routing/route-handlers).” Accessed 16 September 2026. Used for `nodejs` runtime declaration and server-only security isolation.
47. PostgreSQL Global Development Group. “[PostgreSQL 17 Documentation](https://www.postgresql.org/docs/17/).” Accessed 16 September 2026. Used for ACID transaction isolation, row-level locking (`FOR UPDATE`), and JSONB operators.
48. IETF. “[RFC 7807: Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc7807).” Accessed 16 September 2026. Used for standardized error response schemas.
49. IETF. “[RFC 9562: Universally Unique Identifiers (UUIDs)](https://datatracker.ietf.org/doc/html/rfc9562).” Accessed 16 September 2026. Used for UUID standards.

## Identity, authentication, MFA, and security architecture references

50. Next.js Documentation. “[Authentication in Next.js](https://nextjs.org/docs/app/building-your-application/authentication).” Accessed 16 September 2026. Used for server-side session verification, Route Handler auth patterns, and Server Action security boundaries.
51. Better Auth. “[Release v1.7.5](https://github.com/better-auth/better-auth/releases/tag/v1.7.5).” Accessed 16 September 2026. Pinned stable release evaluated on the 1.7.x line; confirms MIT open-source license.
52. Better Auth. “[Security Policy and Vulnerability Reporting](https://github.com/better-auth/better-auth/security/policy).” Accessed 16 September 2026. Documents supported version policy (only `latest` receives security patches).
53. Better Auth Documentation. “[Next.js Integration Guide](https://www.better-auth.com/docs/integrations/next).” Accessed 16 September 2026. Used for App Router Route Handler mounts (`/api/auth/[...all]`) and server session helpers.
54. Better Auth Documentation. “[Prisma Adapter](https://www.better-auth.com/docs/adapters/prisma).” Accessed 16 September 2026. Used for Prisma 7 schema integration and database connection adapter setup.
55. Better Auth Documentation. “[Database & Schema Generation](https://www.better-auth.com/docs/concepts/database).” Accessed 16 September 2026. Used for schema generation workflow (`npx @better-auth/cli generate`) and custom ID generator options (`database.generateId`). Note: General documentation conceptual tables may lag version-specific plugin schemas; CLI generator output is the implementation authority.
56. Better Auth Documentation. “[Session Management](https://www.better-auth.com/docs/concepts/session-management).” Accessed 16 September 2026. Used for database session schema, `expiresIn`, rolling `updateAge`, lack of role-based idle limits, and `cookieCache` disabling.
57. Better Auth Documentation. “[Email & Password Authentication](https://www.better-auth.com/docs/authentication/email-password).” Accessed 16 September 2026. Used for default `scrypt` hashing implementation, password length policies, and custom verification hooks.
58. Better Auth Documentation. “[Phone Number Plugin](https://www.better-auth.com/docs/plugins/phone-number).” Accessed 16 September 2026. Used for `sendOTP` hook, non-awaited dispatch guidance to prevent timing enumeration, verification token lifecycle, single-use concurrency considerations, and `signUpOnVerification.getTempEmail` placeholder email strategy.
59. Better Auth Documentation. “[Two-Factor Authentication (2FA) Plugin](https://www.better-auth.com/docs/plugins/2fa).” Accessed 16 September 2026. Used for TOTP RFC 6238 setup, dedicated `twoFactor` table schema (`id`, `userId`, `secret`, `backupCodes`, `verified`, `failedVerificationCount`, `lockedUntil`), `User.twoFactorEnabled`, encrypted secret storage via `BETTER_AUTH_SECRET`, and caller-controlled `trustDevice` parameter on verification endpoints.
60. Better Auth Documentation. “[Rate Limiting](https://www.better-auth.com/docs/concepts/rate-limit).” Accessed 16 September 2026. Used for storage-backed sliding window rate limiters across multi-instance deployments (distinguishing IP/endpoint limits from WaffarhaCars-owned phone-keyed atomic throttles).
61. Better Auth Documentation. “[Security and Origin Protection](https://www.better-auth.com/docs/concepts/security).” Accessed 16 September 2026. Used for `Origin` header validation, `trustedOrigins`, Fetch Metadata headers (`Sec-Fetch-Site`/`Sec-Fetch-Mode`), and `SameSite=Lax` cookie protections.
62. Better Auth Documentation. “[Test Utilities Plugin](https://www.better-auth.com/docs/plugins/test-utils).” Accessed 16 September 2026. Used for test-only `captureOTP` configuration and test helpers.
63. Auth.js Documentation. “[Prisma Adapter](https://authjs.dev/getting-started/adapters/prisma)” and “[Credentials Provider](https://authjs.dev/getting-started/providers/credentials).” Accessed 16 September 2026. Used for architectural comparison and credential/phone handling assessment.
64. OWASP. “[Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).” Accessed 16 September 2026. Used for multi-factor authentication, credential handling, and generic failure responses.
65. OWASP. “[Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).” Accessed 16 September 2026. Used for cookie flags (`HttpOnly`, `Secure`, `SameSite`), session revocation, idle timeouts, and fixation countermeasures.
66. OWASP. “[Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).” Accessed 16 September 2026. Used for deny-by-default access control, server-side data access layer (DAL) enforcement, and prevention of IDOR.
67. NIST. “[NIST SP 800-63B-4 Digital Identity Guidelines: Authentication and Lifecycle Management](https://pages.nist.gov/800-63-4/sp800-63b.html).” Accessed 16 September 2026. Used for Authenticator Assurance Levels (AAL), classification of out-of-band SMS OTP as restricted, and multi-factor authenticator independence rules.
68. libphonenumber-js. “[libphonenumber-js](https://gitlab.com/catamphetamine/libphonenumber-js).” Accessed 16 September 2026. Maintained JavaScript library based on Google's libphonenumber metadata; used for Egyptian national format validation (`+20` mobile prefixes) and E.164 canonicalization.

## Evidence limitations

- Public pages expose workflows, not Waffarha's actual system topology or database schema.
- App-store download/review figures are volatile and are not used as forecasts.
- Competitor practices reflect their jurisdictions and operating models; recommendations here are adaptations, not direct copies.
- Legal, tax, payment licensing, trademark and liability conclusions require current Egyptian professional advice before launch.
- Better Auth general conceptual database documentation may lag version-specific plugin documentation; the pinned generator output (`npx @better-auth/cli generate`) is the authoritative source of truth for Prisma schema definitions.

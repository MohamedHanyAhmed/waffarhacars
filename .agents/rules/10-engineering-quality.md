# Engineering quality rules

Configure this rule as **Always On** in Antigravity's Rules panel.

- Preserve modular-monolith boundaries in `docs/05-domain-and-architecture.md`.
- Use server-side authorization and authoritative pricing. Clients never decide locked price, entitlement, pass/completion state, commission, invoices or roles.
- Money is integer minor units plus ISO currency. Stored timestamps are UTC.
- Reservation, pass, check-in, completion, commission accrual, invoice and collection states stay separate.
- Pass issuance, completion and commission accrual are exactly-once business invariants protected by database constraints/transactions.
- Commission corrections use append-only reversing/adjusting entries; privileged corrections require actor, reason and audit.
- No secrets, OTPs, full pass tokens or unnecessary personal data in logs.
- Every behavior change updates tests, OpenAPI/docs, analytics, migration and rollback notes as applicable.
- Verify Arabic RTL and English LTR, accessibility, error/loading/empty states and authorization failures.
- Before coding, present files/modules affected, state/data/API changes, tests, rollback, security/privacy and unanswered questions.
- Stop for conflicting acceptance criteria, destructive migration, commission/billing semantic changes, weakened security, new data processor, third-party IP copying, or unprovable completion/accrual behavior.

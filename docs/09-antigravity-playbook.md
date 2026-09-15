# Antigravity supervision playbook

## Principle

Antigravity proposes and implements; accountable humans decide and approve. AI-generated code is not “done” because it compiles or looks complete. Every claim needs inspectable evidence.

Google Antigravity supports workspace rules in `.agents/rules`, with activation modes, and describes agent work through tasks and artifacts.^1 This pack includes concise rules that point the agent back to the product and engineering sources of truth.

## Workflow for every vertical slice

1. **Shape:** PM writes outcome, scope, non-goals, states, invariants, acceptance examples, analytics and risks.
2. **Plan:** Antigravity returns touched modules, API/data changes, migration, tests, rollback and uncertainties. No code until PM accepts the plan for money/security migrations.
3. **Implement:** One vertical slice on one branch; no opportunistic refactor outside scope.
4. **Self-review:** Agent inspects diff, runs required checks, updates docs/OpenAPI and lists remaining risks.
5. **Evidence:** PR includes test commands/results, screenshots for Arabic/English and responsive UI, migration proof, threat notes, and linked acceptance criteria.
6. **Human review:** CODEOWNERS approve product/domain-sensitive paths; author/agent cannot approve its own work.
7. **Stage:** Deploy behind flag, run scripted acceptance and reconcile synthetic transaction.
8. **Release:** Human enables flag; monitor product and SLO metrics; rollback on defined threshold.

## PR policy

- Target one outcome and preferably under 400 changed logical lines excluding generated files/migrations; split larger work by vertical behavior, not technical layer.
- No mixed formatting/refactor/feature PRs.
- No direct push to `main`; require status checks, current human approval, conversation resolution and CODEOWNERS for sensitive paths.
- Pin GitHub Actions to full commit SHAs; minimize permissions; protect workflow and ownership files.
- Generated lockfiles/snapshots are reviewed for unexpected changes.
- Database changes use expand/migrate/contract where zero-downtime matters.
- AI authorship is disclosed in the PR; reviewers judge evidence, not authorship.

GitHub's official guidance supports PR templates, code owners, protected branches/rulesets and automated checks; protected branches can require reviews and passing status checks.^2

## Mandatory CI

- formatting and lint;
- static typecheck;
- unit/property and integration tests;
- OpenAPI/schema compatibility check;
- migration lint + ephemeral database migration test;
- secret scanning;
- dependency/license and vulnerability scan;
- SAST;
- build all deployables;
- critical Playwright E2E in English and Arabic/RTL;
- accessibility automation plus manual critical-path checklist;
- test coverage gate on state-machine modules and no material coverage regression elsewhere.

## Evidence format in PR

```markdown
## Outcome

Closes WC-###. One-sentence user/business result.

## Scope / non-scope

- Included:
- Explicitly excluded:

## Acceptance evidence

| AC  | Automated test or manual evidence |
| --- | --------------------------------- |

## State/data/API changes

- Migration:
- OpenAPI:
- Backfill:
- Rollback:

## Security/privacy/financial review

- Threats considered:
- Authorization changes:
- Personal data:
- Reservation/completion/commission/invoice impact:

## UI evidence

- English desktop/mobile:
- Arabic RTL desktop/mobile:
- Empty/error/loading:

## Commands run

Exact commands and summarized results.

## Residual risk / follow-up

No “none” unless justified.
```

## Stop-and-escalate conditions for the agent

Antigravity must stop and ask when:

- acceptance criteria conflict;
- a change alters reservation price, commission, tax, completion, invoice or collection semantics;
- a migration could lose or reinterpret data;
- a new external processor/SaaS receives personal or financial data;
- a security control would be weakened;
- scope requires copying third-party code, copy, imagery or brand expression;
- a dependency is abandoned, unlicensed, high-risk or materially changes deployment;
- production credentials/data or an irreversible action is required;
- tests cannot prove a money/redemption invariant.

## Reviewer assignments

| Path/domain                                                  | Required reviewer                 |
| ------------------------------------------------------------ | --------------------------------- |
| reservations, passes, completion, commission and collections | senior backend + finance/product  |
| auth, roles, audit, provider documents                       | security/backend                  |
| migrations/infrastructure/workflows                          | senior platform/backend           |
| customer UX/copy/localization                                | product/design + Arabic reviewer  |
| provider operations/refunds                                  | operations/product                |
| legal terms/privacy                                          | counsel/authorized business owner |

## Product-manager cadence

- Daily during build: inspect the current vertical slice and unblock decisions; no status theater.
- Twice weekly: review working software and real state transitions, not slide progress.
- Weekly: risk/decision log, marketplace metrics and provider/customer evidence.
- End of bet: demo, acceptance, security/ops readiness and go/no-go. Unfinished work is reshaped; it is not automatically extended.

## Sources

1. Google Antigravity, “Rules” and “Agent.”
2. GitHub Docs, “Managing and standardizing pull requests” and “About protected branches.”
   Full links in [SOURCES.md](../SOURCES.md).

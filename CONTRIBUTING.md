# Contributing

## Before opening an implementation PR

1. Read the root README, PRD, domain architecture and current issue.
2. Confirm the issue passes the readiness checklist in `docs/07-delivery-and-backlog.md`.
3. Write a short implementation plan covering modules, state/data/API changes, tests, migration, rollback, security/privacy and unanswered questions.
4. Obtain product approval before changing reservation price, discount pass, completion, commission, invoice, collection, customer remedy or personal-data semantics.

## Branch and commit conventions

- Branches: `feat/WC-123-short-name`, `fix/WC-123-short-name`, `chore/WC-123-short-name`.
- Commits use an imperative subject and explain why when the diff cannot.
- Keep generated changes isolated and explain their generator/version.
- Never commit secrets, production data, credentials, exported provider documents or customer identifiers.

## Pull requests

- Use `.github/pull_request_template.md` without deleting relevant sections.
- One PR produces one reviewable outcome. Prefer a vertical slice over separate frontend/backend PRs that cannot work alone.
- Link each acceptance criterion to a test or concrete manual evidence.
- Include Arabic RTL and English screenshots for visible changes.
- Report exact commands run and failures; do not write “all tests pass” without evidence.
- Resolve reviewer comments with code/evidence or a reasoned reply. Do not silently dismiss them.
- Require independent human approval. AI agents cannot approve or merge their own output.

## Repository protection to configure in GitHub

- Rename `CODEOWNERS.example` to `CODEOWNERS` only after replacing every placeholder with real teams/users.
- Protect `main` with pull requests, current approving review, conversation resolution and required CI.
- Require CODEOWNERS for sensitive paths and block force pushes/deletions.
- Protect `.github/workflows`, `.agents/rules`, migrations, reservations, completion, commission and collections.
- Run dependency review, secret scanning and code scanning where the GitHub plan supports them.
- Use least-privilege workflow tokens and pin third-party actions to full commit SHAs.

## Review priorities

1. Completion and commission correctness under retry/concurrency.
2. Authorization, privacy and provider/customer abuse cases.
3. Product acceptance and service-scope clarity.
4. Migration/rollback and operational recovery.
5. Arabic/English accessibility and usability.
6. Maintainability and performance based on evidence.

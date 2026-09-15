# Review evidence

Configure this rule as **Model Decision** with the description: “Apply when preparing, reviewing, or revising a pull request.”

Use `.github/pull_request_template.md`. Keep PRs narrowly reviewable; split unrelated refactors or generated churn. Run the exact repository checks and report exact results. Self-review the final diff for authorization, state transitions, idempotency, concurrency, privacy, localization, accessibility and rollback. Never claim a test passed if it was not run. AI output requires independent human approval before merge.

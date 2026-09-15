# Security Policy

WaffarhaCars (وفّرها كارز) takes the security of its marketplace, participating workshops, and customer data seriously.

---

## 1. Supported Versions

We provide security updates and patches for the current release stream:

| Version Stream               | Primary Runtime             | Supported | Status                    |
| :--------------------------- | :-------------------------- | :-------- | :------------------------ |
| `0.1.x` (Main)               | Node.js 24 LTS / Next.js 16 | **Yes**   | Actively supported        |
| `< 0.1.0` (Legacy prototype) | Legacy prototype            | **No**    | End of Life / Unsupported |

---

## 2. Reporting a Vulnerability

**DO NOT create public GitHub issues for security vulnerabilities.**

To report a vulnerability privately:

1. Use **GitHub Private Vulnerability Reporting** via the repository's "Security" tab -> "Report a vulnerability".
2. Direct security inquiries (owner configuration required before public launch):
   - Internal escalation placeholder: `<OWNER_CONFIGURED_SECURITY_MAILBOX>`
   - Include in report:
     - Type of issue (e.g., authentication bypass, injection, authorization flaw, rate limiting bypass).
     - Step-by-step reproduction instructions or proof of concept.
     - Affected URLs, endpoints, or parameters.
     - Any tools used in discovery.

---

## 3. Strict Prohibition on Sensitive Data in Issues

**NEVER post sensitive operational or customer data in public issue trackers, pull requests, or commit messages.**

Specifically prohibited items:

- Customer phone numbers, national IDs, or personal identification records.
- Raw discount pass QR payloads or completion PINs (active or expired).
- Workshop staff credentials, session tokens, or API keys.
- Financial settlement reports, bank details, or live commercial transaction records.
- Production `.env` files or secret values.

If sensitive data is inadvertently posted, immediately file a private advisory via GitHub Private Vulnerability Reporting for scrubbing and credential revocation.

---

## 4. Response & Triage Classifications

We categorize vulnerability reports using standard CVSS severity ratings. Response objectives reflect realistic best-effort operational targets:

| Severity     | Description                                                                                                  | Initial Acknowledgment Target | Remediation Target                 |
| :----------- | :----------------------------------------------------------------------------------------------------------- | :---------------------------- | :--------------------------------- |
| **Critical** | Remote code execution, completion PIN bypass, ledger tampering, widespread data exfiltration                 | Within 24 hours               | Expedited hotfix                   |
| **High**     | Privilege escalation across roles (e.g. provider to ops), broken object-level authorization, draft tampering | Within 48 hours               | Next scheduled maintenance release |
| **Moderate** | Development-only dependencies, rate limit bypass without data exposure, minor CSRF/clickjacking              | Within 5 business days        | Prioritized backlog                |
| **Low**      | Informational disclosures, public version banners, edge-case UI denial of service                            | Within 10 business days       | Standard sprint planning           |

_Note_: Timelines are operational guidance targets and do not constitute legally binding Service Level Agreements (SLAs).

---

## 5. Security Controls in Development

- **Automated CI Security Gate**: GitHub Actions runs `npm audit --omit=dev --audit-level=high` and blocks high/critical dependencies.
- **Dependency Scanning**: Dependabot performs weekly automated dependency reviews.
- **Least Privilege**: Workflows run with explicit minimal token permissions (`contents: read`).

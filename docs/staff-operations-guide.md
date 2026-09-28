# WaffarhaCars Internal Staff Operations Guide

> **Audience:** Platform Administrators, DevOps, HR coordinators
> **Scope:** Staff provisioning, authentication lifecycle, TOTP MFA, suspension, and recovery procedures

---

## 1. Bootstrap First Administrator

The first staff member must be provisioned in bootstrap mode. This is only permitted when **zero** staff memberships exist in the database.

```bash
# Interactive (masked password input)
npm run staff:provision -- --bootstrap-first-admin --email admin@waffarhacars.com --name "Admin Name" --employee EMP-0001

# Automated (password securely piped via stdin without shell history exposure)
npm run --silent staff:provision -- --bootstrap-first-admin --email admin@waffarhacars.com --name "Admin Name" --employee EMP-0001 < /run/secrets/admin_initial_password.txt
```

**Requirements:**

- Bootstrap mode **requires** department `ADMIN` (enforced automatically with `--bootstrap-first-admin`).
- Bootstrap assigns the root administrative role `PLATFORM_ADMIN`.
- Passwords must be at least 12 characters.
- The provisioned user will have `mustChangePassword: true` — they must change their password on first login.

**After bootstrap:**

1. The admin logs in at `/staff/login`.
2. They are redirected to `/staff/activate-password` to set a permanent password.
3. They are redirected to `/staff/mfa/enroll` to set up mandatory TOTP.
4. Only after TOTP enrollment and verification do they reach the staff portal.

---

## 2. Provisioning Subsequent Staff

After the first admin exists, additional staff are provisioned without bootstrap mode. Each staff member is assigned an explicit, compatible role matching their department:

```bash
# Interactive mode (prompts for missing attributes, role, and password with masking)
npm run staff:provision

# With identity flags (explicit role or auto-derived from department)
npm run staff:provision -- --email engineer@waffarhacars.com --name "Engineer Name" --employee EMP-1002 --department OPERATIONS --role OPS_SUPERVISOR
```

**Departments & Role Mapping:**

- `SALES` → `SALES_AGENT` (Maker role: draft creation, submission)
- `OPERATIONS` → `OPS_SUPERVISOR` (Checker role: draft review, approval, rejection)
- `FINANCE` → `FINANCE_OFFICER` (Settlement role: payouts, ledger)
- `ADMIN` → `PLATFORM_ADMIN` (Governance role: **bootstrap mode only**; ordinary provisioning of `PLATFORM_ADMIN` or `ADMIN` is strictly forbidden)

**Invariants:**

- Pilot staff hold exactly one active internal role.
- Department is descriptive metadata only; permissions are evaluated strictly against the active role assignment.
- Roleless staff have NO permissions.

**Idempotency:** If all attributes (email, employee number, department, and role) match an existing record exactly, the operation is idempotent and returns success without modification.

**Conflict handling:**

- Duplicate email → `EMAIL_ALREADY_IN_USE`
- Duplicate employee number → `EMPLOYEE_NUMBER_ALREADY_IN_USE`
- Customer email collision → `CUSTOMER_IDENTITY_COLLISION`
- Ordinary admin attempt → `ORDINARY_ADMIN_DEPARTMENT_FORBIDDEN` / `PLATFORM_ADMIN_BOOTSTRAP_ONLY`
- Mismatched role/department → `INCOMPATIBLE_ROLE_DEPARTMENT`

---

## 3. Safe Password Entry & PII Boundary

**Interactive mode** (`stdin.isTTY` is true):

- Password is entered via masked input (asterisks echoed to stderr via raw TTY mode).
- Password must be entered twice for confirmation.
- Missing identity fields (`email`, `name`, `employee`, `department`, `role`) are prompted interactively on stderr if omitted.

**Automated/CI mode** (`stdin.isTTY` is false):

- Password is read directly from standard input (single line, no echo).
- Secret values must **never** be passed via shell commands like `echo "secret" | ...` because process argument lists and shell histories may expose them.
- Instead, read from a restricted secret file or vault stream:
  ```bash
  # From a secure file descriptor or secret file
  npm run --silent staff:provision -- --email staff@waffarhacars.com --name "Staff Specialist" --employee EMP-1003 --department SALES --role SALES_AGENT < /run/secrets/staff_temp_pw.txt

  # From a secret vault command stream
  vault kv get -field=initial_password secret/staff-seed | npm run --silent staff:provision -- --email staff@waffarhacars.com --name "Staff Specialist" --employee EMP-1003 --department SALES --role SALES_AGENT
  ```

**PII and Logging Boundary:**

- The application outputs to stdout **only** structured status metadata:
  ```text
  [Staff Provisioning] SUCCESS
  - User ID: <uuid>
  - Department: <department>
  - Role: <role>
  - Must Change Password: true
  - Idempotent: <boolean>
  ```
- Passwords, emails, and employee numbers are **never** printed by the provisioning application in stdout or stderr.
- When running under npm, use `npm run --silent` (`npm run -s`) to prevent npm from echoing command arguments to the console.
- No `--password` CLI argument exists.
- No `STAFF_PROVISIONING_PASSWORD` environment variable is read.

---

## 4. Central Authorization DAL & Permissions

Access to staff capabilities is controlled exclusively by the server-only Data Access Layer (`src/lib/dal/index.ts`).

### Explicit Capabilities Matrix

Capabilities are strictly enumerated with **zero wildcard `*` permissions**:

| Permission            | `PLATFORM_ADMIN` | `SALES_AGENT` | `OPS_SUPERVISOR` | `FINANCE_OFFICER` |
| :-------------------- | :--------------: | :-----------: | :--------------: | :---------------: |
| `staff:read`          |       Yes        |      Yes      |       Yes        |        Yes        |
| `staff:provision`     |       Yes        |      No       |        No        |        No         |
| `staff:manage_roles`  |       Yes        |      No       |        No        |        No         |
| `audit:read`          |       Yes        |      No       |        No        |        No         |
| `offer_draft:create`  |        No        |      Yes      |        No        |        No         |
| `offer_draft:edit`    |        No        |      Yes      |        No        |        No         |
| `offer_draft:submit`  |        No        |      Yes      |        No        |        No         |
| `offer_draft:review`  |        No        |      No       |       Yes        |        No         |
| `offer_draft:approve` |        No        |      No       |       Yes        |        No         |
| `offer_draft:reject`  |        No        |      No       |       Yes        |        No         |
| `payout:view`         |        No        |      No       |        No        |        Yes        |
| `payout:export`       |        No        |      No       |        No        |        Yes        |
| `ledger:read`         |        No        |      No       |        No        |        Yes        |

> [!IMPORTANT]
> **Separation of Duties:** `PLATFORM_ADMIN` manages platform infrastructure and staff directory governance, but is strictly prohibited from approving offers or triggering financial payouts. Maker (`SALES_AGENT`) and Checker (`OPS_SUPERVISOR`) duties remain completely separated.

### Authorization Invariants:

1. Every protected call resolves the real database session via Better Auth.
2. Checks user suspension (`isSuspended: false`), active membership (`isActive: true`), rotated password (`mustChangePassword: false`), and verified TOTP (`twoFactorEnabled: true` and `twoFactor.verified: true`).
3. Checks active role assignment: roleless staff or inconsistent state (> 1 active roles) fail closed with HTTP 403.
4. Returns structured HTTP errors:
   - **401 UNAUTHENTICATED**: Missing or invalid session.
   - **403 FORBIDDEN**: Authenticated user lacking permission, unverified MFA, or suspended.
   - **503 SERVICE_UNAVAILABLE**: Database or session resolution failure.

---

## 5. Append-Oriented Security Audit Log

Security audit events are written to `security_audit_events`:

- **Allowlisted Event Types:** `STAFF_PROVISIONED`, `STAFF_ROLE_ASSIGNED`, `STAFF_LOGIN_SUCCEEDED`, `STAFF_LOGIN_FAILED`, `STAFF_ACCESS_DENIED`, `STAFF_PASSWORD_ROTATED`, `STAFF_MFA_ENROLLED`, `STAFF_SESSION_REVOKED`.
- **Privacy & Sanitization:** Metadata is strictly sanitized with zero PII, passwords, OTPs, raw cookies, tokens, or raw IP addresses. Client IPs are stored only as domain-separated HMAC-SHA256 digests (`audit-fingerprint:v1\0<ip>`).
- **Storage Protection:** Anonymous denial events are bounded and deduplicated via an in-memory sliding window and 60-second database lookups to prevent storage exhaustion from unauthenticated network probes.
- **Fail-Closed Semantics:** Denial audit persistence failures do not crash the caller and still deny access; role-assignment audit failures inside transactions roll back the role assignment.
- **Security Notice:** The audit ledger is append-oriented in PostgreSQL, not cryptographically tamper-evident. Tamper-evident hash chaining is planned post-pilot.

---

## 6. Staff Lifecycle States

| State                      | Access Allowed                 | Next Step                                   |
| -------------------------- | ------------------------------ | ------------------------------------------- |
| `PASSWORD_CHANGE_REQUIRED` | Sign out, change password only | Change password → `MFA_ENROLLMENT_REQUIRED` |
| `MFA_ENROLLMENT_REQUIRED`  | Sign out, enable TOTP          | Enable TOTP → `MFA_ENROLLMENT_PENDING`      |
| `MFA_ENROLLMENT_PENDING`   | Sign out, verify TOTP          | Verify TOTP → `ACTIVE`                      |
| `ACTIVE`                   | Staff portal access (per role) | Normal operation                            |
| `SUSPENDED`                | Sign out only                  | Admin must reactivate                       |

**Server-side enforcement:** The Better Auth catch-all route handler enforces these state restrictions. Staff sessions in `PASSWORD_CHANGE_REQUIRED` cannot call TOTP endpoints. Staff in any state cannot disable TOTP.

---

## 7. Staff Suspension

To suspend a staff member, update their membership directly:

```sql
UPDATE "internal_staff_membership" SET "isActive" = false WHERE "employeeNumber" = 'EMP-1002';
```

**Effects:**

- The staff member's lifecycle state becomes `SUSPENDED`.
- They can only sign out; all other operations are blocked.
- Central DAL immediately returns HTTP 403 `FORBIDDEN` for all protected actions.

**Reactivation:**

```sql
UPDATE "internal_staff_membership" SET "isActive" = true WHERE "employeeNumber" = 'EMP-1002';
```

---

## 8. Orphan User Recovery

If provisioning fails after creating the Better Auth user but before creating the staff membership and role assignment, and the compensating cleanup also fails, an **orphan user** is reported:

```text
[Staff Provisioning] CRITICAL [PROVISIONING_COMPENSATION_FAILED] Orphan User ID: <uuid>
```

**Manual remediation:**

```sql
-- Delete orphan records in order
DELETE FROM "session" WHERE "userId" = '<uuid>';
DELETE FROM "account" WHERE "userId" = '<uuid>';
DELETE FROM "user" WHERE "id" = '<uuid>';
```

---

## 7. MFA Reset (Two-Person Admin Reset)

If a staff member loses their TOTP device and all backup codes:

1. Two administrators must approve the reset.
2. Delete the staff member's TOTP record:
   ```sql
   DELETE FROM "twoFactor" WHERE "userId" = '<user-id>';
   UPDATE "user" SET "twoFactorEnabled" = false WHERE "id" = '<user-id>';
   ```
3. The staff member logs in and is redirected to `MFA_ENROLLMENT_REQUIRED`.
4. They complete TOTP enrollment with a new device.

---

## 8. Rate Limiting

**IP-based:** 20 login attempts per 15 minutes per IP address.
**Account-based:** 5 login attempts per 15 minutes per email (HMAC-hashed with `STAFF_LOGIN_HMAC_KEY`).

Rate limit buckets are stored in the `rate_limit_bucket` PostgreSQL table using atomic upsert. Buckets auto-expire after the window duration.

**Required environment variable:** `STAFF_LOGIN_HMAC_KEY` (minimum 32 characters, must be distinct from all other HMAC keys).

---

## 9. Required Environment Variables for Staff Auth

| Variable                | Description                           | Required When      |
| ----------------------- | ------------------------------------- | ------------------ |
| `BETTER_AUTH_SECRET`    | Session signing secret (≥32 chars)    | `postgres` backend |
| `BETTER_AUTH_URL`       | Application root URL                  | `postgres` backend |
| `STAFF_LOGIN_HMAC_KEY`  | Email rate-limit HMAC key (≥32 chars) | `postgres` backend |
| `OTP_PEPPER_SECRET`     | OTP pepper (≥32 chars)                | `postgres` backend |
| `PHONE_ALIAS_HMAC_KEY`  | Phone alias HMAC (≥32 chars)          | `postgres` backend |
| `PHONE_LOOKUP_HMAC_KEY` | Phone lookup HMAC (≥32 chars)         | `postgres` backend |

All five HMAC/secret keys must be **mutually distinct**. Validation fails closed at startup if any are missing or duplicated.

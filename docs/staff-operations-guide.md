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
- **Privacy & Sanitization:** Metadata is strictly validated against event-specific Zod allowlists, rejecting unexpected keys, free-form text, passwords, OTPs, raw cookies, tokens, and raw IP addresses. Target identifiers are strictly validated against authorized schemas (`staff_membership:<uuid>`, `user:<uuid>`, `role_assignment:<uuid>`, `permission:<domain>:<action>`); arbitrary URLs, scripts, and malformed strings are discarded as `null`. Client IPs are stored only as domain-separated HMAC-SHA256 digests (`audit-fingerprint:v1\0<ip>`) keyed by validated server configuration (`STAFF_LOGIN_HMAC_KEY` or `BETTER_AUTH_SECRET`).
- **Storage Protection:** For this MVP, unauthenticated (anonymous) requests do not persist database audit rows, completely eliminating database storage exhaustion risks from unauthenticated network probes or spoofed caller headers (such as `x-forwarded-for`). Authenticated staff denials remain fully audited.
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

## 9. Controlled, Audited Recovery Procedures for Inconsistent Role States

When provisioning encounters an existing membership with abnormal or corrupted role assignments, it fails closed to prevent silent privilege escalation or broken invariants.

> [!CAUTION]
> **Zero Unaudited Privilege Grants:** Direct, manual modification of database tables without auditing is strictly prohibited. Any emergency administrative reconciliation must be executed within a **single atomic transaction** that records the authorized administrator actor ID, the role change, and the corresponding allowlisted `STAFF_ROLE_ASSIGNED` security audit event. Dedicated, audited administrative tooling will be introduced in subsequent milestones (deferred to PR 3).

### A. Zero Active Roles (`STAFF_ROLE_RECONCILIATION_REQUIRED`)

- **Condition:** An `InternalStaffMembership` exists for the user and employee number, but `internal_role_assignments` contains 0 active roles (`isActive: true`).
- **Cause:** Manual role deactivation, incomplete administrative change, or legacy migration gap.
- **Audited Recovery Procedure:**
  1. A platform administrator investigates the staff member's approved employment authorization and department.
  2. The administrator executes a single controlled transaction inserting the single approved role and the mandatory audit event:
     ```sql
     BEGIN;

     -- 1. Insert exactly one active role assignment
     INSERT INTO "internal_role_assignments" (
       "id", "staffMembershipId", "role", "isActive", "assignedBy", "assignedAt", "createdAt", "updatedAt"
     ) VALUES (
       gen_random_uuid(),
       '<membership-id>',
       'OPS_SUPERVISOR',
       true,
       '<admin-employee-number>',
       NOW(),
       NOW(),
       NOW()
     );

     -- 2. Concurrently record the mandatory audit event within the same transaction
     INSERT INTO "security_audit_events" (
       "id", "actorUserId", "eventType", "targetEntity", "ipFingerprint", "metadata", "timestamp"
     ) VALUES (
       gen_random_uuid(),
       '<admin-user-id>',
       'STAFF_ROLE_ASSIGNED',
       'staff_membership:<membership-id>',
       NULL,
       jsonb_build_object(
         'action', 'ASSIGN_ROLE',
         'role', 'OPS_SUPERVISOR',
         'assignedBy', '<admin-employee-number>'
       ),
       NOW()
     );

     COMMIT;
     ```
  3. Re-running `npm run staff:provision` with matching identity and role attributes will then complete idempotently.

### B. Multiple Active Roles (`STAFF_MULTIPLE_ACTIVE_ROLES`)

- **Condition:** An `InternalStaffMembership` has more than 1 active role (`isActive: true`).
- **Cause:** Direct database manipulation or concurrency anomaly violating the single-role invariant.
- **Audited Recovery Procedure:**
  1. Read-only review of currently active roles:
     ```sql
     SELECT id, role, "assignedAt", "assignedBy"
     FROM "internal_role_assignments"
     WHERE "staffMembershipId" = '<membership-id>' AND "isActive" = true;
     ```
  2. Execute a single controlled transaction deactivating superseded roles and recording the audit event:
     ```sql
     BEGIN;

     -- 1. Mark superseded / outdated roles inactive
     UPDATE "internal_role_assignments"
     SET "isActive" = false, "updatedAt" = NOW()
     WHERE "staffMembershipId" = '<membership-id>'
       AND "id" != '<approved-single-role-assignment-id>'
       AND "isActive" = true;

     -- 2. Concurrently record the mandatory audit event within the same transaction
     INSERT INTO "security_audit_events" (
       "id", "actorUserId", "eventType", "targetEntity", "ipFingerprint", "metadata", "timestamp"
     ) VALUES (
       gen_random_uuid(),
       '<admin-user-id>',
       'STAFF_ROLE_ASSIGNED',
       'staff_membership:<membership-id>',
       NULL,
       jsonb_build_object(
         'action', 'ASSIGN_ROLE',
         'role', '<approved-role>',
         'previousRole', '<revoked-role>',
         'assignedBy', '<admin-employee-number>'
       ),
       NOW()
     );

     COMMIT;
     ```
  3. Re-run provisioning to verify idempotent resolution.

### C. Ambiguous Transaction State (`PROVISIONING_AMBIGUOUS_STATE`)

- **Condition:** A network timeout, database disconnect, or indeterminate error occurred during provisioning where transaction outcome is unconfirmed or was in flight.
- **State Preservation Invariant:** The provisioning engine strictly **preserves** all database rows and never issues automated cascade deletions on indeterminate state. An immediate "no rows found" query is never treated as proof of rollback.
- **Read-Only Inspection & Resolution:**
  1. Inspect the state using the reported `createdUserId`:
     ```sql
     SELECT u.id, m.id as membership_id, m."employeeNumber", r.role, r."isActive"
     FROM "user" u
     LEFT JOIN "internal_staff_membership" m ON m."userId" = u.id
     LEFT JOIN "internal_role_assignments" r ON r."staffMembershipId" = m.id
     WHERE u.id = '<createdUserId>';
     ```
  2. If the records are complete and valid, re-running provisioning with identical attributes will succeed idempotently without modifying state.
  3. If partial records exist (e.g. membership exists but role assignment is missing), complete the missing record within an audited transaction under an authorized change ticket before retrying.

---

## 10. MFA Reset (Two-Person Admin Reset)

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

## 11. Rate Limiting

**IP-based:** 20 login attempts per 15 minutes per IP address.
**Account-based:** 5 login attempts per 15 minutes per email (HMAC-hashed with `STAFF_LOGIN_HMAC_KEY`).

Rate limit buckets are stored in the `rate_limit_bucket` PostgreSQL table using atomic upsert. Buckets auto-expire after the window duration.

**Required environment variable:** `STAFF_LOGIN_HMAC_KEY` (minimum 32 characters, must be distinct from all other HMAC keys).

---

## 12. Required Environment Variables for Staff Auth

| Variable                | Description                           | Required When      |
| ----------------------- | ------------------------------------- | ------------------ |
| `BETTER_AUTH_SECRET`    | Session signing secret (≥32 chars)    | `postgres` backend |
| `BETTER_AUTH_URL`       | Application root URL                  | `postgres` backend |
| `STAFF_LOGIN_HMAC_KEY`  | Email rate-limit HMAC key (≥32 chars) | `postgres` backend |
| `OTP_PEPPER_SECRET`     | OTP pepper (≥32 chars)                | `postgres` backend |
| `PHONE_ALIAS_HMAC_KEY`  | Phone alias HMAC (≥32 chars)          | `postgres` backend |
| `PHONE_LOOKUP_HMAC_KEY` | Phone lookup HMAC (≥32 chars)         | `postgres` backend |

All five HMAC/secret keys must be **mutually distinct**. Validation fails closed at startup if any are missing or duplicated.

---

## 13. Provider & Branch Onboarding & Activation Runbook (PR 3A)

### 13.1 Product Scope and Operational Meaning

- **Backend Foundation Only**: PR 3A establishes the multi-tenant backend onboarding and compliance foundation, not a completed Sales UI. A thin bilingual (Arabic / English) Sales and Operations UI slice is the immediate follow-up required before field sales agents onboard merchant workshops.
- **Vetted vs. Customer-Published**: In PR 3A, `ACTIVE` status means Operations has successfully vetted and approved the entity's compliance and physical readiness. It does **not** mean the workshop is published to consumers. Customer discovery and offer activation occur in PR 3B and PR 4.
- **Cairo Cluster Selection**: Greater Cairo clusters (`NASR_CITY_HELIOPOLIS`, `NEW_CAIRO`, `MAADI`, `OCTOBER_ZAYED`) are captured as structured merchant data. Provider activation requires at least one individually approved branch in any valid Cairo cluster; launch-zone prioritization follows aggregate workshop density evidence.

### 13.2 Ownership, Roles, and Maker-Checker Dual Custody

- **Sales Agents (`SALES_AGENT`)**: Responsible for data capture.
  - Can create provider organization drafts and branch drafts.
  - Can edit drafts while in `DRAFT` status only.
  - Can submit completed drafts for Operations review.
  - **Cannot** review, activate, or reject providers or branches.
- **Operations Supervisors (`OPS_SUPERVISOR`)**: Responsible for due diligence, physical verification, and compliance approval.
  - Reviews pending submissions in the review queue (`/api/v1/staff/ops/providers/pending`).
  - Vets and activates or rejects each physical workshop branch **individually**.
  - Activates, pauses, resumes, or rejects provider organizations and branches.
  - **Cannot** submit provider drafts.
- **Maker-Checker Segregation Invariant**: An Operations supervisor cannot vet/activate a branch or activate a provider if they submitted the record (`submittedByUserId`). Self-activation is blocked with HTTP 403 `MAKER_CHECKER_VIOLATION`.

### 13.3 Per-Branch Vetting Checklist & Opaque Evidence Document Reference

Operations must vet each workshop location individually before the parent organization can be activated. The following checks are verified and immutably recorded in the database:

1. **Legal Identity Verification (`legalIdentityChecked: true`)**: Confirm workshop commercial documentation, Tax ID (9 digits), and Commercial Registry (CR) match government records.
2. **Physical Location Inspection (`physicalLocationChecked: true`)**: Verify workshop existence, street address, and geographic coordinates within Greater Cairo (Latitude: `29.75` to `30.35`, Longitude: `31.05` to `31.75`).
3. **Contact & Operating Hours (`contactAndHoursChecked: true`)**: Verify direct reachable phone number (`+20...`) and weekly operating hours schedule.
4. **Opaque Evidence Reference (`evidenceDocumentRef`)**:
   - Recorded with the reviewer's staff user ID (`vettedByUserId`) and timestamp (`vettedAt`).
   - **Strict Formatting Invariant**: Must be an opaque alphanumeric identifier matching `/^[A-Za-z0-9_-]{3,64}$/` (e.g. `DOC-EGY-2026-0914-01`, `TICKET_98765`, `EVID-001`). URLs (`https://...`), filesystem paths (`/var/...`, `C:\...`), contact info (`email@...`), and free-text notes with whitespace are strictly rejected by input validation.
   - **Storage Privacy**: Kept **strictly** inside the access-controlled `provider_branches` database table. It is **omitted from `security_audit_events.metadata`** to maintain audit privacy boundaries.

Endpoint: `POST /api/v1/staff/ops/providers/:id/branches/:branchId/activate`

### 13.4 State Machine Transitions & Invariant Matrix

#### Provider Organization Lifecycle

| From Status      | To Status        | Allowed Actor    | Trigger Action                                         | Invariants & Requirements                                                                                  |
| :--------------- | :--------------- | :--------------- | :----------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| `[None]`         | `DRAFT`          | `SALES_AGENT`    | `POST /providers`                                      | Valid Cairo cluster, tax ID, CR, contact info. Version = 1.                                                |
| `DRAFT`          | `DRAFT`          | `SALES_AGENT`    | `PATCH /providers/:id`                                 | Valid CAS version match (`expectedVersion`). Fields updated.                                               |
| `DRAFT`          | `PENDING_REVIEW` | `SALES_AGENT`    | `POST /providers/:id/submit`                           | Requires at least 1 branch in `DRAFT`. Sets `submittedByUserId`.                                           |
| `PENDING_REVIEW` | `DRAFT`          | `OPS_SUPERVISOR` | `POST /ops/providers/:id/reject` (`remediable: true`)  | Maker-checker checked. Atomically resets all active branch approvals to `DRAFT` and clears vetting fields. |
| `PENDING_REVIEW` | `REJECTED`       | `OPS_SUPERVISOR` | `POST /ops/providers/:id/reject` (`remediable: false`) | **Terminal**. Maker-checker checked. Atomically decommissions all branches. Permanent; no edits allowed.   |
| `PENDING_REVIEW` | `ACTIVE`         | `OPS_SUPERVISOR` | `POST /ops/providers/:id/activate`                     | Maker-checker checked. **Requires at least 1 branch individually vetted and `ACTIVE`**.                    |
| `ACTIVE`         | `PAUSED`         | `OPS_SUPERVISOR` | `POST /ops/providers/:id/pause`                        | Allowlisted reason code required. Branches remain as is, but operational availability becomes false.       |
| `PAUSED`         | `ACTIVE`         | `OPS_SUPERVISOR` | `POST /ops/providers/:id/resume`                       | CAS version match. Restores parent availability.                                                           |

#### Provider Branch Lifecycle

| From Status        | To Status        | Allowed Actor    | Trigger Action                                                       | Invariants & Requirements                                                                                                                |
| :----------------- | :--------------- | :--------------- | :------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `[None]`           | `DRAFT`          | `SALES_AGENT`    | `POST /providers/:id/branches`                                       | Parent must be `DRAFT`. Unique `branchCode` per provider. Greater Cairo bounding box.                                                    |
| `DRAFT`            | `DRAFT`          | `SALES_AGENT`    | `PATCH /providers/:id/branches/:bid`                                 | Parent must be `DRAFT`. Branch must be `DRAFT`. CAS version check.                                                                       |
| `DRAFT`            | `ACTIVE`         | `OPS_SUPERVISOR` | `POST /ops/providers/:id/branches/:bid/activate`                     | Parent must be `PENDING_REVIEW` or `ACTIVE`. Maker-checker checked. Full vetting checklist confirmed + opaque evidence ref.              |
| `DRAFT` / `ACTIVE` | `DRAFT`          | `OPS_SUPERVISOR` | `POST /ops/providers/:id/branches/:bid/reject` (`remediable: true`)  | Maker-checker checked. Vetting fields cleared. **Atomically returns parent provider to `DRAFT`** and invalidates other branch approvals. |
| `DRAFT` / `ACTIVE` | `DECOMMISSIONED` | `OPS_SUPERVISOR` | `POST /ops/providers/:id/branches/:bid/reject` (`remediable: false`) | **Terminal**. Maker-checker checked. Physical location permanently decommissioned; cannot be edited or activated.                        |
| `ACTIVE`           | `PAUSED`         | `OPS_SUPERVISOR` | `POST /ops/providers/:id/branches/:bid/pause`                        | Allowlisted reason code required. Suspends branch operational availability.                                                              |
| `PAUSED`           | `ACTIVE`         | `OPS_SUPERVISOR` | `POST /ops/providers/:id/branches/:bid/resume`                       | Restores branch operational availability (if parent is `ACTIVE`).                                                                        |

### 13.5 Atomic Invalidation on Return-to-Draft & Stale Approval Protection

- **No Stale Vetting Invariant**: A workshop branch approval must **never** survive a provider return-to-draft and be reused after Sales modifies records.
- **Atomic Invalidation**: Whenever Operations returns a provider to `DRAFT`—either by rejecting the provider with `remediable: true` or by rejecting an individual branch with `remediable: true`:
  1. The parent provider returns to `DRAFT`.
  2. All prior active branch approvals are atomically invalidated (`status: 'DRAFT'`).
  3. All vetting fields on affected branches are cleared: `legalIdentityChecked = false`, `physicalLocationChecked = false`, `contactAndHoursChecked = false`, `evidenceDocumentRef = null`, `vettedByUserId = null`, `vettedAt = null`.
  4. Branches become editable drafts.
- **Provider Activation Guard**: Provider activation strictly checks `status === 'ACTIVE'` on at least one branch. Because approvals are wiped upon return-to-draft, Operations **cannot activate the organization using stale branch vetting** (`ACTIVE_BRANCH_REQUIRED` -> HTTP 422). Every branch must be vetted afresh after resubmission.

### 13.6 Actionable Sales Correction Path & Terminal Semantics

- **Remediable Branch Rejection**: When Operations rejects a branch with `remediable: true`, both the branch and its parent provider move to `DRAFT`. The rejection reason is recorded in the branch record. Because the provider is now in `DRAFT`, Sales can invoke `PATCH /api/v1/staff/providers/:id/branches/:branchId` to correct location, contact, or schedule data, and then call `POST /api/v1/staff/providers/:id/submit` to resubmit.
- **Terminal Branch Rejection**: When a branch is rejected with `remediable: false`, its status moves to `DECOMMISSIONED`. It is a permanent operational failure for that specific address. It cannot be edited, activated, or submitted. The parent provider remains under review, but cannot be activated unless at least one valid branch is vetted and active.
- **Draft-Only Sales Protection**: Sales agents may edit records strictly when `status === 'DRAFT'`. Editing active or pending records returns HTTP 422 `INVALID_STATE_TRANSITION`. Post-activation operational changes require pausing the entity and processing through an audited amendment workflow.

### 13.7 Operational Availability Contract

A workshop branch is operationally available to accept customer bookings if and only if **both** the branch and its parent organization are in `ACTIVE` status:

$$\text{isBranchOperationallyAvailable} = (\text{branch.status} = \text{'ACTIVE'}) \land (\text{parent.status} = \text{'ACTIVE'})$$

If either entity is paused, in review, draft, or decommissioned, the branch is unavailable.

### 13.8 Concurrency, Row Locks & Parent-Before-Branch Hierarchy

- **Canonical Lock Ordering**: To eliminate database deadlocks under `Read Committed` transaction isolation, all mutations enforce a strict hierarchy:
  1. Parent provider row is locked first (`SELECT id, status, version, "submittedByUserId" FROM provider_organizations WHERE id = ... FOR UPDATE`).
  2. Child branch row is locked second (`SELECT id, status, version, "providerOrganizationId" FROM provider_branches WHERE id = ... FOR UPDATE`).
- **Atomic Serialization**: Competing requests on the same provider or branches serialize on the parent row lock.
- **Optimistic Concurrency Control (CAS)**: Every mutation verifies `expectedVersion === currentVersion`. Competing or replayed requests reading a stale version roll back and return HTTP 409 `CONCURRENT_MODIFICATION`.

### 13.9 Parent–Branch Ownership Guard

Every endpoint operating on a branch verifies `branch.providerOrganizationId === providerId`. If the branch does not exist or belongs to a different provider organization, the route returns HTTP 404 `BRANCH_NOT_FOUND` before assessing state transitions or maker-checker rules, eliminating cross-tenant confused deputy vectors.

### 13.10 Security Audit Privacy & Allowlisted Metadata

- **Atomic All-or-Nothing Commit**: All database mutations and audit logging (`logAuditEvent`) execute inside the exact same interactive PostgreSQL transaction (`prisma.$transaction`). If audit writing fails, the entire transaction rolls back, guaranteeing zero partial writes or orphaned records.
- **Privacy Protections**:
  - Contact person names, phone numbers, and email addresses are never written to audit metadata.
  - Raw URLs, file paths, and free-text notes are never written to audit metadata.
  - `evidenceDocumentRef` is strictly omitted from audit metadata; it lives exclusively in the access-controlled `provider_branches` table.
  - Rejection and pause reasons in audit metadata are restricted to allowlisted reason codes (`INCOMPLETE_DOCUMENTATION`, `INVALID_TAX_OR_CR`, `UNVERIFIED_LOCATION`, `CONTACT_UNREACHABLE`, `COMPLIANCE_HOLD`, `OPERATIONAL_HOLD`, `OTHER`).

### 13.11 Failure Analysis & Operational Edge Cases

1. **Input Validation Failures**:
   - Preflight Zod schemas reject invalid coordinates, malformed tax IDs, illegal characters in evidence refs, or non-Egyptian phone numbers synchronously before database connection or lock acquisition (HTTP 400 `VALIDATION_ERROR`).
2. **Timeout / Indeterminate Outcomes & Safe Retries**:
   - If a client connection times out or drops while an interactive transaction is in flight, PostgreSQL terminates the backend session and automatically rolls back uncommitted changes.
   - If the transaction successfully committed just prior to network drop, the client's retry with the same `expectedVersion` safely fails with HTTP 409 `CONCURRENT_MODIFICATION`, preventing duplicate mutations.
3. **Process Interruption & Late Response**:
   - If the application server process crashes mid-transaction, PostgreSQL immediately rolls back in-flight transactions upon socket closure.
   - Late responses from stalled queries cannot result in partial database state because Prisma interactive transactions commit atomically.
4. **Audit Write Failure**:
   - When audit logging inside a transaction throws (e.g. disk quota exhaustion or constraint violation), the outer transaction is rolled back completely. Final persistent storage retains zero partial mutations.
5. **No External-Provider Side Effects in PR 3A**:
   - PR 3A operates strictly within internal PostgreSQL data boundaries. No external third-party side-effects (such as SMS dispatch, external payment capture, or webhook delivery) exist in this PR. All operational and security guarantees are database-transactional.

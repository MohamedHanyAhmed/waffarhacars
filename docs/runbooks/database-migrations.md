# Database Migration & Schema Operations Runbook

**Document ID:** `docs/runbooks/database-migrations.md`  
**Target Runtime:** Node.js 24 LTS, Prisma 7, PostgreSQL 17  
**Scope:** Schema migration lifecycle, development workflow, CI/CD deployment, forward-fix procedures, failed-migration recovery, and disaster recovery responsibilities.

---

## 1. Overview & PR 1 Baseline State

In **PR 1 (Database Foundation & Health Infrastructure)**, the database infrastructure is established using:

- Modern Prisma 7 TypeScript configuration (`prisma.config.ts`).
- Output path configured at `src/generated/prisma` (generated reproducibly via `npm run prisma:generate`, ignored in version control).
- Model-free baseline schema targeting PostgreSQL 17 without artificial dummy tables (no synthetic metadata or healthcheck tables).
- PostgreSQL driver adapter (`@prisma/adapter-pg`) with connection pooling (`pg.Pool`).
- Sanitized health probes (`/api/live` and `/api/ready`).
- Explicit `npm run prisma:validate` gate.

> [!NOTE]
> Application domain entities (`identities`, `sessions`, `customer_profiles`, `audit_log`, etc.) will arrive in **PR 2 (Identity, Sessions, MFA & RBAC)**. The `prisma/migrations` directory contains only a baseline `.gitkeep` until genuine domain models are introduced.

---

## 2. Environment Variables & Connection Roles

WaffarhaCars enforces strict segregation between runtime connection pooling and direct migration connections:

| Variable                         | Scope     | Purpose                                                              | Example                                 |
| :------------------------------- | :-------- | :------------------------------------------------------------------- | :-------------------------------------- |
| `APP_RUNTIME_PROFILE`            | Runtime   | Environment profile: `showcase` or `production` (No silent defaults) | `showcase`                              |
| `APP_DATA_BACKEND`               | Runtime   | Data backend: `demo` or `postgres` (No silent defaults)              | `postgres`                              |
| `DATABASE_URL`                   | Runtime   | Pooled runtime connection URL for Prisma Client / Route Handlers     | `postgresql://user:pass@pooler:5432/db` |
| `DATABASE_DIRECT_URL`            | Toolchain | Direct, unpooled connection URL required for `prisma migrate`        | `postgresql://user:pass@host:5432/db`   |
| `DATABASE_POOL_MAX`              | Runtime   | Maximum active pooled connections (1–100, default 10)                | `10`                                    |
| `DATABASE_CONNECTION_TIMEOUT_MS` | Runtime   | Connection acquisition timeout in ms (250–60000, default 5000)       | `5000`                                  |
| `DATABASE_IDLE_TIMEOUT_MS`       | Runtime   | Idle client eviction timeout in ms (1000–300000, default 10000)      | `10000`                                 |
| `DATABASE_STATEMENT_TIMEOUT_MS`  | Runtime   | Statement timeout in ms (250–60000, default 5000)                    | `5000`                                  |

### Connection Segregation Rules:

1. **Application Runtime (`DATABASE_URL`):** Used by `pg.Pool` and `@prisma/adapter-pg` in application Route Handlers. In production, this typically routes through a transaction connection pooler (e.g. PgBouncer / Supabase Supavisor).
2. **Migrations & DDL (`DATABASE_DIRECT_URL`):** Required by `prisma.config.ts` for all `prisma migrate` operations. Migration operations require session-level locking, advisory locks, and DDL transaction semantics that fail under transaction-mode poolers.

---

## 3. Local Development Workflow

### 3.1 Managing the Disposable Local Test Database

Developers manage a local, disposable PostgreSQL 17 container using dedicated npm scripts:

- **Start test database:**

  ```bash
  npm run db:test:up
  ```

  _(Launches PostgreSQL 17.4-alpine in background, waiting until healthy on port 5432.)_

- **Stop and wipe test database:**
  ```bash
  npm run db:test:down
  ```
  _(Stops the test container and completely removes attached volumes.)_

### 3.2 Schema Authoring with `prisma migrate dev`

When adding or altering models in development:

1. Update `prisma/schema.prisma`.
2. Validate syntax:
   ```bash
   npm run prisma:validate
   ```
3. Run the interactive development migration workflow:
   ```bash
   npx prisma migrate dev --name <descriptive_change_name>
   ```
   - Prisma compares the schema against the shadow database.
   - Generates a new timestamped migration directory under `prisma/migrations/` containing `migration.sql`.
   - Applies the SQL migration to your local database.
   - Executes `prisma generate` to update `src/generated/prisma`.
4. Review the generated SQL script manually before committing.

> [!WARNING]
> **Prohibition of `prisma db push` for Deployments:**
> `prisma db push` bypasses the migration history table (`_prisma_migrations`) and mutates the database schema directly without producing reproducible, audited SQL scripts. `prisma db push` is strictly forbidden in CI, staging, and production pipelines.

---

## 4. Production & CI Deployment Workflow

In automated CI and production environments, migrations are never applied automatically during web process startup. They are executed in a dedicated, isolated deployment step.

### 4.1 Automated Verification in CI

The CI pipeline executes the following sequential database verification steps:

1. `npm run prisma:validate` — Verifies schema syntax and constraints.
2. `npm run prisma:generate` — Generates Prisma Client into `src/generated/prisma`.
3. `npm run prisma:migrate:deploy` — Applies any pending migrations recorded in `prisma/migrations/`.
4. `npm run prisma:migrate:status` — Verifies that all migrations are recorded as applied in `_prisma_migrations` and no schema drift exists.
5. `npm run test:integration` — Executes real Node.js integration tests against the live PostgreSQL 17 container.

### 4.2 Production Deployment Command

To deploy pending migrations in production:

```bash
DATABASE_DIRECT_URL="<direct-connection-string>" npm run prisma:migrate:deploy
```

---

## 5. Migration Immutability & Expand/Contract Design

### 5.1 Immutability of Committed Migration Files

Once a migration file in `prisma/migrations/<timestamp>_<name>/migration.sql` has been merged into `main` or applied to staging/production, **it is immutable**.

- Never edit, rename, or re-order committed migration files.
- Modifying a committed migration changes its SHA-256 checksum, causing Prisma Migrate to detect a checksum mismatch error (`P3008: The migration has been modified`) and halt all future deployments.

### 5.2 Expand / Contract Pattern (Zero-Downtime Schema Changes)

Every database change must be backward-compatible with the currently running application code:

1. **Phase 1 (Expand):** Add new columns as nullable, add new tables, or create parallel columns. Application code is deployed to read from the old schema and optionally write to both old and new columns.
2. **Phase 2 (Backfill):** Run a data backfill script to populate new columns from historical data.
3. **Phase 3 (Contract):** Deploy application code that reads and writes exclusively to the new columns. Once verified, deploy a subsequent migration to drop deprecated columns or enforce `NOT NULL` constraints.

---

## 6. Forward-Fix & Failure Recovery Procedures

### 6.1 Forward-Fix Policy

Prisma does not provide automatic general-purpose rollback. When an applied migration causes application errors in production:

- **Default Resolution:** **Forward-Fix.** Author, review, and deploy a compensating forward migration that corrects the issue.
- **Data Loss Warning:** Never assume that compensating migrations can restore deleted columns or dropped tables. Dropping data is irreversible; compensating migrations can only re-create schema structures, not recover destroyed data records.

### 6.2 Investigating Failed Migrations

If `prisma migrate deploy` fails mid-execution (e.g. DDL timeout, lock acquisition failure, or constraint violation):

1. Inspect the migration status:
   ```bash
   DATABASE_DIRECT_URL="<url>" npm run prisma:migrate:status
   ```
   Prisma will identify the specific migration that marked as failed in `_prisma_migrations` (`finished_at` is NULL, `logs` contains the database error).
2. Inspect the remote PostgreSQL server logs to determine root cause (e.g., deadlocks, lock timeouts, insufficient privileges).
3. Connect to the database directly via `psql` with an administrative role to inspect whether parts of the failed SQL script committed.

### 6.3 Using `prisma migrate resolve`

> [!CAUTION]
> **Scope of `prisma migrate resolve`:**
> `prisma migrate resolve` is designed **only for resolving migrations that are currently marked as failed** in `_prisma_migrations`. It does not roll back database schema changes or alter SQL files.

- **Scenario A: Rolling Back a Failed Migration (`--rolled-back`)**
  If the failed migration's SQL statements either rolled back automatically (or were manually cleaned up in the database via `psql`), mark the migration as rolled back:

  ```bash
  DATABASE_DIRECT_URL="<url>" npx prisma migrate resolve --rolled-back "<failed-migration-name>"
  ```

  This updates `_prisma_migrations` so the migration can be retried on the next deployment once fixed.

- **Scenario B: Marking as Applied (`--applied`)**
  If the failed migration failed partially, but an engineer manually executed the remaining SQL statements directly on the database to reach the desired state:
  ```bash
  DATABASE_DIRECT_URL="<url>" npx prisma migrate resolve --applied "<failed-migration-name>"
  ```
  This marks the migration record as successfully applied so Prisma will not attempt to execute it again.

---

## 7. Disaster Recovery & Backup Responsibilities

### 7.1 Pre-Deployment Backup Requirement

Automated backups and Point-In-Time Recovery (PITR) are **deployment prerequisites, not assumed features**. Before executing any major migration in staging or production:

1. **Verify Backup Recency:** Confirm that an automated backup or continuous WAL archive completed within the last 15 minutes.
2. **Snapshot Creation:** For high-risk schema operations (e.g. index rebuilds, column type alterations), trigger a manual on-demand snapshot prior to triggering `prisma migrate deploy`.

### 7.2 Restoration Ownership & Point-In-Time Recovery (PITR)

- **Infrastructure Responsibility:** The Database Reliability / Infrastructure team owns automated backup verification, WAL retention policies, and restoring PostgreSQL database instances from PITR snapshots.
- **Application Responsibility:** The Application Engineering team owns schema forward-fixing, running data consistency verification scripts, and executing post-restoration health checks (`/api/live` and `/api/ready`).

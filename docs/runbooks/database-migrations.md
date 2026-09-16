# Database Migration Runbook (Prisma 7 & PostgreSQL 17)

**Document ID:** `docs/runbooks/database-migrations.md`  
**Target Runtime:** Node.js 24 LTS, Prisma 7, PostgreSQL 17  
**Scope:** Migration lifecycle, verification commands, and rollback procedures.

---

## 1. Overview & PR 1 Baseline State

In **PR 1 (Database Foundation & Health Infrastructure)**, the database infrastructure is established using:

- Modern Prisma 7 TypeScript configuration (`prisma.config.ts`).
- Explicit `prisma-client` output path (`src/generated/prisma`).
- Model-free baseline schema without manufactured dummy tables (e.g. no fake metadata or healthcheck tables).
- PostgreSQL driver adapter (`@prisma/adapter-pg`) with connection pooling.
- Sanitized health probes (`/api/live` and `/api/ready`).

**Notice:** Genuine application domain tables and migrations (`identities`, `sessions`, `customer_profiles`, etc.) will arrive in **PR 2 (Identity, Sessions, MFA & RBAC)**. The migration directory remains clean until domain models are formally introduced.

---

## 2. Environment Variables Contract

| Variable                         | Scope     | Purpose                                                    | Example                               |
| -------------------------------- | --------- | ---------------------------------------------------------- | ------------------------------------- |
| `APP_RUNTIME_PROFILE`            | Runtime   | Application environment mode (`showcase` or `production`)  | `showcase`                            |
| `APP_DATA_BACKEND`               | Runtime   | Authoritative data store (`demo` or `postgres`)            | `postgres`                            |
| `DATABASE_URL`                   | Runtime   | Connection pool URL used by Route Handlers & Prisma Client | `postgresql://user:pass@host:5432/db` |
| `DATABASE_DIRECT_URL`            | Toolchain | Direct connection URL for migration operations             | `postgresql://user:pass@host:5432/db` |
| `DATABASE_POOL_MAX`              | Runtime   | Maximum active pooled connections                          | `10`                                  |
| `DATABASE_CONNECTION_TIMEOUT_MS` | Runtime   | Connection acquisition timeout in ms                       | `5000`                                |
| `DATABASE_IDLE_TIMEOUT_MS`       | Runtime   | Idle client eviction timeout in ms                         | `10000`                               |
| `DATABASE_STATEMENT_TIMEOUT_MS`  | Runtime   | Maximum execution time per query in ms                     | `5000`                                |

---

## 3. Local Development & Migration Workflow

### 3.1 Starting the Disposable Test Database

To launch a clean, disposable PostgreSQL 17 test instance locally:

```bash
docker compose -f docker-compose.test.yml up -d
```

To verify connectivity:

```bash
docker compose -f docker-compose.test.yml ps
```

### 3.2 Generating Prisma Client

```bash
npm run prisma:generate
```

The client is generated reproducibly to `src/generated/prisma` and excluded from version control.

### 3.3 Checking Migration Status

```bash
npm run prisma:migrate:status
```

Checks the remote database `_prisma_migrations` ledger against local migration directories.

### 3.4 Applying Migrations in CI / Staging / Production

Migrations are never executed implicitly on application process startup. In production and CI environments, migrations are applied strictly via:

```bash
npm run prisma:migrate:deploy
```

---

## 4. Rollback & Disaster Recovery Procedures

1. **Declarative Backward Compatibility:** Every domain migration must be backward-compatible with the immediately preceding application version (expanding changes precede contracting changes).
2. **Rollback SQL Scripting:** When rolling back a migration, a dedicated compensating forward migration must be reviewed and deployed via `prisma migrate deploy`.
3. **Database Restoration:** For critical data failures, recover using Point-In-Time Recovery (PITR) snapshots from continuous WAL archives.

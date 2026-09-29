import "server-only";
import { z } from "zod";
import { betterAuth } from "better-auth";
import { getAuthOptions } from "@/lib/auth";
import { getPrisma, getPool } from "@/lib/db";
import { Prisma, type StaffDepartment, type StaffRole } from "@/generated/prisma/client";
import { DEPARTMENT_ROLE_MAP, isRoleCompatibleWithDepartment } from "@/lib/dal/permissions";

export class ProvisioningError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProvisioningError";
    this.code = code;
  }
}

export class ProvisioningOperationalError extends Error {
  readonly code: string;
  readonly orphanUserId: string;
  constructor(code: string, orphanUserId: string, message: string) {
    super(message);
    this.name = "ProvisioningOperationalError";
    this.code = code;
    this.orphanUserId = orphanUserId;
  }
}

export const ProvisionStaffSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(128),
  fullName: z.string().min(2).max(100),
  employeeNumber: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, {
      message: "Employee number must be alphanumeric with optional dashes or underscores",
    }),
  department: z.enum(["SALES", "OPERATIONS", "FINANCE", "ADMIN"]),
  role: z.enum(["SALES_AGENT", "OPS_SUPERVISOR", "FINANCE_OFFICER", "PLATFORM_ADMIN"]).optional(),
  isBootstrap: z.boolean().optional(),
});

export type ProvisionStaffInput = z.infer<typeof ProvisionStaffSchema>;

export interface ProvisionStaffResult {
  success: boolean;
  userId: string;
  employeeNumber: string;
  department: StaffDepartment;
  role: StaffRole;
  mustChangePassword: boolean;
  idempotent: boolean;
}

function getProvisioningAuth() {
  return betterAuth(
    getAuthOptions({
      emailAndPassword: {
        enabled: true,
        disableSignUp: false,
        minPasswordLength: 12,
        maxPasswordLength: 128,
      },
    })
  );
}

export const PROVISIONING_LOCK_ID = "7301483920";

export interface ProvisionStaffOptions {
  /**
   * Deterministic test barrier hook executed immediately after acquiring the advisory lock,
   * before running the critical section checks. Allows concurrency tests to force overlapping
   * lock acquisition and assert serialization on the database server.
   */
  _testBarrier?: () => Promise<void>;
  /**
   * Deterministic test hook executed immediately after the Prisma transaction commits,
   * simulating network partition or response acknowledgment loss.
   */
  _testPostCommitError?: boolean;
  /**
   * Deterministic test hook to control commit/reconciliation query ordering.
   * Simulates an in-flight transaction where reconciliation queries execute before
   * the in-flight transaction completes commit on the server.
   */
  _testInFlightCommit?: {
    pauseBeforeCommit: () => Promise<void>;
    waitForPause: () => Promise<void>;
  };
}

function isPositivelyKnownRollback(error: unknown, txCallbackCompleted: boolean): boolean {
  if (txCallbackCompleted) {
    // Callback completed; commit was attempted. Outcome is unknown if an error occurred.
    return false;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const knownRollbackCodes = ["P2002", "P2003", "P2004", "P2034"];
    return knownRollbackCodes.includes(error.code);
  }
  return false;
}

export async function provisionStaffMember(
  input: ProvisionStaffInput,
  options?: ProvisionStaffOptions
): Promise<ProvisionStaffResult> {
  const validated = ProvisionStaffSchema.parse(input);
  const normalizedEmail = validated.email.trim().toLowerCase();
  const normalizedEmployeeNumber = validated.employeeNumber.trim().toUpperCase();
  const department = validated.department as StaffDepartment;
  const isBootstrap = !!validated.isBootstrap;

  let targetRole: StaffRole;
  if (isBootstrap) {
    if (department !== "ADMIN") {
      throw new ProvisioningError(
        "BOOTSTRAP_REQUIRES_ADMIN",
        "Bootstrap mode requires the ADMIN department."
      );
    }
    if (validated.role && validated.role !== "PLATFORM_ADMIN") {
      throw new ProvisioningError(
        "BOOTSTRAP_REQUIRES_ADMIN",
        "Bootstrap mode requires the PLATFORM_ADMIN role."
      );
    }
    targetRole = "PLATFORM_ADMIN";
  } else {
    if (validated.role === "PLATFORM_ADMIN") {
      throw new ProvisioningError(
        "PLATFORM_ADMIN_BOOTSTRAP_ONLY",
        "The PLATFORM_ADMIN role can only be assigned during initial bootstrap."
      );
    }
    targetRole = validated.role || DEPARTMENT_ROLE_MAP[department];
    if (validated.role && !isRoleCompatibleWithDepartment(validated.role, department, false)) {
      throw new ProvisioningError(
        "INCOMPATIBLE_ROLE_DEPARTMENT",
        `Role ${validated.role} is incompatible with department ${department}.`
      );
    }
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    // Acquire dedicated connection-level session advisory lock
    await client.query("SELECT pg_advisory_lock($1::bigint)", [PROVISIONING_LOCK_ID]);

    if (options?._testBarrier) {
      await options._testBarrier();
    }

    const prisma = getPrisma();

    // Preflight check 1: Bootstrap validation
    const totalStaffCount = await prisma.internalStaffMembership.count();
    if (totalStaffCount === 0 && !isBootstrap) {
      throw new ProvisioningError(
        "BOOTSTRAP_REQUIRED",
        "No staff memberships exist. The first staff account must be initialized using bootstrap mode."
      );
    }

    if (isBootstrap && totalStaffCount > 0) {
      throw new ProvisioningError(
        "BOOTSTRAP_ALREADY_INITIALIZED",
        "First admin bootstrap mode is only permitted when zero staff memberships exist."
      );
    }

    // Preflight check 2: Check employee number uniqueness
    const existingByEmp = await prisma.internalStaffMembership.findUnique({
      where: { employeeNumber: normalizedEmployeeNumber },
      include: { user: true },
    });

    // Preflight check 3: Check email uniqueness
    const existingByUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        customerProfile: true,
        internalStaffMembership: true,
      },
    });

    if (existingByUser?.customerProfile) {
      throw new ProvisioningError(
        "CUSTOMER_IDENTITY_COLLISION",
        "A consumer customer account with this email already exists."
      );
    }

    // Idempotency check: if both user and employee number match the exact same record
    if (existingByUser && existingByEmp) {
      if (
        existingByUser.id === existingByEmp.userId &&
        existingByEmp.employeeNumber === normalizedEmployeeNumber &&
        existingByEmp.department === department
      ) {
        const activeRoles = await prisma.internalRoleAssignment.findMany({
          where: { staffMembershipId: existingByEmp.id, isActive: true },
        });

        // Corrupted / roleless state: exactly one active role is required
        if (activeRoles.length === 0) {
          throw new ProvisioningError(
            "STAFF_ROLE_RECONCILIATION_REQUIRED",
            "Staff record has no active role assignment. Manual audit and reconciliation required before re-provisioning."
          );
        }

        if (activeRoles.length > 1) {
          throw new ProvisioningError(
            "STAFF_MULTIPLE_ACTIVE_ROLES",
            "Inconsistent staff state: multiple active role assignments detected. Manual reconciliation required."
          );
        }

        const currentActiveRole = activeRoles[0];
        if (currentActiveRole.role === targetRole) {
          return {
            success: true,
            userId: existingByUser.id,
            employeeNumber: existingByEmp.employeeNumber,
            department: existingByEmp.department,
            role: currentActiveRole.role,
            mustChangePassword: existingByEmp.mustChangePassword,
            idempotent: true,
          };
        }

        throw new ProvisioningError(
          "IDENTITY_CONFLICT",
          `Conflicting active role assignment: staff member currently holds ${currentActiveRole.role}, requested ${targetRole}.`
        );
      }
      throw new ProvisioningError(
        "IDENTITY_CONFLICT",
        "Conflicting staff membership attributes found."
      );
    }

    if (!isBootstrap && department === "ADMIN") {
      throw new ProvisioningError(
        "ORDINARY_ADMIN_DEPARTMENT_FORBIDDEN",
        "Ordinary staff accounts cannot be assigned the ADMIN department."
      );
    }

    if (existingByUser && !existingByEmp) {
      throw new ProvisioningError(
        "EMAIL_ALREADY_IN_USE",
        "A user account with this email address already exists."
      );
    }

    if (!existingByUser && existingByEmp) {
      throw new ProvisioningError(
        "EMPLOYEE_NUMBER_ALREADY_IN_USE",
        "A staff membership with this employee number already exists."
      );
    }

    // Step A: Create credential account via Better Auth server API
    const provisioningAuth = getProvisioningAuth();
    let createdUserId: string | null = null;

    try {
      const signupResult = await provisioningAuth.api.signUpEmail({
        body: {
          email: normalizedEmail,
          password: validated.password,
          name: validated.fullName.trim(),
        },
      });
      createdUserId = signupResult.user.id;
    } catch {
      // If Better Auth threw, check if an unconfirmed identity exists in the database
      const unconfirmed = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });
      if (unconfirmed) {
        // Fail closed without deleting unconfirmed identity; report opaque identifier for manual reconciliation
        throw new ProvisioningOperationalError(
          "PROVISIONING_UNCONFIRMED_IDENTITY",
          unconfirmed.id,
          "Better Auth credential creation returned an error but an identity with this email exists. Manual reconciliation required."
        );
      }
      throw new ProvisioningError(
        "AUTH_ACCOUNT_CREATION_FAILED",
        "Better Auth credential creation failed."
      );
    }

    let txCallbackCompleted = false;

    // Step B: Interactive transaction creating InternalStaffMembership, InternalRoleAssignment, and SecurityAuditEvent
    try {
      const txPromise = prisma.$transaction(async (tx) => {
        const m = await tx.internalStaffMembership.create({
          data: {
            userId: createdUserId!,
            employeeNumber: normalizedEmployeeNumber,
            department,
            isActive: true,
            mustChangePassword: true,
            hiredAt: new Date(),
          },
        });

        const ra = await tx.internalRoleAssignment.create({
          data: {
            staffMembershipId: m.id,
            role: targetRole,
            isActive: true,
            assignedBy: isBootstrap ? "SYSTEM_BOOTSTRAP" : "SYSTEM_PROVISIONING",
          },
        });

        await tx.securityAuditEvent.create({
          data: {
            actorUserId: createdUserId,
            eventType: "STAFF_PROVISIONED",
            targetEntity: `staff_membership:${m.id}`,
            ipFingerprint: null,
            metadata: {
              action: "PROVISION_STAFF",
              department,
              role: targetRole,
              isBootstrap,
            },
          },
        });

        if (options?._testInFlightCommit) {
          await options._testInFlightCommit.pauseBeforeCommit();
        }

        txCallbackCompleted = true;
        return { membership: m, roleAssignment: ra };
      });

      const { membership, roleAssignment } = await (async () => {
        if (options?._testInFlightCommit) {
          await options._testInFlightCommit.waitForPause();
          throw new Error("INDETERMINATE_IN_FLIGHT_TRANSACTION_ERROR");
        }
        return await txPromise;
      })();

      if (options?._testPostCommitError) {
        throw new Error("Simulated connection drop / response loss after transaction commit");
      }

      return {
        success: true,
        userId: createdUserId!,
        employeeNumber: membership.employeeNumber,
        department: membership.department,
        role: roleAssignment.role,
        mustChangePassword: membership.mustChangePassword,
        idempotent: false,
      };
    } catch (txError) {
      // Step C: Reconcile unknown transaction outcomes before compensation.
      // A commit can succeed while its acknowledgment is lost, or remain in flight.
      // Query by the created user ID: return success only for a complete committed state;
      // compensate only when clean absence AND positively known rollback are established;
      // otherwise preserve state and raise an opaque operational reconciliation error.
      // Never delete a committed or in-flight membership through user cascade.

      let reconciledMembership: Awaited<
        ReturnType<typeof prisma.internalStaffMembership.findUnique>
      > = null;
      let reconciledRoles: Awaited<ReturnType<typeof prisma.internalRoleAssignment.findMany>> = [];
      let reconciledAudit: Awaited<ReturnType<typeof prisma.securityAuditEvent.findFirst>> = null;

      try {
        reconciledMembership = await prisma.internalStaffMembership.findUnique({
          where: { userId: createdUserId! },
        });

        if (reconciledMembership) {
          reconciledRoles = await prisma.internalRoleAssignment.findMany({
            where: { staffMembershipId: reconciledMembership.id, isActive: true },
          });
        }

        reconciledAudit = await prisma.securityAuditEvent.findFirst({
          where: {
            actorUserId: createdUserId!,
            eventType: "STAFF_PROVISIONED",
          },
        });
      } catch {
        throw new ProvisioningOperationalError(
          "PROVISIONING_AMBIGUOUS_STATE",
          createdUserId!,
          "Transaction outcome is indeterminate. Staff and user records are preserved for administrative reconciliation."
        );
      }

      // Outcome 1: Complete committed state established -> return success
      if (
        reconciledMembership &&
        reconciledRoles.length === 1 &&
        reconciledRoles[0].role === targetRole &&
        reconciledAudit
      ) {
        return {
          success: true,
          userId: createdUserId!,
          employeeNumber: reconciledMembership.employeeNumber,
          department: reconciledMembership.department,
          role: reconciledRoles[0].role,
          mustChangePassword: reconciledMembership.mustChangePassword,
          idempotent: false,
        };
      }

      // Outcome 2: Clean absence established AND rollback is positively known -> execute compensating cleanup
      const isCompletelyAbsent =
        !reconciledMembership && reconciledRoles.length === 0 && !reconciledAudit;

      const rollbackPositivelyKnown = isPositivelyKnownRollback(txError, txCallbackCompleted);

      if (isCompletelyAbsent && rollbackPositivelyKnown) {
        let compensationSucceeded = false;
        try {
          await prisma.session.deleteMany({ where: { userId: createdUserId! } });
          await prisma.account.deleteMany({ where: { userId: createdUserId! } });
          await prisma.user.delete({ where: { id: createdUserId! } });
          compensationSucceeded = true;
        } catch {
          compensationSucceeded = false;
        }

        if (!compensationSucceeded) {
          throw new ProvisioningOperationalError(
            "PROVISIONING_COMPENSATION_FAILED",
            createdUserId!,
            `Membership creation failed and automated cleanup could not delete created user. Manual remediation required for userId: ${createdUserId}`
          );
        }

        throw new ProvisioningError(
          "MEMBERSHIP_CREATION_FAILED",
          "Membership and role creation failed. Compensating rollback deleted the created auth account."
        );
      }

      // Outcome 3: Indeterminate transaction error or partial state:
      // PRESERVE STATE! Never delete user on indeterminate error or in-flight query.
      throw new ProvisioningOperationalError(
        "PROVISIONING_AMBIGUOUS_STATE",
        createdUserId!,
        "Transaction outcome is indeterminate. Staff and user records are preserved for administrative reconciliation."
      );
    }
  } finally {
    let lockReleased = false;
    try {
      await client.query("SELECT pg_advisory_unlock($1::bigint)", [PROVISIONING_LOCK_ID]);
      lockReleased = true;
    } catch {
      lockReleased = false;
    } finally {
      if (!lockReleased) {
        // If unlock failed, destroy connection so a still-locked connection is never returned to the pool
        client.release(true);
      } else {
        client.release();
      }
    }
  }
}

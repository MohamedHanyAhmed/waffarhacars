import "server-only";
import { z } from "zod";
import { betterAuth } from "better-auth";
import { getAuthOptions } from "@/lib/auth";
import { getPrisma, getPool } from "@/lib/db";
import type { StaffDepartment } from "@/generated/prisma/client";

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
  isBootstrap: z.boolean().optional(),
});

export type ProvisionStaffInput = z.infer<typeof ProvisionStaffSchema>;

export interface ProvisionStaffResult {
  success: boolean;
  userId: string;
  employeeNumber: string;
  department: StaffDepartment;
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

const PROVISIONING_LOCK_ID = "7301483920";

export async function provisionStaffMember(
  input: ProvisionStaffInput
): Promise<ProvisionStaffResult> {
  const validated = ProvisionStaffSchema.parse(input);
  const normalizedEmail = validated.email.trim().toLowerCase();
  const normalizedEmployeeNumber = validated.employeeNumber.trim().toUpperCase();
  const department = validated.department as StaffDepartment;
  const isBootstrap = !!validated.isBootstrap;

  if (isBootstrap && department !== "ADMIN") {
    throw new ProvisioningError(
      "BOOTSTRAP_REQUIRES_ADMIN",
      "Bootstrap mode requires the ADMIN department."
    );
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    // Acquire dedicated connection-level session advisory lock
    await client.query("SELECT pg_advisory_lock($1::bigint)", [PROVISIONING_LOCK_ID]);

    try {
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
          return {
            success: true,
            userId: existingByUser.id,
            employeeNumber: existingByEmp.employeeNumber,
            department: existingByEmp.department,
            mustChangePassword: existingByEmp.mustChangePassword,
            idempotent: true,
          };
        }
        throw new ProvisioningError(
          "IDENTITY_CONFLICT",
          "Conflicting staff membership attributes found."
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
        // Check if user was partially created before Better Auth threw
        const orphaned = await prisma.user.findUnique({
          where: { email: normalizedEmail },
          include: { internalStaffMembership: true },
        });
        if (orphaned && !orphaned.internalStaffMembership) {
          try {
            await prisma.user.delete({ where: { id: orphaned.id } });
          } catch {
            throw new ProvisioningOperationalError(
              "PROVISIONING_COMPENSATION_FAILED",
              orphaned.id,
              "Auth creation failed with orphan user left in database."
            );
          }
        }
        throw new ProvisioningError(
          "AUTH_ACCOUNT_CREATION_FAILED",
          "Better Auth credential creation failed."
        );
      }

      // Step B: Create domain-owned InternalStaffMembership
      try {
        const membership = await prisma.internalStaffMembership.create({
          data: {
            userId: createdUserId,
            employeeNumber: normalizedEmployeeNumber,
            department,
            isActive: true,
            mustChangePassword: true,
            hiredAt: new Date(),
          },
        });

        return {
          success: true,
          userId: createdUserId,
          employeeNumber: membership.employeeNumber,
          department: membership.department,
          mustChangePassword: membership.mustChangePassword,
          idempotent: false,
        };
      } catch {
        // Step C: Compensating transaction - atomic cascade deletion of the created User
        let compensationSucceeded = false;
        try {
          await prisma.user.delete({ where: { id: createdUserId } });
          compensationSucceeded = true;
        } catch {
          compensationSucceeded = false;
        }

        if (!compensationSucceeded) {
          throw new ProvisioningOperationalError(
            "PROVISIONING_COMPENSATION_FAILED",
            createdUserId,
            "Membership creation failed and automated cleanup could not delete created user."
          );
        }

        throw new ProvisioningError(
          "MEMBERSHIP_CREATION_FAILED",
          "Membership record creation failed. Compensating rollback deleted the created auth account."
        );
      }
    } finally {
      await client
        .query("SELECT pg_advisory_unlock($1::bigint)", [PROVISIONING_LOCK_ID])
        .catch(() => {});
    }
  } finally {
    client.release();
  }
}

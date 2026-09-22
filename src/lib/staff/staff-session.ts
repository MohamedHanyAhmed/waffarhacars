import "server-only";
import { getAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import type { StaffDepartment } from "@/generated/prisma/client";

export type StaffLifecycleState =
  | "PROVISIONED"
  | "PASSWORD_CHANGE_REQUIRED"
  | "MFA_ENROLLMENT_REQUIRED"
  | "MFA_ENROLLMENT_PENDING"
  | "ACTIVE"
  | "SUSPENDED";

export interface StaffMembershipDetails {
  id: string;
  userId: string;
  employeeNumber: string;
  department: StaffDepartment;
  isActive: boolean;
  mustChangePassword: boolean;
  hiredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface StaffSessionResult {
  isAuthenticated: boolean;
  isStaff: boolean;
  state: StaffLifecycleState;
  user?: {
    id: string;
    email: string;
    name: string;
    isSuspended: boolean;
    twoFactorEnabled: boolean;
  };
  membership?: StaffMembershipDetails;
  session?: {
    id: string;
    token: string;
    expiresAt: Date;
  };
  canAccessStaffApp: boolean;
  canAccessEnrollment: boolean;
  canAccessPasswordChange: boolean;
  rejectionReason?: string;
}

/**
 * Pure state machine resolver for staff lifecycle states.
 */
export function resolveStaffLifecycleState(params: {
  isSuspended: boolean;
  isActive: boolean;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
  twoFactorVerified?: boolean | null;
  hasTwoFactorSecret?: boolean;
}): StaffLifecycleState {
  const {
    isSuspended,
    isActive,
    mustChangePassword,
    twoFactorEnabled,
    twoFactorVerified,
    hasTwoFactorSecret,
  } = params;

  if (isSuspended || !isActive) {
    return "SUSPENDED";
  }

  if (mustChangePassword) {
    return "PASSWORD_CHANGE_REQUIRED";
  }

  if (!twoFactorEnabled || twoFactorVerified === false) {
    if ((hasTwoFactorSecret || twoFactorEnabled) && twoFactorVerified === false) {
      return "MFA_ENROLLMENT_PENDING";
    }
    return "MFA_ENROLLMENT_REQUIRED";
  }

  if (twoFactorEnabled && twoFactorVerified === true) {
    return "ACTIVE";
  }

  return "SUSPENDED";
}

/**
 * Resolves authenticated session and verifies internal staff membership and lifecycle state.
 */
export async function resolveStaffSession(
  headers: Headers | Record<string, string | string[] | undefined>
): Promise<StaffSessionResult> {
  const auth = getAuth();
  let sessionData;
  try {
    sessionData = await auth.api.getSession({
      headers:
        headers instanceof Headers ? headers : new Headers(headers as Record<string, string>),
    });
  } catch {
    return {
      isAuthenticated: false,
      isStaff: false,
      state: "SUSPENDED",
      canAccessStaffApp: false,
      canAccessEnrollment: false,
      canAccessPasswordChange: false,
      rejectionReason: "SESSION_RESOLUTION_ERROR",
    };
  }

  if (!sessionData || !sessionData.user) {
    return {
      isAuthenticated: false,
      isStaff: false,
      state: "SUSPENDED",
      canAccessStaffApp: false,
      canAccessEnrollment: false,
      canAccessPasswordChange: false,
      rejectionReason: "UNAUTHENTICATED",
    };
  }

  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: sessionData.user.id },
    include: {
      internalStaffMembership: true,
      twofactors: {
        take: 1,
        orderBy: { id: "desc" },
      },
    },
  });

  if (!user || !user.internalStaffMembership) {
    return {
      isAuthenticated: true,
      isStaff: false,
      state: "SUSPENDED",
      user: {
        id: sessionData.user.id,
        email: sessionData.user.email,
        name: sessionData.user.name,
        isSuspended: user?.isSuspended ?? false,
        twoFactorEnabled: !!user?.twoFactorEnabled,
      },
      canAccessStaffApp: false,
      canAccessEnrollment: false,
      canAccessPasswordChange: false,
      rejectionReason: "NOT_STAFF",
    };
  }

  const membership = user.internalStaffMembership;
  const twoFactor = user.twofactors[0] || null;

  const state = resolveStaffLifecycleState({
    isSuspended: user.isSuspended,
    isActive: membership.isActive,
    mustChangePassword: membership.mustChangePassword,
    twoFactorEnabled: !!user.twoFactorEnabled,
    twoFactorVerified: twoFactor ? twoFactor.verified : null,
    hasTwoFactorSecret: !!twoFactor?.secret,
  });

  const canAccessStaffApp = state === "ACTIVE";
  const canAccessEnrollment =
    state === "MFA_ENROLLMENT_REQUIRED" || state === "MFA_ENROLLMENT_PENDING";
  const canAccessPasswordChange = state === "PASSWORD_CHANGE_REQUIRED";

  return {
    isAuthenticated: true,
    isStaff: true,
    state,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuspended: user.isSuspended,
      twoFactorEnabled: !!user.twoFactorEnabled,
    },
    membership: {
      id: membership.id,
      userId: membership.userId,
      employeeNumber: membership.employeeNumber,
      department: membership.department,
      isActive: membership.isActive,
      mustChangePassword: membership.mustChangePassword,
      hiredAt: membership.hiredAt,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
    },
    session: {
      id: sessionData.session.id,
      token: sessionData.session.token,
      expiresAt: sessionData.session.expiresAt,
    },
    canAccessStaffApp,
    canAccessEnrollment,
    canAccessPasswordChange,
    rejectionReason: state === "SUSPENDED" ? "SUSPENDED" : undefined,
  };
}

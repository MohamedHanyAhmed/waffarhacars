import { NextRequest } from "next/server";
import { resolveStaffSession } from "@/lib/staff/staff-session";
import type { StaffAuthStatusResponse } from "@/lib/staff/status-contract";

export async function GET(req: NextRequest): Promise<Response> {
  const staffSession = await resolveStaffSession(req.headers);
  if (staffSession.rejectionReason === "SESSION_RESOLUTION_ERROR") {
    return Response.json(
      {
        error: "SERVICE_UNAVAILABLE",
        message: "Authentication service temporarily unavailable",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!staffSession.isAuthenticated) {
    return Response.json(
      { error: "UNAUTHORIZED", message: "Not authenticated" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!staffSession.isStaff) {
    return Response.json(
      { error: "FORBIDDEN", message: "Not a staff account" },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  const payload: StaffAuthStatusResponse = {
    state: staffSession.state,
    userId: staffSession.user?.id,
    email: staffSession.user?.email,
    name: staffSession.user?.name,
    department: staffSession.membership?.department,
    employeeNumber: staffSession.membership?.employeeNumber,
    mustChangePassword: staffSession.membership?.mustChangePassword,
    twoFactorEnabled: staffSession.user?.twoFactorEnabled,
    canAccessStaffApp: staffSession.canAccessStaffApp,
    canAccessEnrollment: staffSession.canAccessEnrollment,
    canAccessPasswordChange: staffSession.canAccessPasswordChange,
  };

  return Response.json(payload, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

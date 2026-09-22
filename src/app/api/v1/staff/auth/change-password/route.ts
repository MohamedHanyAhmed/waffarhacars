import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { resolveStaffSession } from "@/lib/staff/staff-session";

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12).max(128),
});

export async function POST(req: NextRequest): Promise<Response> {
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return Response.json(
      { error: "INVALID_JSON", message: "Invalid JSON payload" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const parseResult = ChangePasswordSchema.safeParse(bodyJson);
  if (!parseResult.success) {
    return Response.json(
      {
        error: "VALIDATION_ERROR",
        message: "New password must be between 12 and 128 characters long.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { currentPassword, newPassword } = parseResult.data;

  const staffSession = await resolveStaffSession(req.headers);
  if (!staffSession.isAuthenticated) {
    return Response.json(
      { error: "UNAUTHORIZED", message: "Authentication required." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!staffSession.isStaff || !staffSession.membership) {
    return Response.json(
      { error: "FORBIDDEN", message: "Staff membership required." },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (staffSession.state === "SUSPENDED") {
    return Response.json(
      { error: "ACCOUNT_SUSPENDED", message: "Account is suspended." },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  const auth = getAuth();
  let authRes: Response | undefined;
  try {
    authRes = await auth.api.changePassword({
      body: {
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      },
      headers: req.headers,
      asResponse: true,
    });
  } catch {
    return Response.json(
      {
        error: "INVALID_CREDENTIALS",
        message: "Current password does not match or password policy rejected.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!authRes || !authRes.ok) {
    return Response.json(
      {
        error: "INVALID_CREDENTIALS",
        message: "Current password does not match or password policy rejected.",
      },
      { status: authRes?.status ?? 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Update mustChangePassword on domain membership
  const prisma = getPrisma();
  try {
    await prisma.internalStaffMembership.update({
      where: { id: staffSession.membership.id },
      data: { mustChangePassword: false },
    });
  } catch {
    return Response.json(
      {
        error: "MEMBERSHIP_UPDATE_ERROR",
        message: "Password changed, but status update failed. Please retry.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  const responseHeaders = new Headers({
    "Cache-Control": "no-store",
  });
  const cookies = authRes.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) {
    for (const cookie of cookies) {
      responseHeaders.append("set-cookie", cookie);
    }
  } else {
    const rawCookie = authRes.headers.get("set-cookie");
    if (rawCookie) {
      responseHeaders.set("set-cookie", rawCookie);
    }
  }

  return Response.json(
    {
      success: true,
      nextStep: "MFA_ENROLLMENT_REQUIRED",
    },
    {
      status: 200,
      headers: responseHeaders,
    }
  );
}

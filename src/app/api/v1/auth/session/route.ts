import { NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";

export async function GET(req: NextRequest): Promise<Response> {
  let env;
  try {
    env = getServerEnv();
  } catch {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/internal-error",
        title: "Internal Server Error",
        status: 500,
        detail: "Configuration error",
      },
      {
        status: 500,
        headers: { "Content-Type": "application/problem+json", "Cache-Control": "no-store" },
      }
    );
  }

  // 1. Fail closed in showcase demo mode
  if (env.APP_DATA_BACKEND === "demo") {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/service-unavailable",
        title: "Service Unavailable",
        status: 503,
        detail: "Authentication service unavailable in showcase/demo mode",
      },
      {
        status: 503,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  try {
    const auth = getAuth();
    const sessionRes = await auth.api.getSession({
      headers: req.headers,
    });

    if (!sessionRes || !sessionRes.user) {
      return Response.json(
        { authenticated: false },
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const prisma = getPrisma();
    const profile = await prisma.customerProfile.findUnique({
      where: { userId: sessionRes.user.id },
      select: { preferredLanguage: true },
    });

    const userWithPhone = sessionRes.user as Record<string, unknown>;

    return Response.json(
      {
        authenticated: true,
        user: {
          id: sessionRes.user.id,
          name: sessionRes.user.name,
          phoneNumber: (userWithPhone.phoneNumber as string | undefined) || null,
          preferredLanguage: profile?.preferredLanguage || "ar",
        },
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  } catch {
    return Response.json(
      { authenticated: false },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  }
}

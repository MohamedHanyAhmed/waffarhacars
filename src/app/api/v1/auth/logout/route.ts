import { NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { validateRequestOrigin } from "@/lib/security/origin";

export async function POST(req: NextRequest): Promise<Response> {
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

  // 2. Validate trusted origin
  const originCheck = validateRequestOrigin(req);
  if (!originCheck.valid) {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/invalid-origin",
        title: "Invalid Origin",
        status: 403,
        detail: originCheck.reason || "Untrusted request origin",
      },
      {
        status: 403,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  try {
    const auth = getAuth();
    const signOutRes = await auth.api.signOut({
      headers: req.headers,
      asResponse: true,
    });

    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Cache-Control", "no-store");

    const setCookies =
      typeof signOutRes.headers.getSetCookie === "function"
        ? signOutRes.headers.getSetCookie()
        : signOutRes.headers.get("set-cookie")
          ? [signOutRes.headers.get("set-cookie")!]
          : [];

    for (const cookieStr of setCookies) {
      headers.append("Set-Cookie", cookieStr);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers,
    });
  } catch {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/internal-error",
        title: "Logout Error",
        status: 500,
        detail: "Failed to revoke session",
      },
      {
        status: 500,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      }
    );
  }
}

import { getAuth } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import type { NextRequest } from "next/server";

export async function GET(req: NextRequest): Promise<Response> {
  let env;
  try {
    env = getServerEnv();
  } catch {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/configuration-error",
        title: "Configuration Error",
        status: 500,
        detail: "Server configuration error",
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
    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (!session || !session.session || !session.user) {
      return Response.json(
        {
          type: "https://waffarhacars.com/errors/unauthorized",
          title: "Unauthorized",
          status: 401,
          detail: "Authentication required",
        },
        {
          status: 401,
          headers: {
            "Content-Type": "application/problem+json",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    return Response.json(
      { authenticated: true },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/internal-error",
        title: "Internal Error",
        status: 500,
        detail: "Failed to evaluate session",
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

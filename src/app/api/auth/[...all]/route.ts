import { getAuth } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import type { NextRequest } from "next/server";

export async function handleAuth(req: NextRequest): Promise<Response> {
  let env;
  try {
    env = getServerEnv();
  } catch {
    return Response.json(
      { error: "Configuration error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Preserve showcase/demo mode: fail closed with sanitized 503 if running demo backend
  if (env.APP_DATA_BACKEND === "demo") {
    return Response.json(
      { error: "Authentication service unavailable in showcase/demo mode" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  try {
    const auth = getAuth();
    const res = await auth.handler(req);
    const headers = new Headers(res.headers);
    if (!headers.has("Cache-Control")) {
      headers.set("Cache-Control", "no-store");
    }

    const contentType = headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await res.json();
      if (data && typeof data === "object") {
        // Strip session tokens from browser-facing sign-in JSON while preserving HttpOnly Set-Cookie
        if (req.url.includes("/sign-in")) {
          if ("token" in data) {
            delete data.token;
          }
          if (data.session && typeof data.session === "object" && "token" in data.session) {
            delete data.session.token;
          }
        }
        return Response.json(data, {
          status: res.status,
          statusText: res.statusText,
          headers,
        });
      }
    }

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  } catch {
    return Response.json(
      { error: "Authentication service error" },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handleAuth(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handleAuth(req);
}

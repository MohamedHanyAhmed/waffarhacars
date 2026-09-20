import { getAuth } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { sanitizeAuthResponse } from "@/lib/auth-response-sanitizer";
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
    const sanitized = await sanitizeAuthResponse(req, res);
    if (!sanitized.headers.has("Cache-Control")) {
      const headers = new Headers(sanitized.headers);
      headers.set("Cache-Control", "no-store");
      return new Response(sanitized.body, {
        status: sanitized.status,
        statusText: sanitized.statusText,
        headers,
      });
    }
    return sanitized;
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

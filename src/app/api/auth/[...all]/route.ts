import { auth } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import type { NextRequest } from "next/server";

async function handleAuth(req: NextRequest): Promise<Response> {
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
    const res = await auth.handler(req);
    const headers = new Headers(res.headers);
    if (!headers.has("Cache-Control")) {
      headers.set("Cache-Control", "no-store");
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

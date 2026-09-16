import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const env = getServerEnv();

    if (env.APP_DATA_BACKEND === "demo") {
      // In demo mode, if the runtime profile is valid (e.g. showcase), it is ready
      return NextResponse.json(
        { status: "ready" },
        {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    // When backend is postgres, execute a fast ping query
    const prisma = getPrisma();
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      { status: "ready" },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch {
    // Strictly sanitized: never leak connection strings, pool errors, or stack traces
    return NextResponse.json(
      { status: "unavailable" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}

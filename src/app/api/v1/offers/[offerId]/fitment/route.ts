import type { NextRequest } from "next/server";
import { uuid } from "@/lib/fitment/shared";
import { publicCoverageSummary } from "@/lib/fitment/match";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = { "Cache-Control": "no-store, max-age=0" };
export async function GET(_req: NextRequest, context: { params: Promise<{ offerId: string }> }) {
  try {
    const { offerId } = await context.params;
    if (!uuid.safeParse(offerId).success)
      return Response.json({ error: "VALIDATION_ERROR" }, { status: 400, headers });
    const summary = await publicCoverageSummary(offerId);
    if (!summary) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers });
    return Response.json(summary, { headers });
  } catch {
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
  }
}

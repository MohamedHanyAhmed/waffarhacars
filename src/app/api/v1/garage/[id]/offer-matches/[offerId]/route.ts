import type { NextRequest } from "next/server";
import { withVehicleApi, uuid } from "@/lib/vehicle/service";
import { ownerOfferMatch } from "@/lib/fitment/match";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = { "Cache-Control": "no-store, max-age=0" };
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; offerId: string }> }
) {
  return withVehicleApi(req, "customer", async (actor) => {
    const { id: vehicleId, offerId } = await context.params;
    if (!uuid.safeParse(vehicleId).success || !uuid.safeParse(offerId).success)
      return Response.json({ error: "VALIDATION_ERROR" }, { status: 400, headers });
    const match = await ownerOfferMatch(actor!.userId, vehicleId, offerId);
    if (!match) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers });
    return Response.json(match, { headers });
  });
}

import { NextRequest } from "next/server";
import { withOfferApi, assertUuidParam } from "@/lib/offer/http";
import { getOfferForStaff } from "@/lib/offer/service";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ offerId: string }> }
): Promise<Response> {
  return withOfferApi(req, "offer_draft:read", async (actor) => {
    const { offerId } = await context.params;
    return Response.json(await getOfferForStaff(actor, assertUuidParam(offerId)), {
      headers: { "Cache-Control": "no-store" },
    });
  });
}

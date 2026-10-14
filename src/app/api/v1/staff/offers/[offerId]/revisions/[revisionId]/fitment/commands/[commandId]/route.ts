import type { NextRequest } from "next/server";
import { fitmentApi, FitmentError, uuid } from "@/lib/fitment/shared";
import { offerFitmentReceipt } from "@/lib/fitment/offer";
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ offerId: string; revisionId: string; commandId: string }> }
) {
  return fitmentApi(req, "offer_draft:read", async (actor) => {
    const { offerId, revisionId, commandId } = await context.params;
    if (![offerId, revisionId, commandId].every((id) => uuid.safeParse(id).success))
      throw new FitmentError(400, "INVALID_RESOURCE_ID");
    return Response.json(
      { data: await offerFitmentReceipt(actor, offerId, revisionId, commandId) },
      { headers: { "Cache-Control": "no-store" } }
    );
  });
}

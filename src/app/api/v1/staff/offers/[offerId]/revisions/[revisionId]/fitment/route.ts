import type { NextRequest } from "next/server";
import { fitmentApi, parseFitmentBody, uuid } from "@/lib/fitment/shared";
import { OfferFitmentSchema, readOfferFitment, updateOfferFitment } from "@/lib/fitment/offer";
import { FitmentError } from "@/lib/fitment/shared";

type Context = { params: Promise<{ offerId: string; revisionId: string }> };
function ids(value: { offerId: string; revisionId: string }) {
  if (!uuid.safeParse(value.offerId).success || !uuid.safeParse(value.revisionId).success)
    throw new FitmentError(400, "INVALID_RESOURCE_ID");
  return value;
}
export async function GET(req: NextRequest, context: Context) {
  return fitmentApi(req, "offer_draft:read", async (actor) => {
    const { offerId, revisionId } = ids(await context.params);
    return Response.json(
      { data: await readOfferFitment(actor, offerId, revisionId) },
      { headers: { "Cache-Control": "no-store" } }
    );
  });
}
export async function PUT(req: NextRequest, context: Context) {
  return fitmentApi(req, "offer_draft:edit", async (actor) => {
    const { offerId, revisionId } = ids(await context.params);
    const input = await parseFitmentBody(req, OfferFitmentSchema);
    return Response.json(
      { data: await updateOfferFitment(actor, offerId, revisionId, input) },
      { headers: { "Cache-Control": "no-store" } }
    );
  });
}

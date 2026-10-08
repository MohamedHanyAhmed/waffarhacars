import { NextRequest } from "next/server";
import { withOfferApi, parseJson, clientIp } from "@/lib/offer/http";
import { UpdateOfferDraftSchema } from "@/lib/offer/validation";
import { updateOfferDraft } from "@/lib/offer/service";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ offerId: string; revisionId: string }> }
): Promise<Response> {
  return withOfferApi(req, "offer_draft:edit", async (actor) => {
    const { offerId, revisionId } = await context.params;
    const parsed = await parseJson(req, UpdateOfferDraftSchema);
    if (parsed.response) return parsed.response;
    const revision = await updateOfferDraft(actor, offerId, revisionId, parsed.data, clientIp(req));
    return Response.json(revision, { headers: { "Cache-Control": "no-store" } });
  });
}

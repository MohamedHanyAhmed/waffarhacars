import { NextRequest } from "next/server";
import { withOfferApi, parseJson, clientIp, assertUuidParam } from "@/lib/offer/http";
import { RejectOfferSchema } from "@/lib/offer/validation";
import { rejectOfferRevision } from "@/lib/offer/service";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ offerId: string; revisionId: string }> }
): Promise<Response> {
  return withOfferApi(req, "offer_draft:reject", async (actor) => {
    const { offerId, revisionId } = await context.params;
    const parsed = await parseJson(req, RejectOfferSchema);
    if (parsed.response) return parsed.response;
    const revision = await rejectOfferRevision(
      actor,
      assertUuidParam(offerId),
      assertUuidParam(revisionId),
      parsed.data,
      clientIp(req)
    );
    return Response.json(revision, { headers: { "Cache-Control": "no-store" } });
  });
}

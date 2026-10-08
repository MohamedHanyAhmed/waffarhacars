import { NextRequest } from "next/server";
import { withOfferApi, parseJson, clientIp } from "@/lib/offer/http";
import { ApproveOfferSchema } from "@/lib/offer/validation";
import { approveOfferRevision } from "@/lib/offer/service";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ offerId: string; revisionId: string }> }
): Promise<Response> {
  return withOfferApi(req, "offer_draft:approve", async (actor) => {
    const { offerId, revisionId } = await context.params;
    const parsed = await parseJson(req, ApproveOfferSchema);
    if (parsed.response) return parsed.response;
    const revision = await approveOfferRevision(
      actor,
      offerId,
      revisionId,
      parsed.data,
      clientIp(req)
    );
    return Response.json(revision, { headers: { "Cache-Control": "no-store" } });
  });
}

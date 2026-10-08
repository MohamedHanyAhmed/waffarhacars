import { NextRequest } from "next/server";
import { withOfferApi, parseJson, clientIp, assertUuidParam } from "@/lib/offer/http";
import { SubmitOfferSchema } from "@/lib/offer/validation";
import { submitOfferRevision } from "@/lib/offer/service";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ offerId: string; revisionId: string }> }
): Promise<Response> {
  return withOfferApi(req, "offer_draft:submit", async (actor) => {
    const { offerId, revisionId } = await context.params;
    const parsed = await parseJson(req, SubmitOfferSchema);
    if (parsed.response) return parsed.response;
    const revision = await submitOfferRevision(
      actor,
      assertUuidParam(offerId),
      assertUuidParam(revisionId),
      parsed.data.expectedVersion,
      clientIp(req)
    );
    return Response.json(revision, { headers: { "Cache-Control": "no-store" } });
  });
}

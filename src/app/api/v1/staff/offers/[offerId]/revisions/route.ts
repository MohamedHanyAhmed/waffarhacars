import { NextRequest } from "next/server";
import { withOfferApi, parseJson, clientIp } from "@/lib/offer/http";
import { CreateOfferRevisionSchema } from "@/lib/offer/validation";
import { createOfferRevision } from "@/lib/offer/service";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ offerId: string }> }
): Promise<Response> {
  return withOfferApi(req, "offer_draft:create", async (actor) => {
    const { offerId } = await context.params;
    const parsed = await parseJson(req, CreateOfferRevisionSchema);
    if (parsed.response) return parsed.response;
    const revision = await createOfferRevision(
      actor,
      offerId,
      parsed.data.requestId,
      clientIp(req)
    );
    return Response.json(revision, { status: 201, headers: { "Cache-Control": "no-store" } });
  });
}

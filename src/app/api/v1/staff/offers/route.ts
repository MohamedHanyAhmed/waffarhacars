import { NextRequest } from "next/server";
import { withOfferApi, parseJson, clientIp } from "@/lib/offer/http";
import { isOfferRevisionStatus, listOffersForStaff, createOfferDraft } from "@/lib/offer/service";
import { CreateOfferSchema } from "@/lib/offer/validation";

export async function GET(req: NextRequest): Promise<Response> {
  return withOfferApi(req, "offer_draft:read", async (actor) => {
    const statusValue = new URL(req.url).searchParams.get("status");
    if (statusValue && !isOfferRevisionStatus(statusValue)) {
      return Response.json(
        { error: "VALIDATION_ERROR", message: "Invalid offer status filter." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    const offers = await listOffersForStaff(
      actor,
      statusValue && isOfferRevisionStatus(statusValue) ? statusValue : undefined
    );
    return Response.json(offers, { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withOfferApi(req, "offer_draft:create", async (actor) => {
    const parsed = await parseJson(req, CreateOfferSchema);
    if (parsed.response) return parsed.response;
    const result = await createOfferDraft(actor, parsed.data, clientIp(req));
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  });
}

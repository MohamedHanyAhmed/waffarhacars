import { NextRequest } from "next/server";
import { withOfferApi } from "@/lib/offer/http";
import { listPendingOfferRevisions } from "@/lib/offer/service";

export async function GET(req: NextRequest): Promise<Response> {
  return withOfferApi(req, "offer_draft:review", async () =>
    Response.json(await listPendingOfferRevisions(), { headers: { "Cache-Control": "no-store" } })
  );
}

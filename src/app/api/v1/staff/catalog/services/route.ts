import { NextRequest } from "next/server";
import { withOfferApi } from "@/lib/offer/http";
import { listServiceCatalog } from "@/lib/offer/service";

export async function GET(req: NextRequest): Promise<Response> {
  return withOfferApi(req, "service_catalog:read", async (actor) =>
    Response.json(await listServiceCatalog(actor), { headers: { "Cache-Control": "no-store" } })
  );
}

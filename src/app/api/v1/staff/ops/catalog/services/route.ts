import { NextRequest } from "next/server";
import { withOfferApi, parseJson, clientIp } from "@/lib/offer/http";
import { CreateServiceDefinitionSchema } from "@/lib/offer/validation";
import { createServiceDefinition } from "@/lib/offer/service";

export async function POST(req: NextRequest): Promise<Response> {
  return withOfferApi(req, "service_catalog:manage", async (actor) => {
    const parsed = await parseJson(req, CreateServiceDefinitionSchema);
    if (parsed.response) return parsed.response;
    const definition = await createServiceDefinition(actor, parsed.data, clientIp(req));
    return Response.json(definition, { status: 201, headers: { "Cache-Control": "no-store" } });
  });
}

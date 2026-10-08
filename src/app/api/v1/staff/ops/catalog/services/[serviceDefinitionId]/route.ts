import { NextRequest } from "next/server";
import { withOfferApi, parseJson, clientIp } from "@/lib/offer/http";
import { UpdateServiceDefinitionSchema } from "@/lib/offer/validation";
import { updateServiceDefinition } from "@/lib/offer/service";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ serviceDefinitionId: string }> }
): Promise<Response> {
  return withOfferApi(req, "service_catalog:manage", async (actor) => {
    const { serviceDefinitionId } = await context.params;
    const parsed = await parseJson(req, UpdateServiceDefinitionSchema);
    if (parsed.response) return parsed.response;
    const definition = await updateServiceDefinition(
      actor,
      serviceDefinitionId,
      parsed.data,
      clientIp(req)
    );
    return Response.json(definition, { headers: { "Cache-Control": "no-store" } });
  });
}

import { NextRequest } from "next/server";
import {
  body,
  catalogCommand,
  receiptResponse,
  updateCatalogSchema,
  uuid,
  VehicleError,
  withVehicleApi,
} from "@/lib/vehicle/service";
type Params = { params: Promise<{ id: string }> };
export async function PATCH(req: NextRequest, { params }: Params): Promise<Response> {
  return withVehicleApi(req, "ops", async (actor) => {
    const id = (await params).id;
    if (!uuid.safeParse(id).success) throw new VehicleError(400, "INVALID_IDENTIFIER");
    return receiptResponse(
      await catalogCommand(actor!, "MAKE", "UPDATE", id, await body(req, updateCatalogSchema))
    );
  });
}

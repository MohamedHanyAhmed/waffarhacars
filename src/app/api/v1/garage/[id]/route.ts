import { NextRequest } from "next/server";
import {
  archiveVehicleSchema,
  body,
  editVehicleSchema,
  garageCommand,
  garageRead,
  receiptResponse,
  uuid,
  VehicleError,
  withVehicleApi,
} from "@/lib/vehicle/service";
type Params = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, { params }: Params): Promise<Response> {
  return withVehicleApi(req, "customer", async (actor) =>
    Response.json(await garageRead(actor!, (await params).id), {
      headers: { "Cache-Control": "no-store" },
    })
  );
}
export async function PATCH(req: NextRequest, { params }: Params): Promise<Response> {
  return withVehicleApi(req, "customer", async (actor) => {
    const id = (await params).id;
    if (!uuid.safeParse(id).success) throw new VehicleError(400, "INVALID_IDENTIFIER");
    return receiptResponse(
      await garageCommand(actor!, "EDIT", id, await body(req, editVehicleSchema))
    );
  });
}
export async function DELETE(req: NextRequest, { params }: Params): Promise<Response> {
  return withVehicleApi(req, "customer", async (actor) => {
    const id = (await params).id;
    if (!uuid.safeParse(id).success) throw new VehicleError(400, "INVALID_IDENTIFIER");
    return receiptResponse(
      await garageCommand(actor!, "ARCHIVE", id, await body(req, archiveVehicleSchema))
    );
  });
}

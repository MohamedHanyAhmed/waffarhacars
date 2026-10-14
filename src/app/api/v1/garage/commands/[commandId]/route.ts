import { NextRequest } from "next/server";
import { garageReceipt, withVehicleApi } from "@/lib/vehicle/service";
type Params = { params: Promise<{ commandId: string }> };
export async function GET(req: NextRequest, { params }: Params): Promise<Response> {
  return withVehicleApi(req, "customer", async (actor) =>
    Response.json(await garageReceipt(actor!, (await params).commandId), {
      headers: { "Cache-Control": "no-store" },
    })
  );
}

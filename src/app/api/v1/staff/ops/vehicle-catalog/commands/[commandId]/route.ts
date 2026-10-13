import { NextRequest } from "next/server";
import { catalogReceipt, withVehicleApi } from "@/lib/vehicle/service";
type Params = { params: Promise<{ commandId: string }> };
export async function GET(req: NextRequest, { params }: Params): Promise<Response> {
  return withVehicleApi(req, "ops", async (actor) =>
    Response.json(await catalogReceipt(actor!, (await params).commandId), {
      headers: { "Cache-Control": "no-store" },
    })
  );
}

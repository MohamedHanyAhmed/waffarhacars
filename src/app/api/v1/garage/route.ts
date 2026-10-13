import { NextRequest } from "next/server";
import {
  body,
  createVehicleSchema,
  garageCommand,
  garageList,
  receiptResponse,
  withVehicleApi,
} from "@/lib/vehicle/service";

export async function GET(req: NextRequest): Promise<Response> {
  return withVehicleApi(req, "customer", async (actor) => {
    const result = await garageList(
      actor!,
      Number(req.nextUrl.searchParams.get("limit") || 20),
      req.nextUrl.searchParams.get("cursor") || undefined
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}
export async function POST(req: NextRequest): Promise<Response> {
  return withVehicleApi(req, "customer", async (actor) =>
    receiptResponse(
      await garageCommand(actor!, "CREATE", null, await body(req, createVehicleSchema))
    )
  );
}

import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import {
  body,
  catalogCommand,
  createMakeSchema,
  receiptResponse,
  uuid,
  VehicleError,
  withVehicleApi,
} from "@/lib/vehicle/service";
export async function GET(req: NextRequest): Promise<Response> {
  return withVehicleApi(req, "ops", async () => {
    const limit = Number(req.nextUrl.searchParams.get("limit") || 30);
    const cursor = req.nextUrl.searchParams.get("cursor");
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (cursor && !uuid.safeParse(cursor).success)
    )
      throw new VehicleError(400, "INVALID_QUERY");
    if (
      cursor &&
      !(await getPrisma().vehicleMake.findUnique({ where: { id: cursor }, select: { id: true } }))
    )
      throw new VehicleError(404, "NOT_FOUND");
    const rows = await getPrisma().vehicleMake.findMany({
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        evidenceRef: true,
        isActive: true,
        version: true,
      },
      orderBy: [{ code: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    return Response.json(
      { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].id : null },
      { headers: { "Cache-Control": "no-store" } }
    );
  });
}
export async function POST(req: NextRequest): Promise<Response> {
  return withVehicleApi(req, "ops", async (actor) =>
    receiptResponse(
      await catalogCommand(actor!, "MAKE", "CREATE", null, await body(req, createMakeSchema))
    )
  );
}

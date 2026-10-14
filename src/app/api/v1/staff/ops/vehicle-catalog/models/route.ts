import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import {
  body,
  catalogCommand,
  createModelSchema,
  receiptResponse,
  withVehicleApi,
  uuid,
  VehicleError,
} from "@/lib/vehicle/service";
export async function GET(req: NextRequest): Promise<Response> {
  return withVehicleApi(req, "ops", async () => {
    const makeId = req.nextUrl.searchParams.get("makeId");
    const limit = Number(req.nextUrl.searchParams.get("limit") || 30);
    const cursor = req.nextUrl.searchParams.get("cursor");
    if (!makeId || !uuid.safeParse(makeId).success) throw new VehicleError(400, "INVALID_QUERY");
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (cursor && !uuid.safeParse(cursor).success)
    )
      throw new VehicleError(400, "INVALID_QUERY");
    if (
      cursor &&
      !(await getPrisma().vehicleModel.findFirst({
        where: { id: cursor, makeId },
        select: { id: true },
      }))
    )
      throw new VehicleError(404, "NOT_FOUND");
    const rows = await getPrisma().vehicleModel.findMany({
      where: { makeId },
      select: {
        id: true,
        makeId: true,
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
      await catalogCommand(actor!, "MODEL", "CREATE", null, await body(req, createModelSchema))
    )
  );
}

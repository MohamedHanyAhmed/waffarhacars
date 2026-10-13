import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { uuid, withVehicleApi, VehicleError } from "@/lib/vehicle/service";

export async function GET(req: NextRequest): Promise<Response> {
  return withVehicleApi(req, "public", async () => {
    const params = req.nextUrl.searchParams;
    const makeId = params.get("makeId");
    const limit = Number(params.get("limit") || 30);
    const cursor = params.get("cursor");
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (makeId && !uuid.safeParse(makeId).success) ||
      (cursor && !uuid.safeParse(cursor).success)
    )
      throw new VehicleError(400, "INVALID_QUERY");
    const db = getPrisma();
    if (makeId) {
      const make = await db.vehicleMake.findFirst({
        where: { id: makeId, isActive: true },
        select: { id: true },
      });
      if (!make) throw new VehicleError(404, "NOT_FOUND");
      if (
        cursor &&
        !(await db.vehicleModel.findFirst({
          where: { id: cursor, makeId, isActive: true },
          select: { id: true },
        }))
      )
        throw new VehicleError(404, "NOT_FOUND");
      const rows = await db.vehicleModel.findMany({
        where: { makeId, isActive: true },
        select: { id: true, makeId: true, code: true, nameEn: true, nameAr: true },
        orderBy: [{ code: "asc" }, { id: "asc" }],
        take: limit + 1,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      return Response.json(
        {
          items: rows.slice(0, limit),
          nextCursor: rows.length > limit ? rows[limit - 1].id : null,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    if (
      cursor &&
      !(await db.vehicleMake.findFirst({
        where: { id: cursor, isActive: true },
        select: { id: true },
      }))
    )
      throw new VehicleError(404, "NOT_FOUND");
    const rows = await db.vehicleMake.findMany({
      where: { isActive: true },
      select: { id: true, code: true, nameEn: true, nameAr: true },
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

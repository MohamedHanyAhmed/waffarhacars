import { NextRequest } from "next/server";
import { z } from "zod";
import {
  PUBLIC_CAIRO_CLUSTERS,
  PUBLIC_CATEGORY_CODES,
  listPublicOffers,
} from "@/lib/publication/discovery";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = { "Cache-Control": "no-store, max-age=0" };
const uuid = z.string().uuid();
const cursorSchema = z.object({ validUntil: z.string().datetime(), offerId: uuid }).strict();

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const query = req.nextUrl.searchParams;
    const allowedKeys = new Set(["category", "cluster", "cursor", "limit"]);
    if ([...query.keys()].some((key) => !allowedKeys.has(key)))
      return Response.json({ error: "VALIDATION_ERROR" }, { status: 400, headers });
    const category = query.get("category") ?? undefined;
    const cluster = query.get("cluster") ?? undefined;
    const limitRaw = query.get("limit") ?? "10";
    if (
      (category && !(PUBLIC_CATEGORY_CODES as readonly string[]).includes(category)) ||
      (cluster && !(PUBLIC_CAIRO_CLUSTERS as readonly string[]).includes(cluster)) ||
      !/^(?:[1-9]|1[0-9]|20)$/.test(limitRaw)
    )
      return Response.json({ error: "VALIDATION_ERROR" }, { status: 400, headers });
    let cursor: { validUntil: Date; offerId: string } | undefined;
    const encoded = query.get("cursor");
    if (encoded) {
      if (encoded.length > 256 || !/^[A-Za-z0-9_-]+$/.test(encoded))
        return Response.json({ error: "VALIDATION_ERROR" }, { status: 400, headers });
      let decoded: unknown;
      try {
        decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      } catch {
        return Response.json({ error: "VALIDATION_ERROR" }, { status: 400, headers });
      }
      const parsed = cursorSchema.safeParse(decoded);
      if (!parsed.success || !Number.isFinite(new Date(parsed.data.validUntil).getTime()))
        return Response.json({ error: "VALIDATION_ERROR" }, { status: 400, headers });
      cursor = { validUntil: new Date(parsed.data.validUntil), offerId: parsed.data.offerId };
    }
    return Response.json(
      await listPublicOffers({ category, cluster, cursor, limit: Number(limitRaw) }),
      { headers }
    );
  } catch {
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
  }
}

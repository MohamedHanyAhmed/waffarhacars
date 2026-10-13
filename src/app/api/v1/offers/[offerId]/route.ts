import { NextRequest } from "next/server";
import { z } from "zod";
import { getPublicOffer } from "@/lib/publication/discovery";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = { "Cache-Control": "no-store, max-age=0" };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ offerId: string }> }
): Promise<Response> {
  try {
    const { offerId } = await params;
    if (!z.string().uuid().safeParse(offerId).success)
      return Response.json({ error: "VALIDATION_ERROR" }, { status: 400, headers });
    const offer = await getPublicOffer(offerId);
    if (!offer) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers });
    return Response.json(offer, { headers });
  } catch {
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
  }
}

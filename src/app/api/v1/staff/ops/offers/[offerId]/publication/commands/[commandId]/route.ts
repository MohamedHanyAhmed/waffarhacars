import { NextRequest } from "next/server";
import { z } from "zod";
import { assertStaffPermission, AuthorizationError } from "@/lib/dal";
import { PublicationError, getPublicationCommandOutcome } from "@/lib/publication/service";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };
const idSchema = z.string().uuid();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ offerId: string; commandId: string }> }
): Promise<Response> {
  try {
    const actor = await assertStaffPermission(req.headers, "offer_publication:manage");
    const { offerId, commandId } = await params;
    if (!idSchema.safeParse(offerId).success || !idSchema.safeParse(commandId).success)
      return Response.json({ error: "VALIDATION_ERROR" }, { status: 400, headers });
    return Response.json(await getPublicationCommandOutcome(actor, offerId, commandId), {
      headers,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toResponse();
    if (error instanceof PublicationError)
      return Response.json({ error: error.code }, { status: error.status, headers });
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
  }
}

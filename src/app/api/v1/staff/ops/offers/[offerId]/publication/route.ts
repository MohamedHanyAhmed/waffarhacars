import { NextRequest } from "next/server";
import { z } from "zod";
import { assertStaffPermission, AuthorizationError } from "@/lib/dal";
import { getClientIp } from "@/lib/rate-limit";
import { validateRequestOrigin } from "@/lib/security/origin";
import {
  PublicationCommandSchema,
  PublicationError,
  executePublicationCommand,
  getPublicationState,
} from "@/lib/publication/service";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };
const idSchema = z.string().uuid();

function failure(error: unknown): Response {
  if (error instanceof AuthorizationError) return error.toResponse();
  if (error instanceof PublicationError)
    return Response.json({ error: error.code }, { status: error.status, headers });
  return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ offerId: string }> }
): Promise<Response> {
  try {
    await assertStaffPermission(req.headers, "offer_publication:manage");
    const { offerId } = await params;
    if (!idSchema.safeParse(offerId).success)
      return Response.json({ error: "VALIDATION_ERROR" }, { status: 400, headers });
    return Response.json(await getPublicationState(offerId), { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ offerId: string }> }
): Promise<Response> {
  try {
    const actor = await assertStaffPermission(req.headers, "offer_publication:manage");
    if (!validateRequestOrigin(req).valid)
      return Response.json({ error: "UNTRUSTED_ORIGIN" }, { status: 403, headers });
    const { offerId } = await params;
    if (!idSchema.safeParse(offerId).success)
      return Response.json({ error: "VALIDATION_ERROR" }, { status: 400, headers });
    const body = await req.json().catch(() => null);
    const parsed = PublicationCommandSchema.safeParse(body);
    if (!parsed.success)
      return Response.json({ error: "VALIDATION_ERROR" }, { status: 400, headers });
    const result = await executePublicationCommand(actor, offerId, parsed.data, getClientIp(req));
    if (result.command.outcome === "REJECTED") {
      return Response.json(
        {
          error: result.command.errorCode,
          command: result.command,
          publication: result.publication,
        },
        { status: result.command.httpStatus, headers }
      );
    }
    return Response.json(result, { headers });
  } catch (error) {
    return failure(error);
  }
}

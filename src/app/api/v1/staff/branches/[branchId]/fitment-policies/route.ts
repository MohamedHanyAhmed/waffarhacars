import { NextRequest } from "next/server";
import { getClientIp } from "@/lib/rate-limit";
import { fitmentApi, parseFitmentBody, uuid, FitmentError } from "@/lib/fitment/shared";
import {
  CreateCapabilitySchema,
  createCapability,
  getCapabilityVersions,
} from "@/lib/fitment/capability";

type Context = { params: Promise<{ branchId: string }> };
function branchId(value: string) {
  if (!uuid.safeParse(value).success) throw new FitmentError(400, "INVALID_IDENTIFIER");
  return value;
}

export async function POST(req: NextRequest, context: Context) {
  return fitmentApi(req, "branch_fitment:create", async (actor) => {
    const id = branchId((await context.params).branchId);
    const input = await parseFitmentBody(req, CreateCapabilitySchema);
    const result = await createCapability(actor, id, input, getClientIp(req));
    return Response.json(
      { command: result.command, replayed: result.replayed },
      { status: result.httpStatus, headers: { "Cache-Control": "no-store" } }
    );
  });
}

export async function GET(req: NextRequest, context: Context) {
  return fitmentApi(req, "branch_fitment:read", async (actor) => {
    return Response.json(
      await getCapabilityVersions(actor, branchId((await context.params).branchId)),
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  });
}

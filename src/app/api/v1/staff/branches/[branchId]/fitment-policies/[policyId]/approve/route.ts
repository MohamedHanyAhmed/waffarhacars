import { NextRequest } from "next/server";
import { getClientIp } from "@/lib/rate-limit";
import { fitmentApi, parseFitmentBody, uuid, FitmentError } from "@/lib/fitment/shared";
import { ApproveCapabilitySchema, capabilityCommand } from "@/lib/fitment/capability";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ branchId: string; policyId: string }> }
) {
  return fitmentApi(req, "branch_fitment:approve", async (actor) => {
    const { branchId, policyId } = await context.params;
    if (!uuid.safeParse(branchId).success || !uuid.safeParse(policyId).success)
      throw new FitmentError(400, "INVALID_IDENTIFIER");
    const input = await parseFitmentBody(req, ApproveCapabilitySchema);
    const result = await capabilityCommand(
      actor,
      branchId,
      policyId,
      "APPROVE",
      input,
      getClientIp(req)
    );
    return Response.json(
      { command: result.command, replayed: result.replayed },
      { status: result.httpStatus, headers: { "Cache-Control": "no-store" } }
    );
  });
}

import { NextRequest } from "next/server";
import { fitmentApi, uuid, FitmentError } from "@/lib/fitment/shared";
import { getCapabilityCommand } from "@/lib/fitment/capability";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ branchId: string; commandId: string }> }
) {
  return fitmentApi(req, "branch_fitment:read", async (actor) => {
    const { branchId, commandId } = await context.params;
    if (!uuid.safeParse(branchId).success || !uuid.safeParse(commandId).success)
      throw new FitmentError(400, "INVALID_IDENTIFIER");
    return Response.json(await getCapabilityCommand(actor, branchId, commandId), {
      headers: { "Cache-Control": "no-store" },
    });
  });
}

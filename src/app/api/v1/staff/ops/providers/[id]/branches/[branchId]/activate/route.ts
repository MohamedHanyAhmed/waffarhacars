import { NextRequest } from "next/server";
import { assertStaffPermission, AuthorizationError } from "@/lib/dal";
import { ActivateBranchSchema } from "@/lib/provider/validation";
import { activateBranch, ProviderError } from "@/lib/provider/service";

import { normalizeBranchDto } from "@/lib/provider/dto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; branchId: string }> }
): Promise<Response> {
  try {
    const actor = await assertStaffPermission(req.headers, "branch:activate");
    const { id, branchId } = await params;
    const json = await req.json().catch(() => null);
    const parsed = ActivateBranchSchema.safeParse(json);

    if (!parsed.success) {
      return Response.json(
        {
          error: "VALIDATION_ERROR",
          message: "Invalid branch activation payload",
          details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;
    const branch = await activateBranch(actor, id, branchId, parsed.data, clientIp);

    return Response.json(normalizeBranchDto(branch), {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof AuthorizationError) return err.toResponse();
    if (err instanceof ProviderError) return err.toResponse();
    return Response.json(
      { error: "INTERNAL_ERROR", message: "An unexpected error occurred." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

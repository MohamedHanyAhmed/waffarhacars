import { NextRequest } from "next/server";
import { assertStaffPermission, AuthorizationError } from "@/lib/dal";
import { UpdateBranchDraftSchema } from "@/lib/provider/validation";
import { updateBranchDraft, ProviderError } from "@/lib/provider/service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; branchId: string }> }
): Promise<Response> {
  try {
    const actor = await assertStaffPermission(req.headers, "branch:edit");
    const { branchId } = await params;
    const json = await req.json().catch(() => null);
    const parsed = UpdateBranchDraftSchema.safeParse(json);

    if (!parsed.success) {
      return Response.json(
        {
          error: "VALIDATION_ERROR",
          message: "Invalid branch update payload",
          details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;
    const updated = await updateBranchDraft(actor, branchId, parsed.data, clientIp);

    return Response.json(updated, {
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

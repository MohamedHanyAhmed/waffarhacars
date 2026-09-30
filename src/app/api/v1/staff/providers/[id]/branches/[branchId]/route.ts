import { NextRequest } from "next/server";
import { assertStaffPermission, AuthorizationError } from "@/lib/dal";
import { getPrisma } from "@/lib/db";
import { UpdateBranchDraftSchema } from "@/lib/provider/validation";
import {
  updateBranchDraft,
  isBranchOperationallyAvailable,
  ProviderError,
} from "@/lib/provider/service";
import { normalizeBranchDto } from "@/lib/provider/dto";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; branchId: string }> }
): Promise<Response> {
  try {
    await assertStaffPermission(req.headers, "provider:read");
    const { id, branchId } = await params;
    const prisma = getPrisma();

    const branch = await prisma.providerBranch.findFirst({
      where: {
        id: branchId,
        providerOrganizationId: id,
      },
      include: {
        providerOrganization: {
          select: {
            id: true,
            nameEn: true,
            nameAr: true,
            status: true,
          },
        },
      },
    });

    if (!branch) {
      return Response.json(
        {
          error: "BRANCH_NOT_FOUND",
          message: "Branch not found for the specified provider organization.",
        },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    const isAvailable = isBranchOperationallyAvailable(
      branch.status,
      branch.providerOrganization.status
    );

    const dto = normalizeBranchDto({ ...branch, isOperationallyAvailable: isAvailable });

    return Response.json(dto, {
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; branchId: string }> }
): Promise<Response> {
  try {
    const actor = await assertStaffPermission(req.headers, "branch:edit");
    const { id, branchId } = await params;
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
    const updated = await updateBranchDraft(actor, id, branchId, parsed.data, clientIp);
    const dto = normalizeBranchDto(updated);

    return Response.json(dto, {
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

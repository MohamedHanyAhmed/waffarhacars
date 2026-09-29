import { NextRequest } from "next/server";
import { assertStaffPermission, AuthorizationError } from "@/lib/dal";
import { getPrisma } from "@/lib/db";
import { CreateBranchDraftSchema } from "@/lib/provider/validation";
import { createBranchDraft, ProviderError } from "@/lib/provider/service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const actor = await assertStaffPermission(req.headers, "branch:create");
    const { id } = await params;
    const json = await req.json().catch(() => null);
    const parsed = CreateBranchDraftSchema.safeParse(json);

    if (!parsed.success) {
      return Response.json(
        {
          error: "VALIDATION_ERROR",
          message: "Invalid branch draft payload",
          details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;
    const branch = await createBranchDraft(actor, id, parsed.data, clientIp);

    return Response.json(branch, {
      status: 201,
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    await assertStaffPermission(req.headers, "provider:read");
    const { id } = await params;
    const prisma = getPrisma();

    const branches = await prisma.providerBranch.findMany({
      where: { providerOrganizationId: id },
      orderBy: { createdAt: "asc" },
    });

    return Response.json(branches, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof AuthorizationError) return err.toResponse();
    return Response.json(
      { error: "INTERNAL_ERROR", message: "An unexpected error occurred." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

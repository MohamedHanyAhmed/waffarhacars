import { NextRequest } from "next/server";
import { assertStaffPermission, AuthorizationError } from "@/lib/dal";
import { getPrisma } from "@/lib/db";
import { UpdateProviderDraftSchema } from "@/lib/provider/validation";
import { updateProviderDraft, ProviderError } from "@/lib/provider/service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    await assertStaffPermission(req.headers, "provider:read");
    const { id } = await params;
    const prisma = getPrisma();

    const provider = await prisma.providerOrganization.findUnique({
      where: { id },
      include: { branches: true },
    });

    if (!provider) {
      return Response.json(
        { error: "PROVIDER_NOT_FOUND", message: "Provider organization not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    return Response.json(provider, {
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const actor = await assertStaffPermission(req.headers, "provider:edit");
    const { id } = await params;
    const json = await req.json().catch(() => null);
    const parsed = UpdateProviderDraftSchema.safeParse(json);

    if (!parsed.success) {
      return Response.json(
        {
          error: "VALIDATION_ERROR",
          message: "Invalid provider update payload",
          details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;
    const updated = await updateProviderDraft(actor, id, parsed.data, clientIp);

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

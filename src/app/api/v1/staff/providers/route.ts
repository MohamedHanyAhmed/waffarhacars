import { NextRequest } from "next/server";
import { assertStaffPermission, AuthorizationError } from "@/lib/dal";
import { getPrisma } from "@/lib/db";
import { CreateProviderDraftSchema } from "@/lib/provider/validation";
import { createProviderDraft, ProviderError } from "@/lib/provider/service";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const actor = await assertStaffPermission(req.headers, "provider:create");
    const json = await req.json().catch(() => null);
    const parsed = CreateProviderDraftSchema.safeParse(json);

    if (!parsed.success) {
      return Response.json(
        {
          error: "VALIDATION_ERROR",
          message: "Invalid provider draft payload",
          details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;
    const provider = await createProviderDraft(actor, parsed.data, clientIp);

    return Response.json(provider, {
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

export async function GET(req: NextRequest): Promise<Response> {
  try {
    await assertStaffPermission(req.headers, "provider:read");
    const prisma = getPrisma();

    const { searchParams } = new URL(req.url);
    const cluster = searchParams.get("cluster");
    const status = searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (cluster) where.primaryCluster = cluster;
    if (status) where.status = status;

    const providers = await prisma.providerOrganization.findMany({
      where,
      include: {
        branches: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(providers, {
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

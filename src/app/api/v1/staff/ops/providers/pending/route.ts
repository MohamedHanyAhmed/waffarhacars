import { NextRequest } from "next/server";
import { assertStaffPermission, AuthorizationError } from "@/lib/dal";
import { getPrisma } from "@/lib/db";
import { normalizeProviderDto } from "@/lib/provider/dto";

export async function GET(req: NextRequest): Promise<Response> {
  try {
    await assertStaffPermission(req.headers, "provider:review");
    const prisma = getPrisma();

    const pending = await prisma.providerOrganization.findMany({
      where: { status: "PENDING_REVIEW" },
      include: {
        branches: true,
        submittedByUser: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { submittedAt: "asc" },
    });

    const dtoList = pending.map(normalizeProviderDto);

    return Response.json(dtoList, {
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

import { NextRequest } from "next/server";
import { assertStaffPermission, AuthorizationError } from "@/lib/dal";
import { RejectProviderSchema } from "@/lib/provider/validation";
import { rejectProvider, ProviderError } from "@/lib/provider/service";
import { normalizeProviderDto } from "@/lib/provider/dto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const actor = await assertStaffPermission(req.headers, "provider:reject");
    const { id } = await params;
    const json = await req.json().catch(() => null);
    const parsed = RejectProviderSchema.safeParse(json);

    if (!parsed.success) {
      return Response.json(
        {
          error: "VALIDATION_ERROR",
          message: "Invalid reject payload",
          details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;
    const rejected = await rejectProvider(actor, id, parsed.data, clientIp);
    const dto = normalizeProviderDto(rejected);

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

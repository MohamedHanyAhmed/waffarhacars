import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertStaffPermission, AuthorizationError } from "@/lib/dal";
import { getClientIp } from "@/lib/rate-limit";
import { validateRequestOrigin } from "@/lib/security/origin";
import { OfferError } from "./service";

const uuidParam = z.string().uuid();

export function assertUuidParam(value: string): string {
  if (!uuidParam.safeParse(value).success) {
    throw new OfferError(400, "VALIDATION_ERROR", "Invalid resource identifier.");
  }
  return value;
}

export async function withOfferApi(
  req: NextRequest,
  permission: Parameters<typeof assertStaffPermission>[1],
  handler: (actor: Awaited<ReturnType<typeof assertStaffPermission>>) => Promise<Response>
) {
  try {
    const actor = await assertStaffPermission(req.headers, permission);
    if (req.method !== "GET" && !validateRequestOrigin(req).valid) {
      throw new OfferError(403, "ORIGIN_DENIED", "Request origin is not allowed.");
    }
    return await handler(actor);
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof OfferError)
      return error.toResponse();
    return Response.json(
      { error: "INTERNAL_ERROR", message: "An unexpected error occurred." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function parseJson<T>(
  req: NextRequest,
  schema: {
    safeParse: (
      value: unknown
    ) =>
      | { success: true; data: T }
      | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
  }
) {
  let value: unknown = null;
  if (req.body) {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        total += result.value.byteLength;
        if (total > 16384) {
          await reader.cancel().catch(() => {});
          break;
        }
        chunks.push(result.value);
      }
      if (total <= 16384) {
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      }
    } catch {
      value = null;
    } finally {
      reader.releaseLock();
    }
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return {
      data: null,
      response: Response.json(
        {
          error: "VALIDATION_ERROR",
          message: "Invalid request payload.",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }
  return { data: parsed.data, response: null };
}

export function clientIp(req: NextRequest) {
  return getClientIp(req);
}

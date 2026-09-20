import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { normalizeEgyptianPhone } from "@/lib/phone";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { computePhoneLookupHash } from "@/lib/otp/challenge-service";
import { validateRequestOrigin } from "@/lib/security/origin";

const VerifyBodySchema = z.object({
  phone: z.string().min(1, "Phone number is required"),
  code: z.string().regex(/^\d{6}$/, "Code must be exactly 6 decimal digits"),
});

export async function POST(req: NextRequest): Promise<Response> {
  let env;
  try {
    env = getServerEnv();
  } catch {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/internal-error",
        title: "Internal Server Error",
        status: 500,
        detail: "Configuration error",
      },
      {
        status: 500,
        headers: { "Content-Type": "application/problem+json", "Cache-Control": "no-store" },
      }
    );
  }

  // 1. Fail closed in showcase demo mode without database connection
  if (env.APP_DATA_BACKEND === "demo") {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/service-unavailable",
        title: "Service Unavailable",
        status: 503,
        detail: "Authentication service unavailable in showcase/demo mode",
      },
      {
        status: 503,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // 2. Validate trusted origin/referer
  const originCheck = validateRequestOrigin(req);
  if (!originCheck.valid) {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/invalid-origin",
        title: "Invalid Origin",
        status: 403,
        detail: originCheck.reason || "Untrusted request origin",
      },
      {
        status: 403,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // 3. Parse and validate JSON body
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/bad-request",
        title: "Bad Request",
        status: 400,
        detail: "Invalid JSON request body",
      },
      {
        status: 400,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const parsedBody = VerifyBodySchema.safeParse(bodyJson);
  if (!parsedBody.success) {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/validation-error",
        title: "Validation Error",
        status: 400,
        detail: "Valid Egyptian phone number and 6-digit verification code are required",
      },
      {
        status: 400,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // 4. Normalize phone number
  const norm = normalizeEgyptianPhone(parsedBody.data.phone);
  if (!norm.success) {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/invalid-phone",
        title: "Invalid Phone Number",
        status: 400,
        detail: "Please provide a valid Egyptian mobile phone number",
      },
      {
        status: 400,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const canonicalE164 = norm.canonicalE164;
  const phoneLookupHash = computePhoneLookupHash(canonicalE164);
  const candidateCode = parsedBody.data.code;
  const clientIp = getClientIp(req);

  // 5. Rate limiting: verification attempts per IP
  const ipLimit = await checkRateLimit(`rl:ip:verify:${clientIp}`, 20, 900);
  if (!ipLimit.allowed) {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/rate-limit-exceeded",
        title: "Too Many Requests",
        status: 429,
        detail: "Too many verification attempts. Please try again later.",
      },
      {
        status: 429,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
          "Retry-After": String(ipLimit.retryAfterSeconds),
        },
      }
    );
  }

  // Rate limiting: verification attempts per phone
  const phoneVerifyLimit = await checkRateLimit(`rl:phone:verify:${phoneLookupHash}`, 10, 900);
  if (!phoneVerifyLimit.allowed) {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/rate-limit-exceeded",
        title: "Too Many Requests",
        status: 429,
        detail: "Too many failed attempts on this number. Please try again later.",
      },
      {
        status: 429,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
          "Retry-After": String(phoneVerifyLimit.retryAfterSeconds),
        },
      }
    );
  }

  const prisma = getPrisma();

  // Check whether this user exists beforehand to determine isNewCustomer
  const preExistingUser = await prisma.user.findUnique({
    where: { phoneNumber: canonicalE164 },
    select: { id: true },
  });
  const isNewCustomer = !preExistingUser;

  // 6. Invoke Better Auth internal phone verification endpoint
  let authRes: Response;
  try {
    const auth = getAuth();
    const phoneApi = auth.api as unknown as {
      verifyPhoneNumber: (args: {
        body: { phoneNumber: string; code: string };
        headers?: Headers;
        asResponse?: boolean;
      }) => Promise<Response>;
    };

    authRes = await phoneApi.verifyPhoneNumber({
      body: {
        phoneNumber: canonicalE164,
        code: candidateCode,
      },
      headers: req.headers,
      asResponse: true,
    });
  } catch (err: unknown) {
    console.error("[Verify Auth Error]", err instanceof Error ? err.message : "Unknown auth error");
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/internal-error",
        title: "Authentication Service Error",
        status: 500,
        detail: "An unexpected error occurred during authentication.",
      },
      {
        status: 500,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  if (!authRes || !authRes.ok) {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/invalid-otp",
        title: "Invalid Verification Code",
        status: 400,
        detail: "The verification code is incorrect, expired, or has already been used.",
      },
      {
        status: 400,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // 7. Synchronous Profile Verification & Consistency Check
  try {
    const user = await prisma.user.findUnique({
      where: { phoneNumber: canonicalE164 },
      include: { customerProfile: true },
    });

    if (!user) {
      throw new Error("User record missing following verification");
    }

    if (!user.customerProfile) {
      await prisma.customerProfile.create({
        data: {
          userId: user.id,
          preferredLanguage: "ar",
        },
      });
    }
  } catch (err: unknown) {
    console.error(
      "[Profile Consistency Error]",
      err instanceof Error ? err.message : "Profile check failed"
    );
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/internal-error",
        title: "Customer Profile Error",
        status: 500,
        detail: "Authentication succeeded but customer profile could not be synchronized.",
      },
      {
        status: 500,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // 8. Capture and forward ALL Set-Cookie headers individually
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "no-store");

  const setCookies =
    typeof authRes.headers.getSetCookie === "function"
      ? authRes.headers.getSetCookie()
      : authRes.headers.get("set-cookie")
        ? [authRes.headers.get("set-cookie")!]
        : [];

  for (const cookieStr of setCookies) {
    headers.append("Set-Cookie", cookieStr);
  }

  // Construct response: strictly zero tokens in JSON body
  return new Response(
    JSON.stringify({
      authenticated: true,
      isNewCustomer,
    }),
    {
      status: 200,
      headers,
    }
  );
}

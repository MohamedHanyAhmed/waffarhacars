import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { normalizeEgyptianPhone } from "@/lib/phone";
import { checkRateLimit } from "@/lib/rate-limit";

const VerifyBodySchema = z.object({
  phone: z.string().min(1, "Phone number is required"),
  code: z.string().regex(/^\d{6}$/, "Code must be exactly 6 decimal digits"),
});

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") || "127.0.0.1";
}

function validateOrigin(req: NextRequest): boolean {
  const env = getServerEnv();
  const origin = req.headers.get("origin");
  if (!origin) {
    const referer = req.headers.get("referer");
    if (!referer) return true;
    try {
      const refOrigin = new URL(referer).origin;
      return env.AUTH_TRUSTED_ORIGINS.includes(refOrigin);
    } catch {
      return false;
    }
  }
  return env.AUTH_TRUSTED_ORIGINS.includes(origin);
}

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

  // 2. Validate trusted origin
  if (!validateOrigin(req)) {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/invalid-origin",
        title: "Invalid Origin",
        status: 403,
        detail: "Untrusted request origin",
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
        detail: "Too many failed attempts. Please try again later.",
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

  // Check if user already exists prior to verification (to accurately report isNewCustomer)
  const prisma = getPrisma();
  const preExistingUser = await prisma.user.findUnique({
    where: { phoneNumber: canonicalE164 },
    select: { id: true },
  });
  const isNewCustomer = !preExistingUser;

  // 6. Invoke Better Auth internal phone verification endpoint
  try {
    const auth = getAuth();
    const phoneApi = auth.api as unknown as {
      verifyPhoneNumber: (args: {
        body: { phoneNumber: string; code: string };
        headers?: Headers;
        asResponse?: boolean;
      }) => Promise<Response>;
    };

    const authRes = await phoneApi.verifyPhoneNumber({
      body: {
        phoneNumber: canonicalE164,
        code: candidateCode,
      },
      headers: req.headers,
      asResponse: true,
    });

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

    // Capture the official Better Auth Set-Cookie header
    const setCookie = authRes.headers.get("set-cookie");

    // Construct response: strictly zero tokens in JSON body
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Cache-Control", "no-store");
    if (setCookie) {
      headers.set("Set-Cookie", setCookie);
    }

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
  } catch {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/invalid-otp",
        title: "Verification Failed",
        status: 400,
        detail: "Verification failed. Please check the code and try again.",
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
}

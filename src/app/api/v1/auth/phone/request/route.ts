import { NextRequest } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { normalizeEgyptianPhone } from "@/lib/phone";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestOtpChallenge, computePhoneLookupHash } from "@/lib/otp/challenge-service";

const RequestBodySchema = z.object({
  phone: z.string().min(1, "Phone number is required"),
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
    // If no origin header, check referer as fallback
    const referer = req.headers.get("referer");
    if (!referer) return true; // Direct/same-origin server calls in tests
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

  // 3. Parse JSON body
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

  const parsedBody = RequestBodySchema.safeParse(bodyJson);
  if (!parsedBody.success) {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/validation-error",
        title: "Validation Error",
        status: 400,
        detail: "A valid Egyptian phone number is required",
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

  // 4. Normalize Egyptian phone number
  const norm = normalizeEgyptianPhone(parsedBody.data.phone);
  if (!norm.success) {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/invalid-phone",
        title: "Invalid Phone Number",
        status: 400,
        detail: "Please provide a valid Egyptian mobile phone number (010, 011, 012, or 015)",
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
  const clientIp = getClientIp(req);

  // 5. Rate limiting: IP burst limit (max 15 requests per 15 min)
  const ipLimit = await checkRateLimit(`rl:ip:req:${clientIp}`, 15, 900);
  if (!ipLimit.allowed) {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/rate-limit-exceeded",
        title: "Too Many Requests",
        status: 429,
        detail: "Rate limit exceeded. Please try again later.",
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

  // 6. Rate limiting: Phone daily limit (max 10 requests per 24 hours)
  const dailyPhoneLimit = await checkRateLimit(`rl:phone:daily:${phoneLookupHash}`, 10, 86400);
  if (!dailyPhoneLimit.allowed) {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/rate-limit-exceeded",
        title: "Too Many Requests",
        status: 429,
        detail: "Daily verification limit reached for this number.",
      },
      {
        status: 429,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
          "Retry-After": String(dailyPhoneLimit.retryAfterSeconds),
        },
      }
    );
  }

  // 7. Request Challenge
  const challengeResult = await requestOtpChallenge(canonicalE164);
  if (!challengeResult.success) {
    if (challengeResult.error === "COOLDOWN_ACTIVE") {
      return Response.json(
        {
          type: "https://waffarhacars.com/errors/cooldown-active",
          title: "Too Many Requests",
          status: 429,
          detail: "Please wait before requesting another verification code.",
        },
        {
          status: 429,
          headers: {
            "Content-Type": "application/problem+json",
            "Cache-Control": "no-store",
            "Retry-After": String(challengeResult.retryAfterSeconds),
          },
        }
      );
    }

    return Response.json(
      {
        type: "https://waffarhacars.com/errors/rate-limit-exceeded",
        title: "Too Many Requests",
        status: 429,
        detail: "Maximum send attempts exceeded. Please try again later.",
      },
      {
        status: 429,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // Generic accepted response to prevent phone enumeration
  return Response.json(
    { accepted: true },
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}

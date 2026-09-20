import { NextRequest } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { normalizeEgyptianPhone } from "@/lib/phone";
import { checkRateLimit, getClientIp, hashIpAddress } from "@/lib/rate-limit";
import { computePhoneLookupHash, requestOtpChallenge } from "@/lib/otp/challenge-service";
import { validateRequestOrigin } from "@/lib/security/origin";

const RequestBodySchema = z.object({
  phone: z.string().min(1, "Phone number is required"),
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
  const hashedIp = hashIpAddress(clientIp);

  // 5. Rate limiting: IP burst limit (max 20 requests per 15 min)
  const ipLimit = await checkRateLimit(`rl:ip:req:${hashedIp}`, 20, 900);
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

  // 6. Rate limiting: Phone rolling limit (max 5 requests per 15 min)
  const phoneLimit = await checkRateLimit(`rl:phone:req:${phoneLookupHash}`, 5, 900);
  if (!phoneLimit.allowed) {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/rate-limit-exceeded",
        title: "Too Many Requests",
        status: 429,
        detail: "Too many verification requests for this number. Please try again later.",
      },
      {
        status: 429,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
          "Retry-After": String(phoneLimit.retryAfterSeconds),
        },
      }
    );
  }

  // 7. Request and synchronously dispatch Challenge
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

    if (challengeResult.error === "PHONE_LOCKED") {
      return Response.json(
        {
          type: "https://waffarhacars.com/errors/account-locked",
          title: "Account Temporarily Locked",
          status: 429,
          detail: "Too many failed attempts. This number is temporarily locked for your security.",
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

    if (
      challengeResult.error === "DISPATCH_SUPERSEDED" ||
      challengeResult.error === "DISPATCH_LOST_RACE"
    ) {
      return Response.json(
        {
          type: "https://waffarhacars.com/errors/request-conflict",
          title: "Request Conflict",
          status: 409,
          detail: "The authentication challenge state was superseded. Please start a new request.",
        },
        {
          status: 409,
          headers: {
            "Content-Type": "application/problem+json",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    // SMS_DELIVERY_FAILED
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/sms-delivery-failed",
        title: "SMS Delivery Failed",
        status: 502,
        detail: "Unable to dispatch SMS verification code. Please try again shortly.",
      },
      {
        status: 502,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // Sanitized operational log: never log raw phone numbers or OTP codes
  console.info(
    JSON.stringify({
      event: "customer_otp_requested",
      phoneLookupHash,
      cooldownSeconds: challengeResult.cooldownSeconds,
      timestamp: new Date().toISOString(),
    })
  );

  // Accepted response: provider confirmed dispatch
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

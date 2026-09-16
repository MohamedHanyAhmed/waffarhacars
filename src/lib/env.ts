import "server-only";
import { z } from "zod";

export type AppRuntimeProfile = "showcase" | "production";
export type AppDataBackend = "demo" | "postgres";

const POSTGRES_URL_REGEX = /^postgres(?:ql)?:\/\//i;

const RawServerEnvSchema = z.object({
  APP_RUNTIME_PROFILE: z.enum(["showcase", "production"], {
    message: "Invalid or missing APP_RUNTIME_PROFILE",
  }),
  APP_DATA_BACKEND: z.enum(["demo", "postgres"], {
    message: "Invalid or missing APP_DATA_BACKEND",
  }),
  DATABASE_URL: z.string().optional(),
  DATABASE_DIRECT_URL: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(250).max(60000).default(5000),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(10000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(250).max(60000).default(5000),
  BETTER_AUTH_SECRET: z.string().optional(),
  BETTER_AUTH_URL: z.string().optional(),
  AUTH_TRUSTED_ORIGINS: z.string().optional(),
});

export interface ServerEnv {
  APP_RUNTIME_PROFILE: AppRuntimeProfile;
  APP_DATA_BACKEND: AppDataBackend;
  DATABASE_URL: string | undefined;
  DATABASE_DIRECT_URL: string | undefined;
  DATABASE_POOL_MAX: number;
  DATABASE_CONNECTION_TIMEOUT_MS: number;
  DATABASE_IDLE_TIMEOUT_MS: number;
  DATABASE_STATEMENT_TIMEOUT_MS: number;
  BETTER_AUTH_SECRET: string | undefined;
  BETTER_AUTH_URL: string | undefined;
  AUTH_TRUSTED_ORIGINS: string[];
}

let cachedEnv: ServerEnv | null = null;

function validateAuthUrl(rawUrl: string, profile: AppRuntimeProfile): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Configuration error: BETTER_AUTH_URL must be a valid absolute URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Configuration error: BETTER_AUTH_URL must use http or https protocol.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Configuration error: BETTER_AUTH_URL must not contain credentials.");
  }

  if (parsed.search || parsed.searchParams.size > 0) {
    throw new Error("Configuration error: BETTER_AUTH_URL must not contain query parameters.");
  }

  if (parsed.hash) {
    throw new Error("Configuration error: BETTER_AUTH_URL must not contain a URL fragment.");
  }

  if (parsed.pathname !== "" && parsed.pathname !== "/") {
    throw new Error("Configuration error: BETTER_AUTH_URL must not contain a sub-path.");
  }

  if (profile === "production") {
    if (parsed.protocol !== "https:") {
      throw new Error("Configuration error: BETTER_AUTH_URL must use HTTPS in production.");
    }
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
      throw new Error("Configuration error: BETTER_AUTH_URL cannot use localhost in production.");
    }
  } else {
    if (parsed.protocol === "http:") {
      const host = parsed.hostname.toLowerCase();
      if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
        throw new Error(
          "Configuration error: HTTP BETTER_AUTH_URL is only permitted on localhost outside production."
        );
      }
    }
  }

  return parsed;
}

function validateAuthSecret(secret: string, profile: AppRuntimeProfile): void {
  if (secret.length < 32) {
    throw new Error("Configuration error: BETTER_AUTH_SECRET must be at least 32 characters.");
  }

  // Ensure reasonable entropy: not repetitive single characters
  const uniqueChars = new Set(secret);
  if (uniqueChars.size < 8) {
    throw new Error("Configuration error: BETTER_AUTH_SECRET must have sufficient entropy.");
  }

  if (profile === "production") {
    const lower = secret.toLowerCase();
    if (
      lower.includes("example") ||
      lower.includes("placeholder") ||
      lower.includes("test-secret")
    ) {
      throw new Error(
        "Configuration error: BETTER_AUTH_SECRET contains non-production placeholder value."
      );
    }
  }
}

export function validateServerEnv(
  source: Record<string, string | undefined> = process.env
): ServerEnv {
  const parseResult = RawServerEnvSchema.safeParse(source);
  if (!parseResult.success) {
    throw new Error("Configuration error: Invalid server environment configuration.");
  }

  const data = parseResult.data;

  // Rule 1: production + demo is strictly prohibited (fail-closed)
  if (data.APP_RUNTIME_PROFILE === "production" && data.APP_DATA_BACKEND === "demo") {
    throw new Error(
      "Configuration error: Production runtime profile cannot use demo data backend."
    );
  }

  // Rule 2: When backend is postgres, DATABASE_URL is required and must match PostgreSQL protocol
  if (data.APP_DATA_BACKEND === "postgres") {
    if (!data.DATABASE_URL || !POSTGRES_URL_REGEX.test(data.DATABASE_URL.trim())) {
      throw new Error(
        "Configuration error: DATABASE_URL must be a valid PostgreSQL connection string."
      );
    }
  }

  // Validate DATABASE_DIRECT_URL if provided
  if (data.DATABASE_DIRECT_URL && !POSTGRES_URL_REGEX.test(data.DATABASE_DIRECT_URL.trim())) {
    throw new Error(
      "Configuration error: DATABASE_DIRECT_URL must be a valid PostgreSQL connection string."
    );
  }

  // Rule 3: Auth environment requirements when backend is postgres
  let validatedAuthUrl: string | undefined;
  let trustedOrigins: string[] = [];

  if (data.APP_DATA_BACKEND === "postgres") {
    if (!data.BETTER_AUTH_SECRET || !data.BETTER_AUTH_SECRET.trim()) {
      throw new Error(
        "Configuration error: BETTER_AUTH_SECRET is required when using postgres backend."
      );
    }
    validateAuthSecret(data.BETTER_AUTH_SECRET.trim(), data.APP_RUNTIME_PROFILE);

    if (!data.BETTER_AUTH_URL || !data.BETTER_AUTH_URL.trim()) {
      throw new Error(
        "Configuration error: BETTER_AUTH_URL is required when using postgres backend."
      );
    }
    const parsedUrl = validateAuthUrl(data.BETTER_AUTH_URL.trim(), data.APP_RUNTIME_PROFILE);
    validatedAuthUrl = parsedUrl.origin;
    trustedOrigins.push(parsedUrl.origin);
  } else if (data.BETTER_AUTH_URL && data.BETTER_AUTH_URL.trim()) {
    // If provided in showcase/demo, still validate format safely
    const parsedUrl = validateAuthUrl(data.BETTER_AUTH_URL.trim(), data.APP_RUNTIME_PROFILE);
    validatedAuthUrl = parsedUrl.origin;
    trustedOrigins.push(parsedUrl.origin);
    if (data.BETTER_AUTH_SECRET && data.BETTER_AUTH_SECRET.trim()) {
      validateAuthSecret(data.BETTER_AUTH_SECRET.trim(), data.APP_RUNTIME_PROFILE);
    }
  }

  // Parse any additional trusted origins
  if (data.AUTH_TRUSTED_ORIGINS && data.AUTH_TRUSTED_ORIGINS.trim()) {
    const split = data.AUTH_TRUSTED_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const originStr of split) {
      if (originStr === "*") {
        throw new Error("Configuration error: Wildcard origins are not permitted.");
      }
      try {
        const u = new URL(originStr);
        if (u.protocol !== "https:" && u.protocol !== "http:") {
          throw new Error("Configuration error: Trusted origin must use http or https.");
        }
        if (data.APP_RUNTIME_PROFILE === "production" && u.protocol !== "https:") {
          throw new Error("Configuration error: Trusted origin must use HTTPS in production.");
        }
        if (u.origin !== originStr.replace(/\/$/, "")) {
          throw new Error(
            "Configuration error: Trusted origin must be a root origin with no path or query."
          );
        }
        if (!trustedOrigins.includes(u.origin)) {
          trustedOrigins.push(u.origin);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message.startsWith("Configuration error:")) {
          throw err;
        }
        throw new Error("Configuration error: Invalid trusted origin format.");
      }
    }
  }

  return {
    APP_RUNTIME_PROFILE: data.APP_RUNTIME_PROFILE,
    APP_DATA_BACKEND: data.APP_DATA_BACKEND,
    DATABASE_URL: data.DATABASE_URL?.trim(),
    DATABASE_DIRECT_URL: data.DATABASE_DIRECT_URL?.trim(),
    DATABASE_POOL_MAX: data.DATABASE_POOL_MAX,
    DATABASE_CONNECTION_TIMEOUT_MS: data.DATABASE_CONNECTION_TIMEOUT_MS,
    DATABASE_IDLE_TIMEOUT_MS: data.DATABASE_IDLE_TIMEOUT_MS,
    DATABASE_STATEMENT_TIMEOUT_MS: data.DATABASE_STATEMENT_TIMEOUT_MS,
    BETTER_AUTH_SECRET: data.BETTER_AUTH_SECRET?.trim(),
    BETTER_AUTH_URL: validatedAuthUrl,
    AUTH_TRUSTED_ORIGINS: trustedOrigins,
  };
}

export function getServerEnv(): ServerEnv {
  if (!cachedEnv) {
    cachedEnv = validateServerEnv(process.env);
  }
  return cachedEnv;
}

export function resetServerEnvCache(): void {
  cachedEnv = null;
}

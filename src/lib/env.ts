import "server-only";
import { z } from "zod";

export type AppRuntimeProfile = "showcase" | "production";
export type AppDataBackend = "demo" | "postgres";

const POSTGRES_URL_REGEX = /^postgres(?:ql)?:\/\//i;

const RawServerEnvSchema = z.object({
  APP_RUNTIME_PROFILE: z.enum(["showcase", "production"], {
    errorMap: () => ({ message: "Invalid or missing APP_RUNTIME_PROFILE" }),
  }),
  APP_DATA_BACKEND: z.enum(["demo", "postgres"], {
    errorMap: () => ({ message: "Invalid or missing APP_DATA_BACKEND" }),
  }),
  DATABASE_URL: z.string().optional(),
  DATABASE_DIRECT_URL: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(250).max(60000).default(5000),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(10000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(250).max(60000).default(5000),
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
}

let cachedEnv: ServerEnv | null = null;

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

  return {
    APP_RUNTIME_PROFILE: data.APP_RUNTIME_PROFILE,
    APP_DATA_BACKEND: data.APP_DATA_BACKEND,
    DATABASE_URL: data.DATABASE_URL?.trim(),
    DATABASE_DIRECT_URL: data.DATABASE_DIRECT_URL?.trim(),
    DATABASE_POOL_MAX: data.DATABASE_POOL_MAX,
    DATABASE_CONNECTION_TIMEOUT_MS: data.DATABASE_CONNECTION_TIMEOUT_MS,
    DATABASE_IDLE_TIMEOUT_MS: data.DATABASE_IDLE_TIMEOUT_MS,
    DATABASE_STATEMENT_TIMEOUT_MS: data.DATABASE_STATEMENT_TIMEOUT_MS,
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

import { z } from "zod";

// Server-only runtime safeguard (bypassed in vitest jsdom environment)
if (typeof window !== "undefined" && !process.env.VITEST) {
  throw new Error("src/lib/env.ts is server-only and cannot be imported on the client.");
}

export type AppRuntimeProfile = "showcase" | "production";
export type AppDataBackend = "demo" | "postgres";

const RawServerEnvSchema = z.object({
  APP_RUNTIME_PROFILE: z.enum(["showcase", "production"]).default("showcase"),
  APP_DATA_BACKEND: z.enum(["demo", "postgres"]).default("demo"),
  DATABASE_URL: z.string().optional(),
  DATABASE_DIRECT_URL: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
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
    throw new Error("Invalid server environment configuration");
  }

  const data = parseResult.data;

  // Commercial deployment and backend rules:
  // Rule 1: production + demo is strictly prohibited (fail-closed)
  if (data.APP_RUNTIME_PROFILE === "production" && data.APP_DATA_BACKEND === "demo") {
    throw new Error(
      "Configuration violation: production runtime profile cannot use demo data backend."
    );
  }

  // Rule 2: When backend is postgres, DATABASE_URL is required
  if (data.APP_DATA_BACKEND === "postgres") {
    if (!data.DATABASE_URL || data.DATABASE_URL.trim() === "") {
      throw new Error(
        "Configuration violation: DATABASE_URL is required when APP_DATA_BACKEND is set to postgres."
      );
    }
  }

  return {
    APP_RUNTIME_PROFILE: data.APP_RUNTIME_PROFILE,
    APP_DATA_BACKEND: data.APP_DATA_BACKEND,
    DATABASE_URL: data.DATABASE_URL,
    DATABASE_DIRECT_URL: data.DATABASE_DIRECT_URL || data.DATABASE_URL,
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

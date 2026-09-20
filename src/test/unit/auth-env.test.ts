import { describe, it, expect } from "vitest";
import { validateServerEnv } from "@/lib/env";

const VALID_POSTGRES_URL = "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";
const VALID_DEV_SECRET = "dev-secret-at-least-32-chars-long-with-entropy-12345";
const VALID_PROD_SECRET = "prod-high-entropy-secret-at-least-32-chars-random-string-98765";

describe("Server Auth Environment Validation", () => {
  it("succeeds in showcase demo mode without auth variables", () => {
    const env = validateServerEnv({
      APP_RUNTIME_PROFILE: "showcase",
      APP_DATA_BACKEND: "demo",
    });
    expect(env.APP_RUNTIME_PROFILE).toBe("showcase");
    expect(env.APP_DATA_BACKEND).toBe("demo");
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
    expect(env.BETTER_AUTH_URL).toBeUndefined();
  });

  it("succeeds in showcase postgres mode with valid localhost HTTP url and secret", () => {
    const env = validateServerEnv({
      APP_RUNTIME_PROFILE: "showcase",
      APP_DATA_BACKEND: "postgres",
      DATABASE_URL: VALID_POSTGRES_URL,
      BETTER_AUTH_SECRET: VALID_DEV_SECRET,
      BETTER_AUTH_URL: "http://localhost:3000",
    });
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
    expect(env.AUTH_TRUSTED_ORIGINS).toEqual(["http://localhost:3000"]);
  });

  it("succeeds in production postgres mode with valid HTTPS url and high-entropy secret", () => {
    const env = validateServerEnv({
      APP_RUNTIME_PROFILE: "production",
      APP_DATA_BACKEND: "postgres",
      DATABASE_URL: VALID_POSTGRES_URL,
      BETTER_AUTH_SECRET: VALID_PROD_SECRET,
      BETTER_AUTH_URL: "https://waffarhacars.com",
    });
    expect(env.BETTER_AUTH_URL).toBe("https://waffarhacars.com");
    expect(env.AUTH_TRUSTED_ORIGINS).toEqual(["https://waffarhacars.com"]);
  });

  it("fails when BETTER_AUTH_SECRET is missing under postgres backend", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_URL: "http://localhost:3000",
      })
    ).toThrow("Configuration error: BETTER_AUTH_SECRET is required when using postgres backend.");
  });

  it("fails when BETTER_AUTH_SECRET is shorter than 32 characters", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: "too-short",
        BETTER_AUTH_URL: "http://localhost:3000",
      })
    ).toThrow("Configuration error: BETTER_AUTH_SECRET must be at least 32 characters.");
  });

  it("fails when BETTER_AUTH_SECRET has low entropy", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        BETTER_AUTH_URL: "http://localhost:3000",
      })
    ).toThrow("Configuration error: BETTER_AUTH_SECRET must have sufficient entropy.");
  });

  it("fails in production when BETTER_AUTH_SECRET contains placeholder value", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "production",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: "example-secret-that-is-at-least-32-chars-long",
        BETTER_AUTH_URL: "https://waffarhacars.com",
      })
    ).toThrow("Configuration error: BETTER_AUTH_SECRET contains non-production placeholder value.");
  });

  it("fails when BETTER_AUTH_URL is missing under postgres backend", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_DEV_SECRET,
      })
    ).toThrow("Configuration error: BETTER_AUTH_URL is required when using postgres backend.");
  });

  it("fails when BETTER_AUTH_URL is malformed", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_DEV_SECRET,
        BETTER_AUTH_URL: "not-a-valid-url",
      })
    ).toThrow("Configuration error: BETTER_AUTH_URL must be a valid absolute URL.");
  });

  it("fails when BETTER_AUTH_URL contains credentials", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_DEV_SECRET,
        BETTER_AUTH_URL: "http://admin:password@localhost:3000",
      })
    ).toThrow("Configuration error: BETTER_AUTH_URL must not contain credentials.");
  });

  it("fails when BETTER_AUTH_URL contains query parameters", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_DEV_SECRET,
        BETTER_AUTH_URL: "http://localhost:3000?foo=bar",
      })
    ).toThrow("Configuration error: BETTER_AUTH_URL must not contain query parameters.");
  });

  it("fails when BETTER_AUTH_URL contains URL fragment", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_DEV_SECRET,
        BETTER_AUTH_URL: "http://localhost:3000#section",
      })
    ).toThrow("Configuration error: BETTER_AUTH_URL must not contain a URL fragment.");
  });

  it("fails when BETTER_AUTH_URL contains a sub-path", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_DEV_SECRET,
        BETTER_AUTH_URL: "http://localhost:3000/api/auth",
      })
    ).toThrow("Configuration error: BETTER_AUTH_URL must not contain a sub-path.");
  });

  it("fails when HTTP is used in production profile", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "production",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_PROD_SECRET,
        BETTER_AUTH_URL: "http://waffarhacars.com",
      })
    ).toThrow("Configuration error: BETTER_AUTH_URL must use HTTPS in production.");
  });

  it("fails when localhost is used in production profile", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "production",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_PROD_SECRET,
        BETTER_AUTH_URL: "https://localhost:3000",
      })
    ).toThrow("Configuration error: BETTER_AUTH_URL cannot use localhost in production.");
  });

  it("fails when HTTP is used with non-local hostname outside production", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_DEV_SECRET,
        BETTER_AUTH_URL: "http://external-host.com",
      })
    ).toThrow(
      "Configuration error: HTTP BETTER_AUTH_URL is only permitted on localhost outside production."
    );
  });

  it("fails when wildcard origin is configured", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_DEV_SECRET,
        BETTER_AUTH_URL: "http://localhost:3000",
        AUTH_TRUSTED_ORIGINS: "*",
      })
    ).toThrow("Configuration error: Wildcard origins are not permitted.");
  });

  it("parses multiple valid trusted origins", () => {
    const env = validateServerEnv({
      APP_RUNTIME_PROFILE: "showcase",
      APP_DATA_BACKEND: "postgres",
      DATABASE_URL: VALID_POSTGRES_URL,
      BETTER_AUTH_SECRET: VALID_DEV_SECRET,
      BETTER_AUTH_URL: "http://localhost:3000",
      AUTH_TRUSTED_ORIGINS: "http://127.0.0.1:3000, https://admin.waffarhacars.local",
    });
    expect(env.AUTH_TRUSTED_ORIGINS).toEqual([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://admin.waffarhacars.local",
    ]);
  });

  it("fails when AUTH_TRUSTED_ORIGINS contains a non-local HTTP URL outside production", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_DEV_SECRET,
        BETTER_AUTH_URL: "http://localhost:3000",
        AUTH_TRUSTED_ORIGINS: "http://remote-site.com",
      })
    ).toThrow(
      "Configuration error: HTTP Trusted origin is only permitted on localhost outside production."
    );
  });

  it("fails when AUTH_TRUSTED_ORIGINS contains an HTTP URL in production", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "production",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_PROD_SECRET,
        BETTER_AUTH_URL: "https://waffarhacars.com",
        AUTH_TRUSTED_ORIGINS: "http://admin.waffarhacars.com",
      })
    ).toThrow("Configuration error: Trusted origin must use HTTPS in production.");
  });

  it("fails when AUTH_TRUSTED_ORIGINS contains https://localhost in production", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "production",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_PROD_SECRET,
        BETTER_AUTH_URL: "https://waffarhacars.com",
        AUTH_TRUSTED_ORIGINS: "https://localhost",
      })
    ).toThrow("Configuration error: Trusted origin cannot use localhost in production.");
  });

  it("fails when AUTH_TRUSTED_ORIGINS contains https://127.0.0.1 in production", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "production",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_PROD_SECRET,
        BETTER_AUTH_URL: "https://waffarhacars.com",
        AUTH_TRUSTED_ORIGINS: "https://127.0.0.1",
      })
    ).toThrow("Configuration error: Trusted origin cannot use localhost in production.");
  });

  it("fails when AUTH_TRUSTED_ORIGINS contains an HTTPS .local hostname in production", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "production",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_PROD_SECRET,
        BETTER_AUTH_URL: "https://waffarhacars.com",
        AUTH_TRUSTED_ORIGINS: "https://admin.waffarhacars.local",
      })
    ).toThrow("Configuration error: Trusted origin cannot use localhost in production.");
  });

  it("fails when AUTH_TRUSTED_ORIGINS contains sub-paths or query parameters", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_DEV_SECRET,
        BETTER_AUTH_URL: "http://localhost:3000",
        AUTH_TRUSTED_ORIGINS: "https://admin.waffarhacars.com/subpath",
      })
    ).toThrow("Configuration error: Trusted origin must not contain a sub-path.");

    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_DEV_SECRET,
        BETTER_AUTH_URL: "http://localhost:3000",
        AUTH_TRUSTED_ORIGINS: "https://admin.waffarhacars.com?param=val",
      })
    ).toThrow("Configuration error: Trusted origin must not contain query parameters.");
  });

  it("fails when AUTH_TRUSTED_ORIGINS contains credentials", () => {
    expect(() =>
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: VALID_DEV_SECRET,
        BETTER_AUTH_URL: "http://localhost:3000",
        AUTH_TRUSTED_ORIGINS: "https://user:pass@admin.waffarhacars.com",
      })
    ).toThrow("Configuration error: Trusted origin must not contain credentials.");
  });

  it("sanitizes errors and never prints secrets in error messages", () => {
    const sensitiveSecret = "sensitive-super-secret-key-12345-never-leak";
    try {
      validateServerEnv({
        APP_RUNTIME_PROFILE: "production",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: VALID_POSTGRES_URL,
        BETTER_AUTH_SECRET: sensitiveSecret,
        BETTER_AUTH_URL: "http://insecure-http.com",
      });
      expect.unreachable("should have thrown");
    } catch (err: unknown) {
      const message = (err as Error).message;
      expect(message).not.toContain(sensitiveSecret);
      expect(message).toContain("Configuration error");
    }
  });
});

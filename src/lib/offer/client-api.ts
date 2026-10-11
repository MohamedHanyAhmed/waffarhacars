export interface ApiFailure {
  ok: false;
  status: number;
  code: string;
  details: Array<{ path: string }>;
}

export interface ApiSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

/** Same-origin, cookie-backed request. Server messages are deliberately discarded. */
export async function offerApi<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return { ok: true, status: response.status, data: body as T };
  const error = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return {
    ok: false,
    status: response.status,
    code: typeof error.error === "string" ? error.error : "UNEXPECTED_ERROR",
    details: Array.isArray(error.details)
      ? error.details
          .filter((item): item is { path: string } =>
            Boolean(item && typeof item === "object" && typeof item.path === "string")
          )
          .map(({ path }) => ({ path }))
      : [],
  };
}

export function mutationOutcomeUnknown(status: number): boolean {
  return status >= 500;
}

export function offerFailureMessage(failure: ApiFailure, t: (path: string) => string): string {
  if (failure.status === 403) return t("staffOffers.denied");
  if (failure.status === 404) return t("staffOffers.missing");
  if (failure.status === 409) return t("staffOffers.conflict");
  if (failure.code === "OFFER_APPROVAL_BLOCKED") return t("staffOffers.repositoryUnavailable");
  if (failure.code === "VALIDATION_ERROR") return t("staffOffers.validation");
  return t("staffOffers.genericError");
}

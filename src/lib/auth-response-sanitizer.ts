/**
 * Specialized response sanitizer for browser-facing Better Auth responses.
 *
 * Requirements:
 * 1. Matches exact normalized pathname `/api/auth/sign-in/email`.
 * 2. Applies sanitization only to successful (2xx) JSON responses from that endpoint.
 * 3. Returns all unrelated Better Auth responses without consuming their bodies.
 * 4. When modifying the body, deletes session tokens from body, recalculates Content-Length,
 *    and preserves all other headers including Set-Cookie.
 */
export async function sanitizeAuthResponse(req: { url: string }, res: Response): Promise<Response> {
  let pathname = "";
  try {
    const url = new URL(req.url, "http://localhost");
    pathname = url.pathname;
  } catch {
    return res;
  }

  // Strictly match exact normalized pathname
  if (pathname !== "/api/auth/sign-in/email") {
    return res;
  }

  // Only sanitize successful responses (2xx)
  if (!res.ok) {
    return res;
  }

  // Only sanitize JSON responses
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return res;
  }

  // Consume and inspect JSON body
  const rawText = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return new Response(rawText, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return new Response(rawText, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }

  const obj = { ...(data as Record<string, unknown>) };
  let modified = false;

  if ("token" in obj) {
    delete obj.token;
    modified = true;
  }

  if (obj.session && typeof obj.session === "object" && !Array.isArray(obj.session)) {
    const sessionObj = { ...(obj.session as Record<string, unknown>) };
    if ("token" in sessionObj) {
      delete sessionObj.token;
      obj.session = sessionObj;
      modified = true;
    }
  }

  if (!modified) {
    return new Response(rawText, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }

  const serialized = JSON.stringify(obj);

  // Clone headers and preserve all cookies and metadata
  const newHeaders = new Headers(res.headers);

  // Remove stale representation headers
  newHeaders.delete("content-length");
  newHeaders.delete("content-encoding");

  // Recalculate exact Content-Length in bytes
  newHeaders.set("Content-Length", String(Buffer.byteLength(serialized, "utf-8")));

  if (!newHeaders.has("Cache-Control")) {
    newHeaders.set("Cache-Control", "no-store");
  }

  return new Response(serialized, {
    status: res.status,
    statusText: res.statusText,
    headers: newHeaders,
  });
}

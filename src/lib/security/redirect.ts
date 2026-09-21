/**
 * Strictly sanitizes redirect URLs to prevent open-redirect vulnerabilities.
 * Only safe, same-origin relative paths are permitted.
 *
 * Rules:
 * - Must start with a single '/'
 * - Must not start with '//' (protocol-relative) or '/\'
 * - Must not contain control characters (\r, \n, \0)
 * - Must not contain URI schemes (javascript:, data:, https:, etc.)
 * - Returns default '/' if any check fails.
 */
export function sanitizeReturnUrl(raw: string | null | undefined, fallback = "/"): string {
  if (!raw || typeof raw !== "string") {
    return fallback;
  }

  const trimmed = raw.trim();

  // Must begin with single forward slash, and not double-slash or slash-backslash
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return fallback;
  }

  // Reject control characters or newlines
  if (/[\r\n\0\t\x00-\x1f]/.test(trimmed)) {
    return fallback;
  }

  // Reject anything with a scheme like javascript:, data:, http:, https:
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return fallback;
  }

  // Decode URI components to catch encoded protocol-relative or scheme attempts (e.g. /%2f%2fevil.com, /%5c%5cevil.com)
  try {
    let decoded = decodeURIComponent(trimmed);
    if (decoded.includes("%")) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        return fallback;
      }
    }
    const stripped = decoded.replace(/^[/\\]+/, "");
    const pathPart = stripped.split(/[?#]/)[0];
    if (
      decoded.startsWith("//") ||
      decoded.startsWith("/\\") ||
      decoded.startsWith("\\\\") ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded) ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(pathPart) ||
      /[\r\n\0\t\x00-\x1f]/.test(decoded)
    ) {
      return fallback;
    }
  } catch {
    // Malformed URI encoding
    return fallback;
  }

  // Parse as relative against a dummy localhost base
  try {
    const dummyBase = "http://localhost";
    const parsed = new URL(trimmed, dummyBase);

    // Origin must remain dummyBase
    if (parsed.origin !== dummyBase) {
      return fallback;
    }

    // Must still start with a single slash
    const result = parsed.pathname + parsed.search + parsed.hash;
    if (!result.startsWith("/") || result.startsWith("//") || result.startsWith("/\\")) {
      return fallback;
    }

    return result;
  } catch {
    return fallback;
  }
}

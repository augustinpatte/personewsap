const ALLOWED_LOGIN_REDIRECTS = new Set(["/account", "/delete-account"]);

export function resolveSafeLoginRedirect(rawRedirect: string | null | undefined): string {
  if (!rawRedirect) {
    return "/account";
  }

  let decoded = rawRedirect.trim();

  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return "/account";
  }

  if (
    !decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    decoded.toLowerCase().startsWith("javascript:")
  ) {
    return "/account";
  }

  return ALLOWED_LOGIN_REDIRECTS.has(decoded) ? decoded : "/account";
}

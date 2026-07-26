/**
 * Gate document navigations only. API routes, RSC/module fetches, and health
 * probes answer for themselves — bouncing those would break soft-nav and probes.
 */
export function isDocumentNavigation(request: {
  method: string;
  headers: { get(name: string): string | null };
}): boolean {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  const dest = request.headers.get("sec-fetch-dest");
  if (dest) {
    return dest === "document";
  }

  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

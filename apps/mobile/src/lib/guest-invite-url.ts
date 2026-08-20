export function parseGuestCapability(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const segments = url.pathname.split("/").filter(Boolean);
    const encodedCapability =
      url.protocol === "multiplex:" && url.hostname === "watch-together"
        ? segments[0] === "guest"
          ? segments[1]
          : undefined
        : segments[0] === "watch-together" && segments[1] === "guest"
          ? segments[2]
          : undefined;
    return encodedCapability ? decodeURIComponent(encodedCapability) : null;
  } catch {
    return null;
  }
}

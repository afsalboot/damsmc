export function isCrossSiteWrite(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    // Next can normalize the internal URL hostname to localhost. The browser's
    // destination is Host; deployments must preserve it at the trusted proxy.
    const host = request.headers.get("host") || request.nextUrl.host;
    if (/[\s/\\?#@]/.test(host)) return true;
    const destination = new URL(`${request.nextUrl.protocol}//${host}`);
    return origin !== destination.origin;
  } catch {
    return true;
  }
}

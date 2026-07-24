import { headers } from "next/headers";

export const DEFAULT_SITE_ORIGIN =
  "https://minecraft-kr-server-list.korcard001.chatgpt.site";

type HeaderReader = {
  get(name: string): string | null;
};

export function configuredSiteOrigin() {
  return normalizedOrigin(process.env.NEXT_PUBLIC_SITE_URL) ?? DEFAULT_SITE_ORIGIN;
}

export async function requestSiteOrigin() {
  const requestHeaders = await headers();
  return siteOriginFromHeaders(requestHeaders);
}

export function siteOriginFromHeaders(requestHeaders: HeaderReader) {
  const configured = new URL(configuredSiteOrigin());
  const forwardedHost = firstHeaderValue(requestHeaders.get("x-forwarded-host"));
  const requestHost = forwardedHost ?? firstHeaderValue(requestHeaders.get("host"));
  if (!requestHost) return configured.origin;

  const forwardedProtocol = firstHeaderValue(requestHeaders.get("x-forwarded-proto"));
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : requestHost.startsWith("localhost") || requestHost.startsWith("127.0.0.1")
        ? "http"
        : "https";

  try {
    const requestOrigin = new URL(`${protocol}://${requestHost}`);
    return localMetadataHost(requestOrigin.hostname)
      ? requestOrigin.origin
      : configured.origin;
  } catch {
    return configured.origin;
  }
}

function normalizedOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function firstHeaderValue(value: string | null) {
  const first = value?.split(",", 1)[0]?.trim();
  return first && !/[\s/@\\]/.test(first) ? first : null;
}

function localMetadataHost(requestHostname: string) {
  const hostname = requestHostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1";
}

import { userAuthEnv } from "@/lib/user-auth";

export async function GET(request: Request) {
  const environment = await userAuthEnv();
  const localPreview = new Set(["localhost", "127.0.0.1", "::1"]).has(new URL(request.url).hostname)
    && environment.AUTH_LOCAL_PREVIEW === "true";
  const email = hasMinimumLength(environment.AUTH_CODE_SECRET, 24)
    && (localPreview || (hasMinimumLength(environment.RESEND_API_KEY, 12) && isEmailLike(environment.AUTH_EMAIL_FROM)));
  return Response.json({
    sites: environment.SITES_AUTH_ENABLED === "true",
    email,
  }, { headers: { "Cache-Control": "no-store" } });
}

function hasMinimumLength(value: string | undefined, minimum: number) {
  return typeof value === "string" && value.length >= minimum;
}

function isEmailLike(value: string | undefined) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

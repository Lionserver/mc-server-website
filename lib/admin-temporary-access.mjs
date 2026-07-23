export const MAX_TEMPORARY_ADMIN_ACCESS_SECONDS = 60 * 60;

/**
 * Temporarily disable the inner admin login behind a private outer access policy.
 * When the outer policy forwards a user email, it must still match the configured actor.
 * @param {string | null | undefined} authenticatedEmail
 * @param {string | null | undefined} adminEmail
 * @param {string | null | undefined} configuredExpiry
 * @param {number} now
 * @returns {{ email: string; expiresAt: number; identitySource: "sites-user-header" | "configured-actor" } | null}
 */
export function temporaryAdminSession(authenticatedEmail, adminEmail, configuredExpiry, now) {
  const currentEmail = authenticatedEmail?.trim().toLowerCase() ?? "";
  const configuredEmail = adminEmail?.trim().toLowerCase() ?? "";
  if (!Number.isSafeInteger(now)) return null;
  if (!/^\d{10}$/.test(configuredExpiry ?? "")) return null;
  const expiresAt = Number(configuredExpiry);
  const secondsRemaining = expiresAt - now;
  if (configuredEmail.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(configuredEmail)) return null;
  if (currentEmail && currentEmail !== configuredEmail) return null;
  if (!Number.isSafeInteger(expiresAt)) return null;
  if (secondsRemaining <= 0 || secondsRemaining > MAX_TEMPORARY_ADMIN_ACCESS_SECONDS) return null;
  return {
    email: configuredEmail,
    expiresAt,
    identitySource: currentEmail ? "sites-user-header" : "configured-actor",
  };
}

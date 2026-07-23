export const MAX_TEMPORARY_ADMIN_ACCESS_SECONDS = 60 * 60;

/**
 * Allow a Sites-authenticated user to enter the admin console for at most one hour.
 * @param {string | null | undefined} authenticatedEmail
 * @param {string | null | undefined} allowedEmail
 * @param {string | null | undefined} configuredExpiry
 * @param {number} now
 * @returns {{ email: string; expiresAt: number } | null}
 */
export function temporaryAdminSession(authenticatedEmail, allowedEmail, configuredExpiry, now) {
  const currentEmail = authenticatedEmail?.trim().toLowerCase() ?? "";
  const configuredEmail = allowedEmail?.trim().toLowerCase() ?? "";
  if (!/^\d{10}$/.test(configuredExpiry ?? "")) return null;
  const expiresAt = Number(configuredExpiry);
  const secondsRemaining = expiresAt - now;
  if (!currentEmail || !configuredEmail || currentEmail !== configuredEmail) return null;
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(expiresAt)) return null;
  if (secondsRemaining <= 0 || secondsRemaining > MAX_TEMPORARY_ADMIN_ACCESS_SECONDS) return null;
  return { email: configuredEmail, expiresAt };
}

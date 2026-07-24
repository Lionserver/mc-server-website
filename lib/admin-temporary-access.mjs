export const MAX_TEMPORARY_ADMIN_ACCESS_SECONDS = 0;

/**
 * The previous email-header bypass was intentionally retired. An HTTP request
 * header is not an administrator credential, even when an outer access policy
 * usually supplies it. Keep this null-returning shim so old imports fail closed.
 * @param {string | null | undefined} authenticatedEmail
 * @param {string | null | undefined} adminEmail
 * @param {string | null | undefined} configuredExpiry
 * @param {number} now
 * @returns {{ email: string; expiresAt: number; identitySource: "sites-user-header" | "configured-actor" } | null}
 */
export function temporaryAdminSession(authenticatedEmail, adminEmail, configuredExpiry, now) {
  void authenticatedEmail;
  void adminEmail;
  void configuredExpiry;
  void now;
  return null;
}

/**
 * Derive the display phase without mutating stored publication state.
 * Active windows use the half-open interval [startsAt, endsAt).
 * @param {{ status: string; startsAt: number; endsAt: number; deletedAt?: number | null }} announcement
 * @param {number} now
 */
export function announcementPhase(announcement, now) {
  if (announcement.deletedAt != null) return "deleted";
  if (announcement.status === "archived") return "archived";
  if (announcement.status !== "published") return "draft";
  if (now < announcement.startsAt) return "scheduled";
  if (now >= announcement.endsAt) return "expired";
  return "active";
}

/**
 * Pick the first future time at which the public announcement set can change.
 * @param {Array<{ endsAt: number }>} activeAnnouncements
 * @param {number | null} nextStartAt
 * @param {number} now
 */
export function nextAnnouncementTransition(activeAnnouncements, nextStartAt, now) {
  const candidates = activeAnnouncements
    .map((announcement) => announcement.endsAt)
    .concat(nextStartAt == null ? [] : [nextStartAt])
    .filter((value) => Number.isSafeInteger(value) && value > now);
  return candidates.length ? Math.min(...candidates) : null;
}

const INTERNAL_ORIGIN = "https://minecraft.kr";
const THEME_STORAGE_KEY = "minecraft-kr-theme";

/**
 * Keep post-authentication navigation inside this application.
 * @param {string | null | undefined} candidate
 * @param {string} [fallback]
 */
export function safeInternalReturnTo(candidate, fallback = "/operator") {
  if (!candidate || !candidate.startsWith("/")) return fallback;
  try {
    const target = new URL(candidate, INTERNAL_ORIGIN);
    if (target.origin !== INTERNAL_ORIGIN) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * @param {string | null | undefined} storedTheme
 * @param {boolean} systemPrefersDark
 * @returns {"light" | "dark"}
 */
export function resolveThemePreference(storedTheme, systemPrefersDark) {
  if (storedTheme === "light" || storedTheme === "dark") return storedTheme;
  return systemPrefersDark ? "dark" : "light";
}

/** @returns {"light" | "dark"} */
export function readThemePreference() {
  if (typeof window === "undefined") return "light";
  let storedTheme = null;
  let systemPrefersDark = false;
  try {
    storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {}
  try {
    systemPrefersDark = Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  } catch {}
  return resolveThemePreference(storedTheme, systemPrefersDark);
}

/** @param {"light" | "dark"} theme */
export function storeThemePreference(theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {}
}

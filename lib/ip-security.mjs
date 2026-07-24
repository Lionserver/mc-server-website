/**
 * Parse and canonicalize an IP literal without performing DNS resolution.
 * IPv6 values are returned as eight lower-case hexadecimal groups so alternate
 * spellings produce the same security fingerprint.
 *
 * @param {string} rawValue
 * @returns {string | null}
 */
export function normalizeIpAddress(rawValue) {
  let value = rawValue.trim().toLowerCase();
  if (!value || value.length > 64 || value.includes("%")) return null;
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  const ipv4WithPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPort) value = ipv4WithPort[1];

  const ipv4 = parseIpv4(value);
  if (ipv4) return ipv4.join(".");
  const ipv6 = parseIpv6(value);
  return ipv6 ? ipv6.map((group) => group.toString(16)).join(":") : null;
}

/**
 * Return the IP version for a normalized or raw address.
 *
 * @param {string} value
 * @returns {0 | 4 | 6}
 */
export function ipAddressVersion(value) {
  const normalized = normalizeIpAddress(value);
  if (!normalized) return 0;
  return normalized.includes(":") ? 6 : 4;
}

/**
 * Reject non-global addresses before any outbound socket is created. The
 * ranges include loopback, private/link-local space, carrier NAT, benchmark
 * and documentation networks, multicast, IPv4-mapped IPv6, transition ranges,
 * and non-global IPv6 space.
 *
 * @param {string} value
 */
export function isPrivateOrReservedIp(value) {
  const normalized = normalizeIpAddress(value);
  if (!normalized) return true;
  const ipv4 = parseIpv4(normalized);
  if (ipv4) return isPrivateOrReservedIpv4(ipv4);

  const groups = parseIpv6(normalized);
  if (!groups) return true;
  const bytes = groups.flatMap((group) => [group >> 8, group & 0xff]);

  // IPv4-compatible and IPv4-mapped IPv6 literals must inherit the IPv4
  // classification instead of bypassing it with an IPv6 spelling.
  const firstTenZero = bytes.slice(0, 10).every((byte) => byte === 0);
  if (firstTenZero && ((bytes[10] === 0 && bytes[11] === 0) || (bytes[10] === 0xff && bytes[11] === 0xff))) {
    return isPrivateOrReservedIpv4(bytes.slice(12));
  }

  // Only global-unicast 2000::/3 is eligible for an Internet socket.
  if ((bytes[0] & 0xe0) !== 0x20) return true;
  // Teredo, ORCHID/ORCHIDv2, benchmarking, documentation, and 6to4.
  if (groups[0] === 0x2001 && groups[1] === 0x0000) return true;
  if (groups[0] === 0x2001 && groups[1] === 0x0002) return true;
  if (groups[0] === 0x2001 && (groups[1] & 0xfff0) === 0x0010) return true;
  if (groups[0] === 0x2001 && (groups[1] & 0xfff0) === 0x0020) return true;
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;
  if (groups[0] === 0x2002 || groups[0] === 0x3ffe) return true;
  return false;
}

/**
 * Reject names that are inherently local before sending a DNS query.
 *
 * @param {string} host
 */
export function isPrivateHostName(host) {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const ip = normalizeIpAddress(normalized);
  if (ip) return isPrivateOrReservedIp(ip);
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || normalized.endsWith(".home.arpa");
}

/**
 * Use a stable /64 identity for IPv6 abuse controls so rotating the interface
 * portion cannot trivially evade a daily duplicate check.
 *
 * @param {string} value
 */
export function networkFingerprintAddress(value) {
  const normalized = normalizeIpAddress(value);
  if (!normalized) return "local";
  if (!normalized.includes(":")) return normalized;
  return `${normalized.split(":").slice(0, 4).join(":")}::/64`;
}

/** @param {string} value */
function parseIpv4(value) {
  const parts = value.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return null;
  const bytes = parts.map(Number);
  return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : null;
}

/** @param {string} value */
function parseIpv6(value) {
  if (!value.includes(":") || !/^[0-9a-f:.]+$/.test(value)) return null;
  let expanded = value;
  if (expanded.includes(".")) {
    const lastColon = expanded.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = parseIpv4(expanded.slice(lastColon + 1));
    if (!ipv4) return null;
    expanded = `${expanded.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }
  if (expanded.indexOf("::") !== expanded.lastIndexOf("::")) return null;
  const compressed = expanded.includes("::");
  const [leftText, rightText = ""] = expanded.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((compressed && missing < 1) || (!compressed && missing !== 0)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right].map((part) => Number.parseInt(part, 16));
  return groups.length === 8 ? groups : null;
}

/** @param {number[]} bytes */
function isPrivateOrReservedIpv4(bytes) {
  const [a, b, c] = bytes;
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

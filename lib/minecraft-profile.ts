export type MinecraftProfile = {
  uuid: string;
  name: string;
};

type CachedProfile = {
  minecraft_uuid: string | null;
  canonical_name: string;
  status: "resolved" | "not_found";
  expires_at: number;
};

const PROFILE_TTL_SECONDS = 86_400;
const NOT_FOUND_TTL_SECONDS = 900;
const LOOKUP_TIMEOUT_MS = 5_000;
const pendingLookups = new Map<string, Promise<MinecraftProfile>>();

export class MinecraftProfileLookupError extends Error {
  constructor(
    public readonly code: "invalid" | "not_found" | "unavailable",
    public readonly nickname: string,
  ) {
    super(code === "invalid"
      ? "Minecraft Java 닉네임 형식이 아닙니다."
      : code === "not_found"
        ? "존재하는 Minecraft Java 계정을 찾지 못했습니다."
        : "Minecraft 계정 확인 서비스가 잠시 지연되고 있습니다.");
    this.name = "MinecraftProfileLookupError";
  }
}

export function isMinecraftNickname(value: string) {
  return /^[A-Za-z0-9_]{3,16}$/.test(value);
}

export async function ensureMinecraftProfileSchema(db: D1Database) {
  if (process.env.NODE_ENV === "production") return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS minecraft_profiles (
      nickname_key TEXT PRIMARY KEY NOT NULL,
      canonical_name TEXT NOT NULL,
      minecraft_uuid TEXT,
      status TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS minecraft_profiles_uuid_idx ON minecraft_profiles (minecraft_uuid)"),
    db.prepare("CREATE INDEX IF NOT EXISTS minecraft_profiles_expiry_idx ON minecraft_profiles (expires_at)"),
  ]);
}

export async function resolveMinecraftProfile(db: D1Database, rawNickname: string): Promise<MinecraftProfile> {
  const nickname = rawNickname.trim();
  if (!isMinecraftNickname(nickname)) throw new MinecraftProfileLookupError("invalid", nickname);
  await ensureMinecraftProfileSchema(db);
  const nicknameKey = nickname.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const cached = await db.prepare(`SELECT minecraft_uuid, canonical_name, status, expires_at
    FROM minecraft_profiles WHERE nickname_key = ? LIMIT 1`).bind(nicknameKey).first<CachedProfile>();
  if (cached && cached.expires_at > now) {
    if (cached.status === "resolved" && cached.minecraft_uuid) {
      const profile = { uuid: cached.minecraft_uuid, name: cached.canonical_name };
      await backfillProfileReferences(db, nicknameKey, profile);
      return profile;
    }
    throw new MinecraftProfileLookupError("not_found", nickname);
  }

  const pending = pendingLookups.get(nicknameKey);
  if (pending) return pending;
  const lookup = fetchMinecraftProfile(db, nickname, nicknameKey, now).finally(() => pendingLookups.delete(nicknameKey));
  pendingLookups.set(nicknameKey, lookup);
  return lookup;
}

export async function resolveMinecraftProfiles(db: D1Database, nicknames: string[]) {
  const unique = [...new Map(nicknames.map((nickname) => [nickname.trim().toLowerCase(), nickname.trim()])).values()];
  const resolved = new Map<string, MinecraftProfile>();
  for (let index = 0; index < unique.length; index += 3) {
    const names = unique.slice(index, index + 3);
    const profiles = await Promise.all(names.map((nickname) => resolveMinecraftProfile(db, nickname)));
    profiles.forEach((profile, profileIndex) => {
      resolved.set(names[profileIndex].toLowerCase(), profile);
      resolved.set(profile.name.toLowerCase(), profile);
    });
  }
  return resolved;
}

async function fetchMinecraftProfile(db: D1Database, nickname: string, nicknameKey: string, now: number) {
  let response: Response;
  try {
    response = await fetch(`https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodeURIComponent(nickname)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch {
    throw new MinecraftProfileLookupError("unavailable", nickname);
  }

  if (response.status === 404 || response.status === 204) {
    await writeProfileCache(db, nicknameKey, nickname, null, "not_found", now + NOT_FOUND_TTL_SECONDS, now);
    throw new MinecraftProfileLookupError("not_found", nickname);
  }
  if (!response.ok) throw new MinecraftProfileLookupError("unavailable", nickname);

  const body = await response.json().catch(() => null) as { id?: unknown; name?: unknown } | null;
  const uuid = typeof body?.id === "string" ? body.id.replaceAll("-", "").toLowerCase() : "";
  const canonicalName = typeof body?.name === "string" ? body.name : "";
  if (!/^[a-f0-9]{32}$/.test(uuid) || !isMinecraftNickname(canonicalName)) {
    throw new MinecraftProfileLookupError("unavailable", nickname);
  }
  await writeProfileCache(db, nicknameKey, canonicalName, uuid, "resolved", now + PROFILE_TTL_SECONDS, now);
  const profile = { uuid, name: canonicalName } satisfies MinecraftProfile;
  await backfillProfileReferences(db, nicknameKey, profile);
  return profile;
}

async function backfillProfileReferences(db: D1Database, nicknameKey: string, profile: MinecraftProfile) {
  await db.batch([
    db.prepare(`UPDATE server_staff_profiles SET nickname = ?, minecraft_uuid = ?
      WHERE minecraft_uuid IS NULL AND lower(nickname) = ?`).bind(profile.name, profile.uuid, nicknameKey),
    db.prepare(`UPDATE server_votes SET nickname = ?, minecraft_uuid = ?
      WHERE minecraft_uuid IS NULL AND lower(nickname) = ?`).bind(profile.name, profile.uuid, nicknameKey),
  ]).catch(() => undefined);
}

function writeProfileCache(
  db: D1Database,
  nicknameKey: string,
  canonicalName: string,
  uuid: string | null,
  status: CachedProfile["status"],
  expiresAt: number,
  now: number,
) {
  return db.prepare(`INSERT INTO minecraft_profiles
    (nickname_key, canonical_name, minecraft_uuid, status, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(nickname_key) DO UPDATE SET canonical_name = excluded.canonical_name,
      minecraft_uuid = excluded.minecraft_uuid, status = excluded.status,
      expires_at = excluded.expires_at, updated_at = excluded.updated_at`)
    .bind(nicknameKey, canonicalName, uuid, status, expiresAt, now).run();
}

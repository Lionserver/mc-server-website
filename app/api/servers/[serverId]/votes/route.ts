import { directoryEnv, directoryErrorResponse } from "@/lib/server-directory";
import { ensurePublicDirectorySchema, publicServerDetail } from "@/lib/public-directory";
import { assertSameOrigin } from "@/lib/user-auth";
import { broadcastDirectoryUpdate } from "@/lib/directory-realtime";
import { MinecraftProfileLookupError, resolveMinecraftProfile } from "@/lib/minecraft-profile";
import { assertVoteSourceAllowed, purgeExpiredVoteIpMetadata, voteSourceMetadata } from "@/lib/vote-source";

type RouteContext = { params: Promise<{ serverId: string }> | { serverId: string } };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { serverId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(serverId)) return Response.json({ error: "invalid server id" }, { status: 400 });
    const environment = await directoryEnv();
    const server = await publicServerDetail(environment.DB, serverId);
    return server
      ? Response.json({ votes: server.recentVotes, monthlyTop: server.monthlyTop, total: server.votes }, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: "not found" }, { status: 404 });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const { serverId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(serverId)) return Response.json({ error: "invalid server id" }, { status: 400 });
    const body = await request.json().catch(() => ({})) as { nickname?: unknown };
    const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
    if (!/^[A-Za-z0-9_]{3,16}$/.test(nickname)) {
      return Response.json({ error: "Minecraft Java 닉네임을 3-16자로 입력해 주세요." }, { status: 400 });
    }
    const environment = await directoryEnv();
    await ensurePublicDirectorySchema(environment.DB);
    const server = await environment.DB.prepare("SELECT id FROM directory_servers WHERE id = ? AND status = 'active' AND deleted_at IS NULL")
      .bind(serverId).first<{ id: string }>();
    if (!server) return Response.json({ error: "not found" }, { status: 404 });
    const now = Math.floor(Date.now() / 1000);
    const source = await voteSourceMetadata(request, serverId, environment);
    await assertVoteSourceAllowed(environment.DB, source.ipHash, now);
    const day = new Date((now + 9 * 3600) * 1000).toISOString().slice(0, 10);
    const priorSourceVote = await environment.DB.prepare(`SELECT 1 duplicate_vote FROM server_votes
      WHERE server_id = ? AND vote_day = ? AND source_fingerprint IN (?, ?) LIMIT 1`)
      .bind(serverId, day, source.fingerprint, source.legacyFingerprint).first();
    if (priorSourceVote) {
      return Response.json({ error: "이 접속 환경에서는 오늘 이미 추천했습니다." }, { status: 409 });
    }
    let profile;
    try {
      profile = await resolveMinecraftProfile(environment.DB, nickname);
    } catch (error) {
      if (error instanceof MinecraftProfileLookupError) {
        return Response.json({ error: error.code === "not_found"
          ? "존재하는 Minecraft Java 계정의 닉네임을 입력해 주세요."
          : "Minecraft 계정 확인이 지연되고 있습니다. 잠시 후 다시 추천해 주세요." },
        { status: error.code === "unavailable" ? 503 : 400 });
      }
      throw error;
    }
    const id = crypto.randomUUID().replaceAll("-", "");
    try {
      await environment.DB.prepare(`INSERT INTO server_votes
        (id, server_id, nickname, minecraft_uuid, vote_day, source_fingerprint,
          source_ip_masked, source_ip_hash, source_ip_version, reward_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
        .bind(id, serverId, profile.name, profile.uuid, day, source.fingerprint,
          source.ipMasked, source.ipHash, source.ipVersion, now).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/UNIQUE constraint failed/i.test(message)) {
        const duplicateNickname = await environment.DB.prepare(`SELECT 1 duplicate_vote FROM server_votes
          WHERE server_id = ? AND (minecraft_uuid = ? OR lower(nickname) = lower(?)) AND vote_day = ? LIMIT 1`)
          .bind(serverId, profile.uuid, profile.name, day).first();
        return Response.json({ error: duplicateNickname
          ? "이 닉네임은 오늘 이미 추천했습니다."
          : "이 접속 환경에서는 오늘 이미 추천했습니다." }, { status: 409 });
      }
      throw error;
    }
    await purgeExpiredVoteIpMetadata(environment.DB, now).catch(() => undefined);
    await broadcastDirectoryUpdate(environment, serverId, now).catch(() => false);
    return Response.json({ vote: { id, nickname: profile.name, minecraftUuid: profile.uuid, rewardStatus: "pending", createdAt: now } }, { status: 201 });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}

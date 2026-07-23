import { adminErrorResponse, requireAdmin } from "@/lib/admin-security";
import { ensurePublicDirectorySchema } from "@/lib/public-directory";
import { purgeExpiredVoteIpMetadata, synchronizeVoteSourceBlocks, voteIpSearchHash } from "@/lib/vote-source";

type VoteLogRow = {
  id: string;
  server_id: string;
  server_title: string | null;
  server_address: string | null;
  owner_email: string | null;
  nickname: string;
  minecraft_uuid: string | null;
  vote_day: string;
  reward_status: string;
  source_ip_masked: string;
  source_ip_key: string;
  source_ip_version: number;
  source_block_id: string | null;
  source_block_reason: string | null;
  source_block_expires_at: number | null;
  created_at: number;
};

export async function GET(request: Request) {
  try {
    const { environment } = await requireAdmin(request);
    await ensurePublicDirectorySchema(environment.DB);
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const requestedServerId = url.searchParams.get("serverId") ?? "";
    const serverId = /^[a-f0-9]{32}$/.test(requestedServerId) ? requestedServerId : "";
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
    const offset = (page - 1) * limit;
    const now = Math.floor(Date.now() / 1000);
    await Promise.all([
      purgeExpiredVoteIpMetadata(environment.DB, now),
      synchronizeVoteSourceBlocks(environment.DB, now),
    ]);

    const where: string[] = ["1 = 1"];
    const bindings: Array<string | number> = [];
    if (serverId) {
      where.push("v.server_id = ?");
      bindings.push(serverId);
    }
    if (query) {
      const compactUuid = query.replaceAll("-", "").toLowerCase();
      const ipHash = await voteIpSearchHash(query, environment);
      where.push(`(instr(lower(COALESCE(d.title, '')), lower(?)) > 0 OR instr(lower(COALESCE(d.address, '')), lower(?)) > 0
        OR instr(lower(COALESCE(d.owner_email, '')), lower(?)) > 0 OR instr(lower(v.nickname), lower(?)) > 0
        OR lower(COALESCE(v.minecraft_uuid, '')) = ? OR instr(lower(v.source_ip_masked), lower(?)) > 0 OR v.source_ip_hash = ?)`);
      bindings.push(query, query, query, query, compactUuid, query, ipHash ?? "__no_ip_match__");
    }
    const whereSql = where.join(" AND ");

    const [rows, count, summary] = await Promise.all([
      environment.DB.prepare(`SELECT v.id, v.server_id, d.title server_title, d.address server_address, d.owner_email,
        v.nickname, v.minecraft_uuid, v.vote_day, v.reward_status, v.source_ip_masked,
        substr(v.source_ip_hash, 1, 12) source_ip_key, v.source_ip_version,
        b.id source_block_id, b.reason source_block_reason, b.expires_at source_block_expires_at, v.created_at
        FROM server_votes v LEFT JOIN directory_servers d ON d.id = v.server_id
        LEFT JOIN vote_source_blocks b ON b.id = (SELECT source_block.id FROM vote_source_blocks source_block
          WHERE source_block.source_ip_hash = v.source_ip_hash AND source_block.status = 'active'
          ORDER BY source_block.created_at DESC LIMIT 1)
        WHERE ${whereSql} ORDER BY v.created_at DESC LIMIT ? OFFSET ?`)
        .bind(...bindings, limit, offset).all<VoteLogRow>(),
      environment.DB.prepare(`SELECT COUNT(*) count FROM server_votes v LEFT JOIN directory_servers d ON d.id = v.server_id
        WHERE ${whereSql}`).bind(...bindings).first<{ count: number }>(),
      environment.DB.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN v.vote_day = ? THEN 1 ELSE 0 END) today,
        COUNT(DISTINCT COALESCE(v.minecraft_uuid, lower(v.nickname))) unique_players,
        COUNT(DISTINCT NULLIF(v.source_ip_hash, '')) unique_sources
        FROM server_votes v LEFT JOIN directory_servers d ON d.id = v.server_id WHERE ${whereSql}`)
        .bind(new Date((now + 9 * 3600) * 1000).toISOString().slice(0, 10), ...bindings)
        .first<{ total: number; today: number; unique_players: number; unique_sources: number }>(),
    ]);

    const total = Number(count?.count ?? 0);
    return Response.json({
      logs: rows.results.map((row) => ({
        id: row.id,
        serverId: row.server_id,
        serverTitle: row.server_title ?? "삭제된 서버",
        serverAddress: row.server_address ?? "-",
        ownerEmail: row.owner_email ?? "-",
        nickname: row.nickname,
        minecraftUuid: row.minecraft_uuid,
        voteDay: row.vote_day,
        rewardStatus: row.reward_status,
        ipMasked: row.source_ip_masked || "기록 없음",
        ipKey: row.source_ip_key || "",
        ipVersion: Number(row.source_ip_version || 0),
        ipMetadataExpiresAt: row.source_ip_key ? row.created_at + 90 * 86_400 : null,
        ipBlock: row.source_block_id ? {
          id: row.source_block_id,
          reason: row.source_block_reason ?? "추천 기능 이용 제한",
          expiresAt: row.source_block_expires_at,
        } : null,
        createdAt: row.created_at,
      })),
      summary: {
        total: Number(summary?.total ?? 0),
        today: Number(summary?.today ?? 0),
        uniquePlayers: Number(summary?.unique_players ?? 0),
        uniqueSources: Number(summary?.unique_sources ?? 0),
      },
      pagination: { page, pageSize: limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      privacy: { rawIpStored: false, ipMetadataRetentionDays: 90 },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

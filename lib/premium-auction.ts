import { ensureAdminSchema, prepareAuditWrite, synchronizeServerEnforcements, writeAudit } from "@/lib/admin-security";
import { ensureUserAuthSchema } from "@/lib/user-auth";

export type AuctionStatus = "scheduled" | "open" | "closing" | "closed" | "cancelled";

export type PremiumAuctionRow = {
  id: string;
  target_starts_at: number;
  target_ends_at: number;
  bidding_opens_at: number;
  bidding_closes_at: number;
  blind_starts_at: number | null;
  latest_closes_at: number | null;
  slot_count: number;
  minimum_bid: number;
  minimum_increment: number;
  status: AuctionStatus;
  created_by: string;
  created_at: number;
  updated_at: number;
  finalized_at: number | null;
};

type BidRow = {
  id: string; auction_id: string; server_id: string; owner_email: string; amount: number; status: string;
  verified_at: number; placed_at: number; updated_at: number; title?: string;
};

type AwardRow = {
  id: string; auction_id: string; bid_id: string; server_id: string; owner_email: string; amount: number;
  status: string; payment_confirmed_at: number | null; payment_reference: string | null; confirmed_by: string | null; created_at: number; updated_at: number;
  title?: string;
};

type PlacementRow = {
  id: string; origin_key: string; auction_id: string | null; award_id: string | null; server_id: string;
  server_title: string; owner_email: string; source: string; amount: number; status: string;
  starts_at: number; ends_at: number; note: string; created_by: string; created_at: number; updated_at: number;
};

const KST_OFFSET_SECONDS = 9 * 60 * 60;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_SLOTS = 4;
const DEFAULT_MINIMUM_BID = 10_000;
const DEFAULT_INCREMENT = 1_000;
const BLIND_WINDOW_SECONDS = 5 * 60;
const MINIMUM_BLIND_DURATION_SECONDS = 30;

export async function ensurePremiumAuctionSchema(db: D1Database) {
  if (process.env.NODE_ENV === "production") return;
  await ensureAdminSchema(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS premium_auctions (
      id TEXT PRIMARY KEY NOT NULL,
      target_starts_at INTEGER NOT NULL,
      target_ends_at INTEGER NOT NULL,
      bidding_opens_at INTEGER NOT NULL,
      bidding_closes_at INTEGER NOT NULL,
      blind_starts_at INTEGER,
      latest_closes_at INTEGER,
      slot_count INTEGER NOT NULL DEFAULT 4,
      minimum_bid INTEGER NOT NULL DEFAULT 10000,
      minimum_increment INTEGER NOT NULL DEFAULT 1000,
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      finalized_at INTEGER
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS premium_auctions_target_idx ON premium_auctions (target_starts_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS premium_auctions_status_idx ON premium_auctions (status)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS premium_bids (
      id TEXT PRIMARY KEY NOT NULL,
      auction_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      verified_at INTEGER NOT NULL,
      placed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS premium_bids_ranking_idx ON premium_bids (auction_id, status, amount DESC, updated_at ASC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS premium_bids_server_idx ON premium_bids (server_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS premium_bids_auction_server_idx ON premium_bids (auction_id, server_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS premium_bids_auction_owner_idx ON premium_bids (auction_id, owner_email)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS premium_awards (
      id TEXT PRIMARY KEY NOT NULL,
      auction_id TEXT NOT NULL,
      bid_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'payment_pending',
      payment_confirmed_at INTEGER,
      payment_reference TEXT,
      confirmed_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS premium_awards_auction_idx ON premium_awards (auction_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS premium_awards_server_idx ON premium_awards (server_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS premium_awards_bid_idx ON premium_awards (bid_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS premium_placements (
      id TEXT PRIMARY KEY NOT NULL,
      origin_key TEXT NOT NULL,
      auction_id TEXT,
      award_id TEXT,
      server_id TEXT NOT NULL,
      server_title TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      source TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'scheduled',
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS premium_placements_origin_idx ON premium_placements (origin_key)"),
    db.prepare("CREATE INDEX IF NOT EXISTS premium_placements_period_idx ON premium_placements (status, starts_at, ends_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS premium_placements_server_idx ON premium_placements (server_id, starts_at)"),
  ]);
  await ensureUserAuthSchema(db);
  const awardColumns = await db.prepare("PRAGMA table_info(premium_awards)").all<{ name: string }>();
  if (!awardColumns.results.some((column) => column.name === "payment_reference")) {
    await db.prepare("ALTER TABLE premium_awards ADD COLUMN payment_reference TEXT").run();
  }
  const auctionColumns = await db.prepare("PRAGMA table_info(premium_auctions)").all<{ name: string }>();
  const auctionColumnNames = new Set(auctionColumns.results.map((column) => column.name));
  if (!auctionColumnNames.has("blind_starts_at")) {
    await db.prepare("ALTER TABLE premium_auctions ADD COLUMN blind_starts_at INTEGER").run();
  }
  if (!auctionColumnNames.has("latest_closes_at")) {
    await db.prepare("ALTER TABLE premium_auctions ADD COLUMN latest_closes_at INTEGER").run();
  }
  const incompleteWindows = await db.prepare(`SELECT id, bidding_closes_at, blind_starts_at, latest_closes_at, status
    FROM premium_auctions WHERE blind_starts_at IS NULL OR latest_closes_at IS NULL`)
    .all<Pick<PremiumAuctionRow, "id" | "bidding_closes_at" | "blind_starts_at" | "latest_closes_at" | "status">>();
  const now = unixNow();
  for (const row of incompleteWindows.results) {
    const latestClosesAt = row.latest_closes_at ?? row.bidding_closes_at;
    const blindStartsAt = row.blind_starts_at ?? latestClosesAt - BLIND_WINDOW_SECONDS;
    const hiddenClose = new Set<AuctionStatus>(["scheduled", "open"]).has(row.status) && row.bidding_closes_at > now
      ? randomBlindClose(blindStartsAt, latestClosesAt)
      : row.bidding_closes_at;
    await db.prepare(`UPDATE premium_auctions SET blind_starts_at = ?, latest_closes_at = ?, bidding_closes_at = ?
      WHERE id = ?`).bind(blindStartsAt, latestClosesAt, hiddenClose, row.id).run();
  }
  await db.prepare(`INSERT OR IGNORE INTO premium_placements
    (id, origin_key, auction_id, award_id, server_id, server_title, owner_email, source, amount, status,
      starts_at, ends_at, note, created_by, created_at, updated_at)
    SELECT lower(hex(randomblob(16))), 'award:' || a.id, a.auction_id, a.id, a.server_id, d.title, a.owner_email,
      'auction', a.amount, a.status, auction.target_starts_at, auction.target_ends_at,
      '주간 경매 낙찰', COALESCE(a.confirmed_by, 'system@minecraft.kr'), COALESCE(a.payment_confirmed_at, a.created_at), a.updated_at
    FROM premium_awards a JOIN premium_auctions auction ON auction.id = a.auction_id
    JOIN directory_servers d ON d.id = a.server_id
    WHERE a.payment_confirmed_at IS NOT NULL`).run();
  const legacyEndsAt = mondayStartKst(now) + WEEK_SECONDS;
  await db.prepare(`INSERT OR IGNORE INTO premium_placements
    (id, origin_key, auction_id, award_id, server_id, server_title, owner_email, source, amount, status,
      starts_at, ends_at, note, created_by, created_at, updated_at)
    SELECT lower(hex(randomblob(16))), 'legacy:' || d.id || ':' || COALESCE(d.premium_starts_at, d.updated_at) || ':' || COALESCE(d.premium_ends_at, ?),
      NULL, NULL, d.id, d.title, d.owner_email, 'legacy_manual', 0,
      CASE WHEN COALESCE(d.premium_ends_at, ?) <= ? THEN 'expired' WHEN COALESCE(d.premium_starts_at, d.updated_at) <= ? THEN 'active' ELSE 'scheduled' END,
      COALESCE(d.premium_starts_at, d.updated_at), COALESCE(d.premium_ends_at, ?), COALESCE(d.premium_note, ''), 'legacy@minecraft.kr', d.updated_at, d.updated_at
    FROM directory_servers d
    WHERE d.premium_managed = 1 AND d.premium_tier = 'premium'
      AND d.deleted_at IS NULL AND d.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM premium_placements p WHERE p.server_id = d.id
        AND p.starts_at = COALESCE(d.premium_starts_at, d.updated_at) AND p.ends_at = COALESCE(d.premium_ends_at, ?))`)
    .bind(legacyEndsAt, legacyEndsAt, now, now, legacyEndsAt, legacyEndsAt).run();
}

export async function hasActiveFinancialLock(db: D1Database, serverId: string) {
  return Boolean(await db.prepare(`SELECT 1 locked FROM premium_bids
      WHERE server_id = ? AND status IN ('active', 'winner_pending')
    UNION ALL SELECT 1 FROM premium_awards
      WHERE server_id = ? AND status IN ('payment_pending', 'scheduled', 'active')
    UNION ALL SELECT 1 FROM premium_placements
      WHERE server_id = ? AND status IN ('scheduled', 'active')
    LIMIT 1`).bind(serverId, serverId, serverId).first());
}

export async function synchronizePremiumAuctions(db: D1Database) {
  await ensurePremiumAuctionSchema(db);
  const now = unixNow();
  await db.prepare(`UPDATE premium_auctions SET status = 'open', updated_at = ?
    WHERE status = 'scheduled' AND bidding_opens_at <= ? AND bidding_closes_at > ?`).bind(now, now, now).run();
  const expired = await db.prepare(`SELECT id FROM premium_auctions
    WHERE status IN ('scheduled', 'open', 'closing') AND bidding_closes_at <= ? ORDER BY bidding_closes_at ASC`).bind(now).all<{ id: string }>();
  for (const auction of expired.results) await finalizePremiumAuction(db, auction.id, "system@minecraft.kr", false);
  await db.batch([
    db.prepare(`UPDATE premium_awards SET status = 'active', updated_at = ? WHERE status = 'scheduled'
      AND auction_id IN (SELECT id FROM premium_auctions WHERE target_starts_at <= ? AND target_ends_at > ?)`)
      .bind(now, now, now),
    db.prepare(`UPDATE premium_awards SET status = 'expired', updated_at = ? WHERE status IN ('scheduled', 'active')
      AND auction_id IN (SELECT id FROM premium_auctions WHERE target_ends_at <= ?)`)
      .bind(now, now),
  ]);
  await synchronizePremiumPlacements(db, now);
}

export async function ensureCurrentWeeklyAuction(db: D1Database) {
  await ensurePremiumAuctionSchema(db);
  const now = unixNow();
  const currentMonday = mondayStartKst(now);
  const targetStartsAt = currentMonday + WEEK_SECONDS;
  const targetEndsAt = targetStartsAt + WEEK_SECONDS;
  const biddingOpensAt = currentMonday;
  const latestClosesAt = targetStartsAt - 4 * 60 * 60;
  const blindStartsAt = latestClosesAt - BLIND_WINDOW_SECONDS;
  const biddingClosesAt = randomBlindClose(blindStartsAt, latestClosesAt);
  const existing = await db.prepare("SELECT * FROM premium_auctions WHERE target_starts_at = ?")
    .bind(targetStartsAt).first<PremiumAuctionRow>();
  if (existing) {
    await synchronizePremiumAuctions(db);
    return await auctionById(db, existing.id) as PremiumAuctionRow;
  }
  const id = crypto.randomUUID().replaceAll("-", "");
  const status: AuctionStatus = now >= biddingOpensAt && now < biddingClosesAt ? "open" : "scheduled";
  await db.prepare(`INSERT INTO premium_auctions
    (id, target_starts_at, target_ends_at, bidding_opens_at, bidding_closes_at, blind_starts_at, latest_closes_at, slot_count,
      minimum_bid, minimum_increment, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system@minecraft.kr', ?, ?)`)
    .bind(id, targetStartsAt, targetEndsAt, biddingOpensAt, biddingClosesAt, blindStartsAt, latestClosesAt, DEFAULT_SLOTS,
      DEFAULT_MINIMUM_BID, DEFAULT_INCREMENT, status, now, now).run();
  await writeAudit(db, "system@minecraft.kr", "premium.auction.created", "premium_auction", id, {
    targetStartsAt, targetEndsAt, biddingOpensAt, blindStartsAt, latestClosesAt, slotCount: DEFAULT_SLOTS,
  });
  await synchronizePremiumAuctions(db);
  return await auctionById(db, id) as PremiumAuctionRow;
}

export async function ownerAuctionDashboard(db: D1Database, ownerEmail: string, serverId: string) {
  const auction = await ensureCurrentWeeklyAuction(db);
  await synchronizeServerEnforcements(db);
  const identity = await db.prepare("SELECT identity_verification_status FROM user_accounts WHERE email = ?")
    .bind(ownerEmail).first<{ identity_verification_status: string }>();
  const server = await db.prepare(`SELECT d.id, d.title, d.address, d.status, d.owner_email, d.deleted_at,
    d.owner_verification_status,
    b.verified_at, b.last_seen_at FROM directory_servers d
    LEFT JOIN bridge_servers b ON b.server_id = d.bridge_server_id
    WHERE d.id = ? AND d.owner_email = ? AND d.deleted_at IS NULL`)
    .bind(serverId, ownerEmail).first<{ id: string; title: string; address: string; status: string; owner_email: string; deleted_at: number | null; owner_verification_status: string; verified_at: number | null; last_seen_at: number | null }>();
  if (!server) throw Response.json({ error: "서버를 찾을 수 없거나 권한이 없습니다." }, { status: 404 });
  const [ownBid, leaderboard, awards, ownerOtherBid] = await Promise.all([
    db.prepare("SELECT * FROM premium_bids WHERE auction_id = ? AND server_id = ?").bind(auction.id, serverId).first<BidRow>(),
    db.prepare(`SELECT b.id, b.server_id, b.amount, b.status, b.updated_at, d.title
      FROM premium_bids b JOIN directory_servers d ON d.id = b.server_id
      WHERE b.auction_id = ? AND b.status IN ('active', 'winner_pending', 'winner', 'loser')
      ORDER BY b.amount DESC, b.updated_at ASC LIMIT 20`).bind(auction.id).all<BidRow>(),
    db.prepare(`SELECT a.*, d.title FROM premium_awards a JOIN directory_servers d ON d.id = a.server_id
      WHERE a.auction_id = ? AND a.owner_email = ? ORDER BY a.amount DESC`).bind(auction.id, ownerEmail).all<AwardRow>(),
    db.prepare("SELECT server_id, amount FROM premium_bids WHERE auction_id = ? AND owner_email = ? LIMIT 1")
      .bind(auction.id, ownerEmail).first<{ server_id: string; amount: number }>(),
  ]);
  const ranked = leaderboard.results.map((bid, index) => ({
    rank: index + 1,
    serverId: bid.server_id,
    serverTitle: bid.title,
    amount: bid.amount,
    status: bid.status,
    inWinningRange: index < auction.slot_count,
    mine: bid.server_id === serverId,
    updatedAt: bid.updated_at,
  }));
  const cutoff = ranked.length >= auction.slot_count ? ranked[auction.slot_count - 1].amount : auction.minimum_bid;
  const suggestedBid = ownBid
    ? ownBid.amount + auction.minimum_increment
    : ranked.length >= auction.slot_count
      ? cutoff + auction.minimum_increment
      : auction.minimum_bid;
  const identityVerified = identity?.identity_verification_status === "verified";
  const serverVerified = Boolean(server.status === "active" && server.verified_at && server.owner_verification_status === "verified");
  return {
    auction: serializeAuction(auction),
    server: {
      id: server.id, title: server.title, address: server.address, status: server.status,
      ownershipVerified: Boolean(server.status === "active" && server.verified_at && server.owner_verification_status === "verified"),
      identityVerified,
      verifiedAt: server.verified_at, lastSeenAt: server.last_seen_at,
    },
    eligible: serverVerified && identityVerified,
    eligibilityReason: serverVerified && identityVerified
      ? null
      : !identityVerified
        ? "이메일 로그인 후 운영자 본인인증을 완료한 계정만 입찰할 수 있습니다."
      : server.status === "suspended"
        ? "운영 정책 임시 차단 기간에는 프리미엄 경매에 참여할 수 없습니다."
      : server.status === "blinded"
        ? "공개 목록 블라인드 기간에는 프리미엄 경매에 참여할 수 없습니다."
      : server.owner_verification_status === "disputed" || server.owner_verification_status === "transfer_pending"
        ? "소유권 이전·분쟁 중에는 경매에 참여할 수 없습니다."
        : "MOTD·브리지 소유권 인증을 완료한 운영 중 서버만 입찰할 수 있습니다.",
    ownBid: ownBid ? serializeBid(ownBid) : null,
    ownerHasOtherBid: Boolean(ownerOtherBid && ownerOtherBid.server_id !== serverId),
    cutoffAmount: cutoff,
    suggestedBid,
    leaderboard: ranked,
    awards: awards.results.map(serializeAward),
  };
}

export async function placePremiumBid(db: D1Database, request: Request, ownerEmail: string, payload: unknown) {
  assertAuctionOrigin(request);
  if (!payload || typeof payload !== "object") throw Response.json({ error: "입찰 정보를 확인해 주세요." }, { status: 400 });
  const body = payload as Record<string, unknown>;
  const auctionId = typeof body.auctionId === "string" ? body.auctionId : "";
  const serverId = typeof body.serverId === "string" ? body.serverId : "";
  const amount = Number(body.amount);
  const acceptedTerms = body.acceptedTerms === true;
  if (!/^[a-f0-9]{32}$/.test(auctionId) || !/^[a-f0-9]{32}$/.test(serverId)) throw Response.json({ error: "경매 또는 서버 ID가 올바르지 않습니다." }, { status: 400 });
  if (!acceptedTerms) throw Response.json({ error: "입찰의 결제 의무와 취소 불가 조건에 동의해 주세요." }, { status: 400 });
  if (!Number.isSafeInteger(amount)) throw Response.json({ error: "입찰 금액은 원 단위 정수여야 합니다." }, { status: 400 });
  await synchronizePremiumAuctions(db);
  await synchronizeServerEnforcements(db);
  const auction = await auctionById(db, auctionId);
  const now = unixNow();
  if (!auction || auction.status !== "open" || now < auction.bidding_opens_at || now >= auction.bidding_closes_at) {
    throw Response.json({ error: "현재 입찰 가능한 경매가 아닙니다." }, { status: 409 });
  }
  if (amount < auction.minimum_bid || amount > 2_000_000_000) throw Response.json({ error: `입찰 금액은 ${auction.minimum_bid.toLocaleString("ko-KR")}원 이상이어야 합니다.` }, { status: 400 });
  const identity = await db.prepare("SELECT account_status, identity_verification_status FROM user_accounts WHERE email = ?")
    .bind(ownerEmail).first<{ account_status: string; identity_verification_status: string }>();
  if (identity?.account_status !== "active" || identity.identity_verification_status !== "verified") {
    throw Response.json({ error: "운영자 본인인증을 완료한 계정만 프리미엄 경매에 참여할 수 있습니다." }, { status: 403 });
  }
  const server = await db.prepare(`SELECT d.id, d.title, d.status, d.owner_email, d.owner_verification_status, b.verified_at
    FROM directory_servers d LEFT JOIN bridge_servers b ON b.server_id = d.bridge_server_id
    WHERE d.id = ? AND d.owner_email = ? AND d.deleted_at IS NULL`)
    .bind(serverId, ownerEmail).first<{ id: string; title: string; status: string; owner_email: string; owner_verification_status: string; verified_at: number | null }>();
  if (!server) throw Response.json({ error: "서버를 찾을 수 없거나 권한이 없습니다." }, { status: 404 });
  if (server.owner_verification_status === "disputed" || server.owner_verification_status === "transfer_pending") throw Response.json({ error: "소유권 이전·분쟁 중에는 경매에 참여할 수 없습니다." }, { status: 423 });
  if (server.status !== "active" || !server.verified_at) throw Response.json({ error: "소유권 인증이 완료된 운영 중 서버만 입찰할 수 있습니다." }, { status: 403 });
  const ownerBid = await db.prepare("SELECT id, server_id, amount FROM premium_bids WHERE auction_id = ? AND owner_email = ?")
    .bind(auctionId, ownerEmail).first<{ id: string; server_id: string; amount: number }>();
  if (ownerBid && ownerBid.server_id !== serverId) throw Response.json({ error: "한 운영자는 한 주에 한 서버로만 입찰할 수 있습니다." }, { status: 409 });
  if (ownerBid && amount < ownerBid.amount + auction.minimum_increment) {
    throw Response.json({ error: `기존 입찰가보다 최소 ${auction.minimum_increment.toLocaleString("ko-KR")}원 높게 입찰해 주세요.` }, { status: 400 });
  }
  const id = ownerBid?.id ?? crypto.randomUUID().replaceAll("-", "");
  if (ownerBid) {
    const results = await db.batch([
      db.prepare(`UPDATE premium_bids SET amount = ?, status = 'active',
        verified_at = (
          SELECT bridge.verified_at FROM directory_servers server
          JOIN bridge_servers bridge ON bridge.server_id = server.bridge_server_id
          WHERE server.id = premium_bids.server_id LIMIT 1
        ), updated_at = ?
        WHERE id = ? AND auction_id = ? AND server_id = ? AND owner_email = ?
          AND status = 'active' AND amount = ?
          AND EXISTS (
            SELECT 1 FROM premium_auctions auction
            JOIN directory_servers server ON server.id = premium_bids.server_id
            JOIN bridge_servers bridge ON bridge.server_id = server.bridge_server_id
            JOIN user_accounts account ON account.email = premium_bids.owner_email
            WHERE auction.id = premium_bids.auction_id
              AND auction.status = 'open'
              AND auction.bidding_opens_at <= ? AND auction.bidding_closes_at > ?
              AND ? >= auction.minimum_bid
              AND ? >= premium_bids.amount + auction.minimum_increment
              AND server.owner_email = premium_bids.owner_email
              AND server.deleted_at IS NULL AND server.status = 'active'
              AND server.owner_verification_status = 'verified'
              AND bridge.verified_at IS NOT NULL
              AND account.account_status = 'active'
              AND account.identity_verification_status = 'verified'
          )`)
        .bind(amount, now, id, auctionId, serverId, ownerEmail, ownerBid.amount, now, now, amount, amount),
      prepareAuditWrite(db, ownerEmail, "premium.bid.raised", "premium_bid", id, {
        auctionId,
        serverId,
        serverTitle: server.title,
        previousAmount: ownerBid.amount,
        amount,
      }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      await throwPremiumBidMutationRejected(db, auctionId, serverId, ownerEmail, now);
    }
  } else {
    try {
      const results = await db.batch([
        db.prepare(`INSERT INTO premium_bids
          (id, auction_id, server_id, owner_email, amount, status, verified_at, placed_at, updated_at)
          SELECT ?, auction.id, server.id, ?, ?, 'active', bridge.verified_at, ?, ?
          FROM premium_auctions auction
          JOIN directory_servers server ON server.id = ?
          JOIN bridge_servers bridge ON bridge.server_id = server.bridge_server_id
          JOIN user_accounts account ON account.email = ?
          WHERE auction.id = ? AND auction.status = 'open'
            AND auction.bidding_opens_at <= ? AND auction.bidding_closes_at > ?
            AND ? >= auction.minimum_bid
            AND server.owner_email = ? AND server.deleted_at IS NULL AND server.status = 'active'
            AND server.owner_verification_status = 'verified'
            AND bridge.verified_at IS NOT NULL
            AND account.account_status = 'active'
            AND account.identity_verification_status = 'verified'
            AND NOT EXISTS (
              SELECT 1 FROM premium_bids existing
              WHERE existing.auction_id = auction.id
                AND (existing.server_id = server.id OR existing.owner_email = ?)
            )`)
          .bind(id, ownerEmail, amount, now, now, serverId, ownerEmail, auctionId,
            now, now, amount, ownerEmail, ownerEmail),
        prepareAuditWrite(db, ownerEmail, "premium.bid.placed", "premium_bid", id, {
          auctionId,
          serverId,
          serverTitle: server.title,
          previousAmount: null,
          amount,
        }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
      ]);
      if ((results[0]?.meta.changes ?? 0) !== 1) {
        await throwPremiumBidMutationRejected(db, auctionId, serverId, ownerEmail, now);
      }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw Response.json({ error: "같은 주간 경매에 이미 입찰이 등록되었습니다. 새로고침 후 인상해 주세요." }, { status: 409 });
      }
      throw error;
    }
  }
  return await ownerAuctionDashboard(db, ownerEmail, serverId);
}

async function throwPremiumBidMutationRejected(
  db: D1Database,
  auctionId: string,
  serverId: string,
  ownerEmail: string,
  attemptedAt: number,
): Promise<never> {
  const [auction, account, server, conflictingBid] = await Promise.all([
    db.prepare(`SELECT status, bidding_opens_at, bidding_closes_at FROM premium_auctions
      WHERE id = ?`).bind(auctionId)
      .first<{ status: string; bidding_opens_at: number; bidding_closes_at: number }>(),
    db.prepare(`SELECT account_status, identity_verification_status FROM user_accounts
      WHERE email = ?`).bind(ownerEmail)
      .first<{ account_status: string; identity_verification_status: string }>(),
    db.prepare(`SELECT d.id FROM directory_servers d
      JOIN bridge_servers bridge ON bridge.server_id = d.bridge_server_id
      WHERE d.id = ? AND d.owner_email = ? AND d.deleted_at IS NULL AND d.status = 'active'
        AND d.owner_verification_status = 'verified' AND bridge.verified_at IS NOT NULL`)
      .bind(serverId, ownerEmail).first<{ id: string }>(),
    db.prepare(`SELECT id, server_id FROM premium_bids
      WHERE auction_id = ? AND (owner_email = ? OR server_id = ?) LIMIT 1`)
      .bind(auctionId, ownerEmail, serverId).first<{ id: string; server_id: string }>(),
  ]);
  if (!auction || auction.status !== "open"
    || auction.bidding_opens_at > attemptedAt || auction.bidding_closes_at <= attemptedAt) {
    throw Response.json({ error: "입찰 처리 중 경매가 마감되거나 상태가 변경되었습니다." }, { status: 409 });
  }
  if (!account || account.account_status !== "active" || account.identity_verification_status !== "verified") {
    throw Response.json({ error: "운영자 계정 또는 본인인증 상태가 변경되어 입찰할 수 없습니다." }, { status: 403 });
  }
  if (!server) {
    throw Response.json({ error: "서버의 운영·소유권·브리지 인증 상태가 변경되어 입찰할 수 없습니다." }, { status: 403 });
  }
  if (conflictingBid) {
    throw Response.json({ error: "같은 주간 경매의 입찰이 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
  }
  throw Response.json({ error: "입찰 규칙 또는 기존 입찰가가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
}

function isUniqueConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT(?:_UNIQUE)?/i.test(message);
}

async function synchronizePremiumPlacements(db: D1Database, now = unixNow()) {
  await db.batch([
    db.prepare(`UPDATE premium_placements SET status = 'account_suspended', updated_at = ?
      WHERE status IN ('scheduled', 'active')
        AND NOT EXISTS (
          SELECT 1 FROM user_accounts account
          WHERE account.email = premium_placements.owner_email
            AND account.account_status = 'active'
            AND account.identity_verification_status = 'verified'
        )`).bind(now),
    db.prepare(`UPDATE premium_placements SET status = 'cancelled_server', updated_at = ?
      WHERE status IN ('scheduled', 'active')
        AND NOT EXISTS (
          SELECT 1 FROM directory_servers server
          JOIN bridge_servers bridge ON bridge.server_id = server.bridge_server_id
          WHERE server.id = premium_placements.server_id
            AND server.owner_email = premium_placements.owner_email
            AND server.deleted_at IS NULL AND server.status = 'active'
            AND server.owner_verification_status = 'verified'
            AND bridge.verified_at IS NOT NULL
        )`).bind(now),
    db.prepare(`UPDATE premium_placements SET status = 'active', updated_at = ?
      WHERE status = 'scheduled' AND starts_at <= ? AND ends_at > ?
        AND EXISTS (
          SELECT 1 FROM directory_servers server
          JOIN bridge_servers bridge ON bridge.server_id = server.bridge_server_id
          JOIN user_accounts account ON account.email = premium_placements.owner_email
          WHERE server.id = premium_placements.server_id
            AND server.owner_email = premium_placements.owner_email
            AND server.deleted_at IS NULL AND server.status = 'active'
            AND server.owner_verification_status = 'verified'
            AND bridge.verified_at IS NOT NULL
            AND account.account_status = 'active'
            AND account.identity_verification_status = 'verified'
        )`).bind(now, now, now),
    db.prepare(`UPDATE premium_placements SET status = 'expired', updated_at = ?
      WHERE status IN ('scheduled', 'active') AND ends_at <= ?`).bind(now, now),
  ]);
  const controlled = await db.prepare("SELECT DISTINCT server_id FROM premium_placements").all<{ server_id: string }>();
  const candidates = await db.prepare(`SELECT * FROM premium_placements
    WHERE status IN ('active', 'scheduled') AND ends_at > ?
    ORDER BY server_id ASC, CASE WHEN status = 'active' THEN 0 ELSE 1 END, starts_at ASC, amount DESC`)
    .bind(now).all<PlacementRow>();
  const preferred = new Map<string, PlacementRow>();
  for (const placement of candidates.results) if (!preferred.has(placement.server_id)) preferred.set(placement.server_id, placement);
  const statements: D1PreparedStatement[] = [];
  for (const { server_id: serverId } of controlled.results) {
    const placement = preferred.get(serverId);
    if (placement) {
      statements.push(db.prepare(`UPDATE directory_servers SET premium_managed = 1, premium_tier = 'premium',
        premium_starts_at = ?, premium_ends_at = ?, premium_note = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL AND (premium_managed <> 1 OR premium_tier <> 'premium'
          OR premium_starts_at IS NOT ? OR premium_ends_at IS NOT ? OR premium_note <> ?)
          AND EXISTS (
            SELECT 1 FROM user_accounts account
            WHERE account.email = directory_servers.owner_email
              AND account.account_status = 'active'
              AND account.identity_verification_status = 'verified'
          )
          AND EXISTS (
            SELECT 1 FROM premium_placements current
            WHERE current.id = ? AND current.status IN ('active', 'scheduled')
          )`)
        .bind(placement.starts_at, placement.ends_at, placement.note, now, serverId,
          placement.starts_at, placement.ends_at, placement.note, placement.id));
    } else {
      statements.push(db.prepare(`UPDATE directory_servers SET premium_managed = CASE WHEN EXISTS (
          SELECT 1 FROM user_accounts account
          WHERE account.email = directory_servers.owner_email
            AND account.account_status = 'active'
            AND account.identity_verification_status = 'verified'
        ) THEN 1 ELSE 0 END, premium_tier = 'none',
        premium_starts_at = NULL, premium_ends_at = NULL, premium_note = '', updated_at = ?
        WHERE id = ? AND deleted_at IS NULL AND (premium_managed <> CASE WHEN EXISTS (
            SELECT 1 FROM user_accounts account
            WHERE account.email = directory_servers.owner_email
              AND account.account_status = 'active'
              AND account.identity_verification_status = 'verified'
          ) THEN 1 ELSE 0 END OR premium_tier <> 'none' OR premium_starts_at IS NOT NULL
          OR premium_ends_at IS NOT NULL OR premium_note <> '')`).bind(now, serverId));
    }
  }
  if (statements.length) await db.batch(statements);
}

async function currentPlacementWindow(db: D1Database, now = unixNow()) {
  const auction = await db.prepare(`SELECT id, target_starts_at, target_ends_at, slot_count FROM premium_auctions
    WHERE target_starts_at <= ? AND target_ends_at > ? ORDER BY target_starts_at DESC LIMIT 1`)
    .bind(now, now).first<{ id: string; target_starts_at: number; target_ends_at: number; slot_count: number }>();
  const startsAt = auction?.target_starts_at ?? mondayStartKst(now);
  return {
    auctionId: auction?.id ?? null,
    startsAt,
    endsAt: auction?.target_ends_at ?? startsAt + WEEK_SECONDS,
    capacity: auction?.slot_count ?? DEFAULT_SLOTS,
  };
}

export async function fillCurrentPremiumVacancy(db: D1Database, serverId: string, adminEmail: string, noteValue: unknown) {
  await ensurePremiumAuctionSchema(db);
  await synchronizePremiumPlacements(db);
  if (!/^[a-f0-9]{32}$/.test(serverId)) throw Response.json({ error: "서버를 선택해 주세요." }, { status: 400 });
  const server = await db.prepare(`SELECT id, title, owner_email, status, owner_verification_status FROM directory_servers
    WHERE id = ? AND deleted_at IS NULL`).bind(serverId).first<{ id: string; title: string; owner_email: string; status: string; owner_verification_status: string }>();
  if (!server) throw Response.json({ error: "서버를 찾을 수 없습니다." }, { status: 404 });
  if (server.status !== "active" || server.owner_verification_status !== "verified") {
    throw Response.json({ error: "소유권 인증이 완료된 운영 중 서버만 광고에 배치할 수 있습니다." }, { status: 409 });
  }
  const now = unixNow();
  const window = await currentPlacementWindow(db, now);
  const note = typeof noteValue === "string" ? noteValue.trim().slice(0, 200) : "";
  const id = crypto.randomUUID().replaceAll("-", "");
  const details = { serverId: server.id, serverTitle: server.title, startsAt: now, endsAt: window.endsAt };
  const results = await db.batch([
    db.prepare(`INSERT INTO premium_placements
      (id, origin_key, auction_id, award_id, server_id, server_title, owner_email, source, amount, status,
        starts_at, ends_at, note, created_by, created_at, updated_at)
      SELECT ?, ?, ?, NULL, server.id, server.title, server.owner_email, 'manual_fill', 0, 'active',
        ?, ?, ?, ?, ?, ?
      FROM directory_servers server
      JOIN bridge_servers bridge ON bridge.server_id = server.bridge_server_id
      JOIN user_accounts account ON account.email = server.owner_email
      WHERE server.id = ? AND server.deleted_at IS NULL AND server.status = 'active'
        AND server.owner_verification_status = 'verified' AND bridge.verified_at IS NOT NULL
        AND account.account_status = 'active' AND account.identity_verification_status = 'verified'
        AND (SELECT COUNT(DISTINCT server_id) FROM premium_placements
        WHERE status = 'active' AND starts_at <= ? AND ends_at > ?) < ?
        AND NOT EXISTS (SELECT 1 FROM premium_placements WHERE server_id = server.id
          AND status IN ('active', 'scheduled') AND starts_at < ? AND ends_at > ?)`)
      .bind(id, `manual:${id}`, window.auctionId,
        now, window.endsAt, note || "총관리자 빈 슬롯 수동 배치", adminEmail, now, now,
        serverId, now, now, window.capacity, window.endsAt, now),
    prepareAuditWrite(db, adminEmail, "premium.placement.manual_filled", "premium_placement", id, details, {
      createdAt: now,
      onlyIfPreviousStatementChanged: true,
    }),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1) {
    throw Response.json({ error: "서버·운영자 자격이 변경되었거나 광고 슬롯이 이미 찼습니다. 새로고침 후 다시 확인해 주세요." }, { status: 409 });
  }
  await synchronizePremiumPlacements(db, now);
  return id;
}

export async function cancelManualPremiumPlacement(db: D1Database, placementId: string, adminEmail: string) {
  await ensurePremiumAuctionSchema(db);
  const placement = await db.prepare("SELECT * FROM premium_placements WHERE id = ?").bind(placementId).first<PlacementRow>();
  if (!placement) throw Response.json({ error: "광고 배치 기록을 찾을 수 없습니다." }, { status: 404 });
  if (!new Set(["manual_fill", "legacy_manual"]).has(placement.source) || !new Set(["active", "scheduled"]).has(placement.status)) {
    throw Response.json({ error: "현재 노출 중인 수동 배치만 해제할 수 있습니다." }, { status: 409 });
  }
  const now = unixNow();
  const results = await db.batch([
    db.prepare(`UPDATE premium_placements SET status = 'cancelled', updated_at = ?
      WHERE id = ? AND source IN ('manual_fill', 'legacy_manual') AND status IN ('active', 'scheduled')`)
      .bind(now, placementId),
    prepareAuditWrite(db, adminEmail, "premium.placement.manual_cancelled", "premium_placement", placementId, {
      serverId: placement.server_id,
      serverTitle: placement.server_title,
    }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1) {
    throw Response.json({ error: "다른 요청에서 이미 광고 배치 상태가 변경되었습니다." }, { status: 409 });
  }
  await synchronizePremiumPlacements(db, now);
}

export async function adminAuctionDashboard(db: D1Database) {
  const current = await ensureCurrentWeeklyAuction(db);
  const auctions = await db.prepare("SELECT * FROM premium_auctions ORDER BY target_starts_at DESC LIMIT 52").all<PremiumAuctionRow>();
  const bids = await db.prepare(`SELECT b.*, d.title FROM premium_bids b JOIN directory_servers d ON d.id = b.server_id
    WHERE b.auction_id = ? ORDER BY b.amount DESC, b.updated_at ASC`).bind(current.id).all<BidRow>();
  const awards = await db.prepare(`SELECT a.*, d.title FROM premium_awards a JOIN directory_servers d ON d.id = a.server_id
    WHERE a.auction_id = ? ORDER BY a.amount DESC`).bind(current.id).all<AwardRow>();
  const placements = await db.prepare("SELECT * FROM premium_placements ORDER BY starts_at DESC, created_at DESC LIMIT 300").all<PlacementRow>();
  const now = unixNow();
  const placementWindow = await currentPlacementWindow(db, now);
  const currentPlacements = await db.prepare(`SELECT p.* FROM premium_placements p
    JOIN directory_servers d ON d.id = p.server_id
    WHERE p.status = 'active' AND p.starts_at <= ? AND p.ends_at > ?
      AND d.deleted_at IS NULL AND d.status = 'active'
    ORDER BY CASE WHEN p.source = 'auction' THEN 0 ELSE 1 END, p.amount DESC, p.created_at ASC`)
    .bind(now, now).all<PlacementRow>();
  return {
    current: serializeAuction(current),
    auctions: auctions.results.map(serializeAuction),
    bids: bids.results.map((bid, index) => ({ ...serializeBid(bid), rank: index + 1, serverTitle: bid.title, ownerEmail: bid.owner_email, inWinningRange: index < current.slot_count })),
    awards: awards.results.map((award) => ({ ...serializeAward(award), serverTitle: award.title, ownerEmail: award.owner_email })),
    placements: placements.results.map(serializePlacement),
    currentSlots: {
      capacity: placementWindow.capacity,
      occupied: currentPlacements.results.length,
      vacancies: Math.max(0, placementWindow.capacity - currentPlacements.results.length),
      endsAt: placementWindow.endsAt,
      placements: currentPlacements.results.map(serializePlacement),
    },
  };
}

export async function updatePremiumAuctionRules(db: D1Database, auctionId: string, adminEmail: string, payload: Record<string, unknown>) {
  const auction = await auctionById(db, auctionId);
  if (!auction) throw Response.json({ error: "경매를 찾을 수 없습니다." }, { status: 404 });
  const bidCount = await db.prepare("SELECT COUNT(*) count FROM premium_bids WHERE auction_id = ?").bind(auctionId).first<{ count: number }>();
  if ((bidCount?.count ?? 0) > 0) throw Response.json({ error: "입찰이 시작된 경매의 규칙은 변경할 수 없습니다." }, { status: 409 });
  if (!new Set(["scheduled", "open"]).has(auction.status)) throw Response.json({ error: "진행 전 경매만 수정할 수 있습니다." }, { status: 409 });
  const slotCount = boundedInteger(payload.slotCount, 1, 20, "광고 슬롯 수");
  const minimumBid = boundedInteger(payload.minimumBid, 1_000, 2_000_000_000, "최소 입찰가");
  const minimumIncrement = boundedInteger(payload.minimumIncrement, 1_000, 100_000_000, "최소 인상액");
  const now = unixNow();
  const results = await db.batch([
    db.prepare(`UPDATE premium_auctions SET slot_count = ?, minimum_bid = ?, minimum_increment = ?, updated_at = ?
      WHERE id = ? AND status IN ('scheduled', 'open')
        AND NOT EXISTS (SELECT 1 FROM premium_bids WHERE auction_id = ?)`)
      .bind(slotCount, minimumBid, minimumIncrement, now, auctionId, auctionId),
    prepareAuditWrite(db, adminEmail, "premium.auction.rules.updated", "premium_auction", auctionId, {
      slotCount,
      minimumBid,
      minimumIncrement,
    }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1) {
    throw Response.json({ error: "입찰 또는 경매 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
  }
}

export async function finalizePremiumAuction(db: D1Database, auctionId: string, actorEmail: string, force: boolean) {
  await ensurePremiumAuctionSchema(db);
  const auction = await auctionById(db, auctionId);
  if (!auction) throw Response.json({ error: "경매를 찾을 수 없습니다." }, { status: 404 });
  const now = unixNow();
  if (!force && auction.bidding_closes_at > now) return false;
  if (!new Set(["scheduled", "open", "closing"]).has(auction.status)) return auction.status === "closed";
  const acquired = auction.status === "closing"
    ? await db.prepare(`UPDATE premium_auctions SET updated_at = ?
        WHERE id = ? AND status = 'closing' AND updated_at <= ?`)
      .bind(now, auctionId, now - 120).run()
    : await db.prepare(`UPDATE premium_auctions SET status = 'closing', updated_at = ?
        WHERE id = ? AND status IN ('scheduled', 'open')`)
      .bind(now, auctionId).run();
  if ((acquired.meta.changes ?? 0) < 1) return false;
  const eligible = await db.prepare(`SELECT b.* FROM premium_bids b
    JOIN directory_servers d ON d.id = b.server_id
    JOIN bridge_servers bridge ON bridge.server_id = d.bridge_server_id
    JOIN user_accounts account ON account.email = b.owner_email
    WHERE b.auction_id = ? AND b.status = 'active' AND d.status = 'active' AND d.deleted_at IS NULL
      AND d.owner_email = b.owner_email AND d.owner_verification_status = 'verified'
      AND bridge.verified_at IS NOT NULL AND account.account_status = 'active'
      AND account.identity_verification_status = 'verified'
    ORDER BY b.amount DESC, b.updated_at ASC`).bind(auctionId).all<BidRow>();
  const winners = eligible.results.slice(0, auction.slot_count);
  const statements: D1PreparedStatement[] = [];
  for (const bid of winners) {
    const awardId = crypto.randomUUID().replaceAll("-", "");
    statements.push(
      db.prepare(`UPDATE premium_bids SET status = 'winner_pending', updated_at = ?
        WHERE id = ? AND auction_id = ? AND status = 'active'
          AND EXISTS (
            SELECT 1 FROM directory_servers server
            JOIN bridge_servers bridge ON bridge.server_id = server.bridge_server_id
            JOIN user_accounts account ON account.email = premium_bids.owner_email
            WHERE server.id = premium_bids.server_id
              AND server.owner_email = premium_bids.owner_email
              AND server.deleted_at IS NULL AND server.status = 'active'
              AND server.owner_verification_status = 'verified'
              AND bridge.verified_at IS NOT NULL
              AND account.account_status = 'active'
              AND account.identity_verification_status = 'verified'
          )`).bind(now, bid.id, auctionId),
      db.prepare(`INSERT INTO premium_awards
        (id, auction_id, bid_id, server_id, owner_email, amount, status, created_at, updated_at)
        SELECT ?, auction_id, id, server_id, owner_email, amount, 'payment_pending', ?, ?
        FROM premium_bids WHERE id = ? AND auction_id = ? AND status = 'winner_pending'
          AND changes() = 1`)
        .bind(awardId, now, now, bid.id, auctionId),
    );
  }
  statements.push(
    db.prepare("UPDATE premium_bids SET status = 'loser', updated_at = ? WHERE auction_id = ? AND status = 'active'")
      .bind(now, auctionId),
    db.prepare(`UPDATE premium_auctions SET status = 'closed', finalized_at = ?, updated_at = ?
      WHERE id = ? AND status = 'closing' AND updated_at = ?`).bind(now, now, auctionId, now),
    prepareAuditWrite(db, actorEmail, force ? "premium.auction.finalized_early" : "premium.auction.finalized",
      "premium_auction", auctionId, {
        winnerCount: winners.length,
        slotCount: auction.slot_count,
        bids: eligible.results.length,
      }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
  );
  const results = await db.batch(statements);
  if ((results[results.length - 2].meta.changes ?? 0) !== 1) return false;
  return true;
}

export async function confirmPremiumAward(db: D1Database, auctionId: string, awardId: string, adminEmail: string, paymentReference: string) {
  const award = await awardById(db, auctionId, awardId);
  if (!award) throw Response.json({ error: "낙찰 정보를 찾을 수 없습니다." }, { status: 404 });
  if (award.status !== "payment_pending") throw Response.json({ error: "결제 확인 대기 중인 낙찰만 처리할 수 있습니다." }, { status: 409 });
  const auction = await auctionById(db, auctionId) as PremiumAuctionRow;
  const now = unixNow();
  if (now >= auction.target_ends_at) throw Response.json({ error: "광고 기간이 종료된 낙찰은 결제 확인할 수 없습니다." }, { status: 409 });
  const eligible = await db.prepare(`SELECT d.title FROM directory_servers d
    JOIN bridge_servers bridge ON bridge.server_id = d.bridge_server_id
    JOIN user_accounts account ON account.email = d.owner_email
    WHERE d.id = ? AND d.owner_email = ? AND d.status = 'active' AND d.deleted_at IS NULL
      AND d.owner_verification_status = 'verified' AND bridge.verified_at IS NOT NULL
      AND account.account_status = 'active' AND account.identity_verification_status = 'verified' LIMIT 1`)
    .bind(award.server_id, award.owner_email).first<{ title: string }>();
  if (!eligible) throw Response.json({ error: "낙찰 서버의 소유권·본인인증 상태가 변경되어 결제를 확정할 수 없습니다." }, { status: 409 });
  const status = now >= auction.target_starts_at && now < auction.target_ends_at ? "active" : "scheduled";
  const placementId = crypto.randomUUID().replaceAll("-", "");
  const results = await db.batch([
    db.prepare(`UPDATE premium_awards SET status = ?, payment_confirmed_at = ?, payment_reference = ?, confirmed_by = ?, updated_at = ?
      WHERE id = ? AND auction_id = ? AND status = 'payment_pending'
        AND EXISTS (
          SELECT 1 FROM directory_servers server
          JOIN bridge_servers bridge ON bridge.server_id = server.bridge_server_id
          JOIN user_accounts account ON account.email = premium_awards.owner_email
          JOIN premium_auctions auction ON auction.id = premium_awards.auction_id
          WHERE server.id = premium_awards.server_id
            AND server.owner_email = premium_awards.owner_email
            AND server.deleted_at IS NULL AND server.status = 'active'
            AND server.owner_verification_status = 'verified'
            AND bridge.verified_at IS NOT NULL
            AND account.account_status = 'active'
            AND account.identity_verification_status = 'verified'
            AND auction.target_ends_at > ?
        )`)
      .bind(status, now, paymentReference, adminEmail, now, awardId, auctionId, now),
    prepareAuditWrite(db, adminEmail, "premium.award.payment_confirmed", "premium_award", awardId, {
      auctionId,
      serverId: award.server_id,
      amount: award.amount,
      startsAt: auction.target_starts_at,
      endsAt: auction.target_ends_at,
    }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
    db.prepare(`UPDATE premium_bids SET status = 'winner', updated_at = ?
      WHERE id = ? AND status = 'winner_pending'
        AND EXISTS (SELECT 1 FROM premium_awards WHERE id = ? AND auction_id = ?
          AND status = ? AND payment_confirmed_at = ? AND confirmed_by = ?)`)
      .bind(now, award.bid_id, awardId, auctionId, status, now, adminEmail),
    db.prepare(`INSERT OR IGNORE INTO premium_placements
      (id, origin_key, auction_id, award_id, server_id, server_title, owner_email, source, amount, status,
        starts_at, ends_at, note, created_by, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, 'auction', ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM premium_awards WHERE id = ? AND auction_id = ?
        AND status = ? AND payment_confirmed_at = ? AND confirmed_by = ?)`)
      .bind(placementId, `award:${awardId}`, auctionId, awardId, award.server_id, eligible.title, award.owner_email,
        award.amount, status, auction.target_starts_at, auction.target_ends_at,
        `주간 경매 낙찰 · ${award.amount.toLocaleString("ko-KR")}원`, adminEmail, now, now,
        awardId, auctionId, status, now, adminEmail),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1) {
    throw Response.json({ error: "다른 요청에서 이미 낙찰 상태가 변경되었습니다." }, { status: 409 });
  }
  await synchronizePremiumPlacements(db, now);
}

export async function forfeitPremiumAward(db: D1Database, auctionId: string, awardId: string, adminEmail: string) {
  const award = await awardById(db, auctionId, awardId);
  if (!award) throw Response.json({ error: "낙찰 정보를 찾을 수 없습니다." }, { status: 404 });
  if (award.status !== "payment_pending") throw Response.json({ error: "결제 대기 중인 낙찰만 포기 처리할 수 있습니다." }, { status: 409 });
  const now = unixNow();
  const replacement = await db.prepare(`SELECT b.* FROM premium_bids b
    JOIN directory_servers d ON d.id = b.server_id JOIN bridge_servers bridge ON bridge.server_id = d.bridge_server_id
    JOIN user_accounts account ON account.email = b.owner_email
    WHERE b.auction_id = ? AND b.status = 'loser' AND d.status = 'active' AND d.deleted_at IS NULL
      AND d.owner_email = b.owner_email AND d.owner_verification_status = 'verified'
      AND bridge.verified_at IS NOT NULL AND account.account_status = 'active'
      AND account.identity_verification_status = 'verified'
    ORDER BY b.amount DESC, b.updated_at ASC LIMIT 1`).bind(auctionId).first<BidRow>();
  const forfeited = await db.batch([
    db.prepare(`UPDATE premium_awards SET status = 'forfeited', updated_at = ?, confirmed_by = ?
      WHERE id = ? AND auction_id = ? AND status = 'payment_pending'`)
      .bind(now, adminEmail, awardId, auctionId),
    prepareAuditWrite(db, adminEmail, "premium.award.forfeited", "premium_award", awardId, {
      auctionId,
      serverId: award.server_id,
      replacementCandidateServerId: replacement?.server_id ?? null,
    }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
    db.prepare(`UPDATE premium_bids SET status = 'forfeited', updated_at = ?
      WHERE id = ? AND status = 'winner_pending'
        AND EXISTS (SELECT 1 FROM premium_awards WHERE id = ? AND status = 'forfeited'
          AND updated_at = ? AND confirmed_by = ?)`)
      .bind(now, award.bid_id, awardId, now, adminEmail),
  ]);
  if ((forfeited[0].meta.changes ?? 0) !== 1) {
    throw Response.json({ error: "다른 요청에서 이미 낙찰 상태가 변경되었습니다." }, { status: 409 });
  }
  let replacementAwardId: string | null = null;
  if (replacement) {
    const candidateAwardId = crypto.randomUUID().replaceAll("-", "");
    try {
      const promoted = await db.batch([
        db.prepare(`UPDATE premium_bids SET status = 'winner_pending', updated_at = ?
          WHERE id = ? AND auction_id = ? AND status = 'loser'
            AND EXISTS (
              SELECT 1 FROM directory_servers server
              JOIN bridge_servers bridge ON bridge.server_id = server.bridge_server_id
              JOIN user_accounts account ON account.email = premium_bids.owner_email
              WHERE server.id = premium_bids.server_id
                AND server.owner_email = premium_bids.owner_email
                AND server.deleted_at IS NULL AND server.status = 'active'
                AND server.owner_verification_status = 'verified'
                AND bridge.verified_at IS NOT NULL
                AND account.account_status = 'active'
                AND account.identity_verification_status = 'verified'
            )`)
          .bind(now, replacement.id, auctionId),
        db.prepare(`INSERT INTO premium_awards
          (id, auction_id, bid_id, server_id, owner_email, amount, status, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, 'payment_pending', ?, ?
          WHERE changes() = 1
            AND EXISTS (
              SELECT 1 FROM premium_bids promoted
              JOIN directory_servers server ON server.id = promoted.server_id
              JOIN bridge_servers bridge ON bridge.server_id = server.bridge_server_id
              JOIN user_accounts account ON account.email = promoted.owner_email
              WHERE promoted.id = ? AND promoted.auction_id = ? AND promoted.status = 'winner_pending'
                AND server.owner_email = promoted.owner_email
                AND server.deleted_at IS NULL AND server.status = 'active'
                AND server.owner_verification_status = 'verified'
                AND bridge.verified_at IS NOT NULL
                AND account.account_status = 'active'
                AND account.identity_verification_status = 'verified'
            )`)
          .bind(candidateAwardId, auctionId, replacement.id, replacement.server_id, replacement.owner_email,
            replacement.amount, now, now, replacement.id, auctionId),
        prepareAuditWrite(db, adminEmail, "premium.award.replacement_promoted", "premium_award", candidateAwardId, {
          auctionId,
          forfeitedAwardId: awardId,
          replacementServerId: replacement.server_id,
        }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
      ]);
      if ((promoted[0].meta.changes ?? 0) === 1 && (promoted[1].meta.changes ?? 0) === 1) {
        replacementAwardId = candidateAwardId;
      }
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
  }
  return replacementAwardId;
}

export async function cancelPremiumAuction(db: D1Database, auctionId: string, adminEmail: string) {
  const auction = await auctionById(db, auctionId);
  if (!auction) throw Response.json({ error: "경매를 찾을 수 없습니다." }, { status: 404 });
  if (!new Set(["scheduled", "open"]).has(auction.status)) throw Response.json({ error: "진행 전 또는 입찰 중인 경매만 취소할 수 있습니다." }, { status: 409 });
  const now = unixNow();
  const results = await db.batch([
    db.prepare(`UPDATE premium_auctions SET status = 'cancelled', updated_at = ?
      WHERE id = ? AND status IN ('scheduled', 'open')`).bind(now, auctionId),
    prepareAuditWrite(db, adminEmail, "premium.auction.cancelled", "premium_auction", auctionId, {},
      { createdAt: now, onlyIfPreviousStatementChanged: true }),
    db.prepare(`UPDATE premium_bids SET status = 'cancelled', updated_at = ?
      WHERE auction_id = ? AND status = 'active'
        AND EXISTS (SELECT 1 FROM premium_auctions WHERE id = ? AND status = 'cancelled' AND updated_at = ?)`)
      .bind(now, auctionId, auctionId, now),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1) {
    throw Response.json({ error: "다른 요청에서 이미 경매 상태가 변경되었습니다." }, { status: 409 });
  }
}

export function assertAuctionOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw Response.json({ error: "요청 출처를 확인할 수 없습니다." }, { status: 403 });
}

function mondayStartKst(timestamp: number) {
  const shifted = new Date((timestamp + KST_OFFSET_SECONDS) * 1000);
  const dayFromMonday = (shifted.getUTCDay() + 6) % 7;
  const midnightUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) / 1000;
  return midnightUtc - dayFromMonday * 86_400 - KST_OFFSET_SECONDS;
}

async function auctionById(db: D1Database, id: string) {
  return await db.prepare("SELECT * FROM premium_auctions WHERE id = ?").bind(id).first<PremiumAuctionRow>();
}

async function awardById(db: D1Database, auctionId: string, awardId: string) {
  return await db.prepare("SELECT * FROM premium_awards WHERE id = ? AND auction_id = ?").bind(awardId, auctionId).first<AwardRow>();
}

function serializeAuction(row: PremiumAuctionRow) {
  const latestClosesAt = row.latest_closes_at ?? row.bidding_closes_at;
  const blindStartsAt = row.blind_starts_at ?? latestClosesAt - BLIND_WINDOW_SECONDS;
  return {
    id: row.id, targetStartsAt: row.target_starts_at, targetEndsAt: row.target_ends_at,
    biddingOpensAt: row.bidding_opens_at, blindStartsAt, latestClosesAt,
    blindActive: row.status === "open" && unixNow() >= blindStartsAt,
    slotCount: row.slot_count, minimumBid: row.minimum_bid, minimumIncrement: row.minimum_increment,
    status: row.status, finalizedAt: row.finalized_at,
  };
}

function serializeBid(row: BidRow) {
  return { id: row.id, auctionId: row.auction_id, serverId: row.server_id, amount: row.amount, status: row.status, placedAt: row.placed_at, updatedAt: row.updated_at };
}

function serializeAward(row: AwardRow) {
  return {
    id: row.id, auctionId: row.auction_id, bidId: row.bid_id, serverId: row.server_id, amount: row.amount,
    status: row.status, paymentConfirmedAt: row.payment_confirmed_at, paymentReference: row.payment_reference ?? null,
    createdAt: row.created_at,
  };
}

function serializePlacement(row: PlacementRow) {
  return {
    id: row.id,
    auctionId: row.auction_id,
    awardId: row.award_id,
    serverId: row.server_id,
    serverTitle: row.server_title,
    ownerEmail: row.owner_email,
    source: row.source,
    amount: row.amount,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    note: row.note,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw Response.json({ error: `${label} 범위를 확인해 주세요.` }, { status: 400 });
  return result;
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function randomBlindClose(blindStartsAt: number, latestClosesAt: number) {
  const earliestClose = Math.min(latestClosesAt, blindStartsAt + MINIMUM_BLIND_DURATION_SECONDS);
  const choices = Math.max(1, latestClosesAt - earliestClose + 1);
  const maximumUint32 = 0x1_0000_0000;
  const unbiasedLimit = maximumUint32 - (maximumUint32 % choices);
  const random = new Uint32Array(1);
  do crypto.getRandomValues(random); while (random[0] >= unbiasedLimit);
  return earliestClose + (random[0] % choices);
}

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const directoryServers = sqliteTable(
  "directory_servers",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    title: text("title").notNull(),
    shortDescription: text("short_description").notNull(),
    description: text("description").notNull(),
    descriptionDocument: text("description_document").notNull().default(""),
    edition: text("edition").notNull(),
    minVersion: text("min_version").notNull(),
    maxVersion: text("max_version").notNull(),
    address: text("address").notNull(),
    port: integer("port").notNull().default(25565),
    categories: text("categories").notNull().default("[]"),
    status: text("status").notNull().default("draft"),
    bridgeServerId: text("bridge_server_id"),
    ownerVerificationStatus: text("owner_verification_status").notNull().default("unverified"),
    ownerVerifiedAt: integer("owner_verified_at"),
    votesOverride: integer("votes_override"),
    votesAdjustment: integer("votes_adjustment").notNull().default(0),
    uptimeBasisPoints: integer("uptime_basis_points"),
    uptimeAdjustmentBasisPoints: integer("uptime_adjustment_basis_points").notNull().default(0),
    premiumManaged: integer("premium_managed", { mode: "boolean" }).notNull().default(false),
    premiumTier: text("premium_tier").notNull().default("none"),
    premiumStartsAt: integer("premium_starts_at"),
    premiumEndsAt: integer("premium_ends_at"),
    premiumNote: text("premium_note").notNull().default(""),
    discordUrl: text("discord_url").notNull().default(""),
    discordEnabled: integer("discord_enabled", { mode: "boolean" }).notNull().default(false),
    websiteUrl: text("website_url").notNull().default(""),
    websiteEnabled: integer("website_enabled", { mode: "boolean" }).notNull().default(false),
    kakaoUrl: text("kakao_url").notNull().default(""),
    kakaoEnabled: integer("kakao_enabled", { mode: "boolean" }).notNull().default(false),
    staffIntroEnabled: integer("staff_intro_enabled", { mode: "boolean" }).notNull().default(false),
    resolvedIps: text("resolved_ips").notNull().default("[]"),
    statusBeforeBlacklist: text("status_before_blacklist"),
    statusBeforeEnforcement: text("status_before_enforcement"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    index("directory_servers_owner_idx").on(table.ownerEmail),
    index("directory_servers_status_idx").on(table.status),
    uniqueIndex("directory_servers_address_idx").on(sql`${table.address} collate nocase`, table.port).where(sql`${table.deletedAt} is null`),
  ],
);

export const userAccounts = sqliteTable(
  "user_accounts",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    emailVerifiedAt: integer("email_verified_at").notNull(),
    lastLoginAt: integer("last_login_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    identityVerificationStatus: text("identity_verification_status").notNull().default("unverified"),
    identityVerifiedAt: integer("identity_verified_at"),
    identityProvider: text("identity_provider").notNull().default(""),
    identityReference: text("identity_reference").notNull().default(""),
  },
  (table) => [uniqueIndex("user_accounts_email_idx").on(table.email)],
);

export const userLoginCodes = sqliteTable(
  "user_login_codes",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    requestIpHash: text("request_ip_hash").notNull().default(""),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("user_login_codes_email_idx").on(table.email, table.createdAt),
    index("user_login_codes_expiry_idx").on(table.expiresAt),
    index("user_login_codes_ip_idx").on(table.requestIpHash, table.createdAt),
  ],
);

export const userSessions = sqliteTable(
  "user_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    accountId: text("account_id").notNull(),
    email: text("email").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => [
    index("user_sessions_account_idx").on(table.accountId),
    index("user_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const securityRateLimits = sqliteTable(
  "security_rate_limits",
  {
    bucket: text("bucket").notNull(),
    identityHash: text("identity_hash").notNull(),
    windowStarted: integer("window_started").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bucket, table.identityHash] }),
    index("security_rate_limits_updated_idx").on(table.updatedAt),
  ],
);

export const siteDailyVisitors = sqliteTable(
  "site_daily_visitors",
  {
    visitDay: text("visit_day").notNull(),
    visitorHash: text("visitor_hash").notNull(),
    firstSeenAt: integer("first_seen_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.visitDay, table.visitorHash] }),
    index("site_daily_visitors_seen_idx").on(table.firstSeenAt),
  ],
);

export const siteDailyVisitorTotals = sqliteTable("site_daily_visitor_totals", {
  visitDay: text("visit_day").primaryKey(),
  visitorCount: integer("visitor_count").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const serverOwnershipTransfers = sqliteTable(
  "server_ownership_transfers",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id").notNull(),
    fromEmail: text("from_email").notNull(),
    toEmail: text("to_email").notNull(),
    status: text("status").notNull().default("pending_acceptance"),
    challengeHash: text("challenge_hash"),
    challengeExpiresAt: integer("challenge_expires_at"),
    requestedAt: integer("requested_at").notNull(),
    acceptedAt: integer("accepted_at"),
    verifiedAt: integer("verified_at"),
    completedAt: integer("completed_at"),
    cancelledAt: integer("cancelled_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("ownership_transfers_server_idx").on(table.serverId, table.status),
    index("ownership_transfers_target_idx").on(table.toEmail, table.status),
  ],
);

export const serverOwnershipClaims = sqliteTable(
  "server_ownership_claims",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id").notNull(),
    claimantEmail: text("claimant_email").notNull(),
    method: text("method").notNull(),
    status: text("status").notNull().default("pending_verification"),
    challengeHash: text("challenge_hash").notNull(),
    challengeExpiresAt: integer("challenge_expires_at").notNull(),
    requestedAt: integer("requested_at").notNull(),
    verifiedAt: integer("verified_at"),
    reviewedAt: integer("reviewed_at"),
    reviewedBy: text("reviewed_by"),
    reviewNote: text("review_note").notNull().default(""),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("ownership_claims_server_idx").on(table.serverId, table.status),
    index("ownership_claims_claimant_idx").on(table.claimantEmail, table.status),
  ],
);

export const serverAssets = sqliteTable(
  "server_assets",
  {
    serverId: text("server_id").notNull(),
    kind: text("kind").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    size: integer("size").notNull(),
    focusX: integer("focus_x").notNull().default(50),
    focusY: integer("focus_y").notNull().default(50),
    zoomPercent: integer("zoom_percent").notNull().default(100),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.serverId, table.kind] }),
    index("server_assets_server_idx").on(table.serverId),
  ],
);

export const serverDescriptionAssets = sqliteTable(
  "server_description_assets",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    size: integer("size").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("server_description_assets_server_idx").on(table.serverId, table.createdAt)],
);

export const serverStaffProfiles = sqliteTable(
  "server_staff_profiles",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
    role: text("role").notNull(),
    nickname: text("nickname").notNull(),
    minecraftUuid: text("minecraft_uuid"),
    introduction: text("introduction").notNull(),
    discordEnabled: integer("discord_enabled", { mode: "boolean" }).notNull().default(false),
    discordUrl: text("discord_url").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("server_staff_order_idx").on(table.serverId, table.sortOrder),
    index("server_staff_server_idx").on(table.serverId),
  ],
);

export const serverVotes = sqliteTable(
  "server_votes",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id").notNull(),
    nickname: text("nickname").notNull(),
    minecraftUuid: text("minecraft_uuid"),
    voteDay: text("vote_day").notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    sourceIpMasked: text("source_ip_masked").notNull().default(""),
    sourceIpHash: text("source_ip_hash").notNull().default(""),
    sourceIpVersion: integer("source_ip_version").notNull().default(0),
    rewardStatus: text("reward_status").notNull().default("pending"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("server_votes_daily_idx").on(table.serverId, table.nickname, table.voteDay),
    uniqueIndex("server_votes_uuid_daily_idx").on(table.serverId, table.minecraftUuid, table.voteDay).where(sql`${table.minecraftUuid} is not null`),
    uniqueIndex("server_votes_source_daily_idx").on(table.serverId, table.sourceFingerprint, table.voteDay),
    index("server_votes_recent_idx").on(table.serverId, table.createdAt),
    index("server_votes_source_ip_idx").on(table.sourceIpHash, table.createdAt),
  ],
);

export const minecraftProfiles = sqliteTable(
  "minecraft_profiles",
  {
    nicknameKey: text("nickname_key").primaryKey(),
    canonicalName: text("canonical_name").notNull(),
    minecraftUuid: text("minecraft_uuid"),
    status: text("status").notNull(),
    expiresAt: integer("expires_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("minecraft_profiles_uuid_idx").on(table.minecraftUuid),
    index("minecraft_profiles_expiry_idx").on(table.expiresAt),
  ],
);

export const bridgeServers = sqliteTable("bridge_servers", {
  serverId: text("server_id").primaryKey(),
  platform: text("platform").notNull().default("unknown"),
  publicHost: text("public_host").notNull(),
  publicPort: integer("public_port").notNull(),
  challengeHash: text("challenge_hash").notNull(),
  challengeExpiresAt: integer("challenge_expires_at").notNull(),
  verifiedAt: integer("verified_at"),
  lastSeenAt: integer("last_seen_at"),
  lastPingAttemptAt: integer("last_ping_attempt_at"),
  lastPingSuccessAt: integer("last_ping_success_at"),
  pingPlayers: integer("ping_players").notNull().default(0),
  pingMaxPlayers: integer("ping_max_players").notNull().default(0),
  pingLatencyMs: integer("ping_latency_ms").notNull().default(0),
  pingVersion: text("ping_version").notNull().default("unknown"),
  totalPlayers: integer("total_players").notNull().default(0),
  maxPlayers: integer("max_players").notNull().default(0),
  backendCount: integer("backend_count").notNull().default(0),
  averagePingMs: integer("average_ping_ms").notNull().default(0),
  software: text("software").notNull().default("unknown"),
  version: text("version").notNull().default("unknown"),
  pluginVersion: text("plugin_version").notNull().default("unknown"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const bridgeNonces = sqliteTable(
  "bridge_nonces",
  {
    serverId: text("server_id").notNull(),
    nonce: text("nonce").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.serverId, table.nonce] }),
    index("bridge_nonces_expiry_idx").on(table.expiresAt),
  ],
);

export const bridgeBackends = sqliteTable(
  "bridge_backends",
  {
    serverId: text("server_id").notNull(),
    backendId: text("backend_id").notNull(),
    players: integer("players").notNull(),
    maxPlayers: integer("max_players").notNull(),
    online: integer("online", { mode: "boolean" }).notNull(),
    software: text("software").notNull(),
    version: text("version").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.serverId, table.backendId] }),
    index("bridge_backends_server_idx").on(table.serverId),
  ],
);

export const bridgeTelemetryHistory = sqliteTable(
  "bridge_telemetry_history",
  {
    serverId: text("server_id").notNull(),
    bucketAt: integer("bucket_at").notNull(),
    totalPlayers: integer("total_players").notNull(),
    maxPlayers: integer("max_players").notNull(),
    averagePingMs: integer("average_ping_ms").notNull(),
    online: integer("online", { mode: "boolean" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.serverId, table.bucketAt] }),
    index("bridge_history_server_time_idx").on(table.serverId, table.bucketAt),
  ],
);

export const serverStatusHistory = sqliteTable(
  "server_status_history",
  {
    serverId: text("server_id").notNull(),
    bucketAt: integer("bucket_at").notNull(),
    players: integer("players").notNull(),
    maxPlayers: integer("max_players").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    online: integer("online", { mode: "boolean" }).notNull(),
    source: text("source").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.serverId, table.bucketAt] }),
    index("server_status_history_time_idx").on(table.serverId, table.bucketAt),
  ],
);

export const adminSessions = sqliteTable(
  "admin_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    adminEmail: text("admin_email").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => [index("admin_sessions_expiry_idx").on(table.expiresAt)],
);

export const adminLoginAttempts = sqliteTable("admin_login_attempts", {
  fingerprint: text("fingerprint").primaryKey(),
  failureCount: integer("failure_count").notNull().default(0),
  blockedUntil: integer("blocked_until").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const adminAuditLogs = sqliteTable(
  "admin_audit_logs",
  {
    id: text("id").primaryKey(),
    adminEmail: text("admin_email").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    details: text("details").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("admin_audit_created_idx").on(table.createdAt)],
);

export const siteAnnouncements = sqliteTable(
  "site_announcements",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    detail: text("detail").notNull(),
    publicationStatus: text("publication_status").notNull().default("draft"),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    revision: integer("revision").notNull().default(1),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    deletedBy: text("deleted_by"),
  },
  (table) => [
    check("site_announcements_status_check", sql`${table.publicationStatus} in ('draft', 'published', 'archived')`),
    check("site_announcements_period_check", sql`${table.endsAt} > ${table.startsAt}`),
    index("site_announcements_window_idx").on(table.publicationStatus, table.deletedAt, table.startsAt, table.endsAt),
    index("site_announcements_admin_idx").on(table.deletedAt, table.updatedAt, table.id),
  ],
);

export const serverBlacklist = sqliteTable(
  "server_blacklist",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("active"),
    expiresAt: integer("expires_at"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("server_blacklist_lookup_idx").on(table.kind, table.value, table.status),
    index("server_blacklist_status_idx").on(table.status),
  ],
);

export const voteSourceBlocks = sqliteTable(
  "vote_source_blocks",
  {
    id: text("id").primaryKey(),
    sourceIpHash: text("source_ip_hash").notNull(),
    sourceIpMasked: text("source_ip_masked").notNull(),
    sourceIpVersion: integer("source_ip_version").notNull().default(0),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("active"),
    expiresAt: integer("expires_at").notNull(),
    createdBy: text("created_by").notNull(),
    resolvedBy: text("resolved_by"),
    resolvedAt: integer("resolved_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("vote_source_blocks_lookup_idx").on(table.sourceIpHash, table.status, table.expiresAt),
    index("vote_source_blocks_status_idx").on(table.status, table.expiresAt),
  ],
);

export const serverEnforcements = sqliteTable(
  "server_enforcements",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id").notNull(),
    kind: text("kind").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("active"),
    startsAt: integer("starts_at").notNull(),
    expiresAt: integer("expires_at"),
    createdBy: text("created_by").notNull(),
    resolvedBy: text("resolved_by"),
    resolvedAt: integer("resolved_at"),
    resolutionNote: text("resolution_note").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("server_enforcements_server_idx").on(table.serverId, table.status, table.createdAt),
    index("server_enforcements_active_idx").on(table.status, table.kind, table.expiresAt),
  ],
);

export const adminConversations = sqliteTable(
  "admin_conversations",
  {
    serverId: text("server_id").primaryKey(),
    status: text("status").notNull().default("open"),
    unreadAdmin: integer("unread_admin").notNull().default(0),
    unreadOwner: integer("unread_owner").notNull().default(0),
    lastMessageAt: integer("last_message_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("admin_conversations_updated_idx").on(table.updatedAt)],
);

export const adminMessages = sqliteTable(
  "admin_messages",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id").notNull(),
    senderRole: text("sender_role").notNull(),
    senderEmail: text("sender_email").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("admin_messages_thread_idx").on(table.serverId, table.createdAt)],
);

export const operatorChannelMessages = sqliteTable(
  "operator_channel_messages",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id").notNull(),
    serverTitle: text("server_title").notNull(),
    ownerEmail: text("owner_email").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("operator_channel_created_idx").on(table.createdAt),
    index("operator_channel_server_idx").on(table.serverId, table.createdAt),
  ],
);

export const chatRealtimeTickets = sqliteTable(
  "chat_realtime_tickets",
  {
    tokenHash: text("token_hash").primaryKey(),
    scope: text("scope").notNull(),
    serverId: text("server_id"),
    role: text("role").notNull(),
    principalEmail: text("principal_email").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("chat_realtime_tickets_expiry_idx").on(table.expiresAt)],
);

export const premiumAuctions = sqliteTable(
  "premium_auctions",
  {
    id: text("id").primaryKey(),
    targetStartsAt: integer("target_starts_at").notNull(),
    targetEndsAt: integer("target_ends_at").notNull(),
    biddingOpensAt: integer("bidding_opens_at").notNull(),
    biddingClosesAt: integer("bidding_closes_at").notNull(),
    blindStartsAt: integer("blind_starts_at"),
    latestClosesAt: integer("latest_closes_at"),
    slotCount: integer("slot_count").notNull().default(4),
    minimumBid: integer("minimum_bid").notNull().default(10000),
    minimumIncrement: integer("minimum_increment").notNull().default(1000),
    status: text("status").notNull().default("scheduled"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    finalizedAt: integer("finalized_at"),
  },
  (table) => [
    uniqueIndex("premium_auctions_target_idx").on(table.targetStartsAt),
    index("premium_auctions_status_idx").on(table.status),
  ],
);

export const premiumBids = sqliteTable(
  "premium_bids",
  {
    id: text("id").primaryKey(),
    auctionId: text("auction_id").notNull(),
    serverId: text("server_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    amount: integer("amount").notNull(),
    status: text("status").notNull().default("active"),
    verifiedAt: integer("verified_at").notNull(),
    placedAt: integer("placed_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("premium_bids_ranking_idx").on(table.auctionId, table.status, table.amount, table.updatedAt),
    index("premium_bids_server_idx").on(table.serverId),
    uniqueIndex("premium_bids_auction_server_idx").on(table.auctionId, table.serverId),
    uniqueIndex("premium_bids_auction_owner_idx").on(table.auctionId, table.ownerEmail),
  ],
);

export const premiumAwards = sqliteTable(
  "premium_awards",
  {
    id: text("id").primaryKey(),
    auctionId: text("auction_id").notNull(),
    bidId: text("bid_id").notNull(),
    serverId: text("server_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    amount: integer("amount").notNull(),
    status: text("status").notNull().default("payment_pending"),
    paymentConfirmedAt: integer("payment_confirmed_at"),
    paymentReference: text("payment_reference"),
    confirmedBy: text("confirmed_by"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("premium_awards_auction_idx").on(table.auctionId, table.status),
    index("premium_awards_server_idx").on(table.serverId),
    uniqueIndex("premium_awards_bid_idx").on(table.bidId),
  ],
);

export const premiumPlacements = sqliteTable(
  "premium_placements",
  {
    id: text("id").primaryKey(),
    originKey: text("origin_key").notNull(),
    auctionId: text("auction_id"),
    awardId: text("award_id"),
    serverId: text("server_id").notNull(),
    serverTitle: text("server_title").notNull(),
    ownerEmail: text("owner_email").notNull(),
    source: text("source").notNull(),
    amount: integer("amount").notNull().default(0),
    status: text("status").notNull().default("scheduled"),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    note: text("note").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("premium_placements_origin_idx").on(table.originKey),
    index("premium_placements_period_idx").on(table.status, table.startsAt, table.endsAt),
    index("premium_placements_server_idx").on(table.serverId, table.startsAt),
  ],
);

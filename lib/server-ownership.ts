import { ensureAdminSchema, prepareAuditWrite, writeAudit } from "@/lib/admin-security";
import { hashHex } from "@/lib/bridge-api";
import { directoryEnv } from "@/lib/server-directory";
import { pingMinecraftServer } from "@/lib/minecraft-ping";
import { ensurePremiumAuctionSchema, hasActiveFinancialLock } from "@/lib/premium-auction";
import { assertSameOrigin, ensureUserAuthSchema, normalizeEmail, sendProductEmail, type UserAuthEnvironment } from "@/lib/user-auth";

export type OwnershipMethod = "motd" | "dns";

type OwnershipEnvironment = UserAuthEnvironment & { ALLOW_PRIVATE_BRIDGE_VERIFY?: string };
type ServerOwnerRow = {
  id: string; title: string; address: string; port: number; owner_email: string; status: string;
  owner_verification_status: string; owner_verified_at: number | null; bridge_server_id: string | null; deleted_at: number | null;
};
type TransferRow = {
  id: string; server_id: string; from_email: string; to_email: string; status: string;
  challenge_hash: string | null; challenge_expires_at: number | null; requested_at: number;
  accepted_at: number | null; verified_at: number | null; completed_at: number | null;
  cancelled_at: number | null; updated_at: number; title?: string; address?: string; port?: number;
};
type ClaimRow = {
  id: string; server_id: string; claimant_email: string; method: OwnershipMethod; status: string;
  challenge_hash: string; challenge_expires_at: number; requested_at: number; verified_at: number | null;
  reviewed_at: number | null; reviewed_by: string | null; review_note: string; updated_at: number;
  title?: string; address?: string; port?: number; owner_email?: string;
};

export async function ownershipEnv() {
  return await directoryEnv() as OwnershipEnvironment;
}

export async function ensureOwnershipSchema(db: D1Database) {
  if (process.env.NODE_ENV === "production") return;
  await ensureAdminSchema(db);
  await ensureUserAuthSchema(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS server_ownership_transfers (
      id TEXT PRIMARY KEY NOT NULL,
      server_id TEXT NOT NULL,
      from_email TEXT NOT NULL,
      to_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_acceptance',
      challenge_hash TEXT,
      challenge_expires_at INTEGER,
      requested_at INTEGER NOT NULL,
      accepted_at INTEGER,
      verified_at INTEGER,
      completed_at INTEGER,
      cancelled_at INTEGER,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS ownership_transfers_server_idx ON server_ownership_transfers (server_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS ownership_transfers_target_idx ON server_ownership_transfers (to_email, status)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS server_ownership_claims (
      id TEXT PRIMARY KEY NOT NULL,
      server_id TEXT NOT NULL,
      claimant_email TEXT NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_verification',
      challenge_hash TEXT NOT NULL,
      challenge_expires_at INTEGER NOT NULL,
      requested_at INTEGER NOT NULL,
      verified_at INTEGER,
      reviewed_at INTEGER,
      reviewed_by TEXT,
      review_note TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS ownership_claims_server_idx ON server_ownership_claims (server_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS ownership_claims_claimant_idx ON server_ownership_claims (claimant_email, status)"),
  ]);
  await backfillVerifiedOwners(db);
}

export async function ownershipSummary(db: D1Database, ownerEmail: string) {
  await ensureOwnershipSchema(db);
  await expireOwnershipRequests(db);
  const [outgoing, incoming, claims] = await Promise.all([
    db.prepare(`SELECT t.*, d.title, d.address, d.port FROM server_ownership_transfers t
      JOIN directory_servers d ON d.id = t.server_id WHERE t.from_email = ? ORDER BY t.requested_at DESC LIMIT 50`)
      .bind(ownerEmail).all<TransferRow>(),
    db.prepare(`SELECT t.*, d.title, d.address, d.port FROM server_ownership_transfers t
      JOIN directory_servers d ON d.id = t.server_id WHERE t.to_email = ? ORDER BY t.requested_at DESC LIMIT 50`)
      .bind(ownerEmail).all<TransferRow>(),
    db.prepare(`SELECT c.*, d.title, d.address, d.port FROM server_ownership_claims c
      JOIN directory_servers d ON d.id = c.server_id WHERE c.claimant_email = ? ORDER BY c.requested_at DESC LIMIT 50`)
      .bind(ownerEmail).all<ClaimRow>(),
  ]);
  return {
    outgoing: outgoing.results.map(serializeTransfer),
    incoming: incoming.results.map(serializeTransfer),
    claims: claims.results.map((claim) => serializeClaim(claim)),
  };
}

export async function createOwnershipTransfer(request: Request, ownerEmail: string, payload: unknown) {
  assertSameOrigin(request);
  if (!payload || typeof payload !== "object") throw Response.json({ error: "이전 정보를 확인해 주세요." }, { status: 400 });
  const body = payload as Record<string, unknown>;
  const serverId = typeof body.serverId === "string" ? body.serverId : "";
  const toEmail = normalizeEmail(body.toEmail);
  if (!/^[a-f0-9]{32}$/.test(serverId)) throw Response.json({ error: "유효한 서버를 선택해 주세요." }, { status: 400 });
  if (toEmail === ownerEmail) throw Response.json({ error: "현재 소유자와 다른 이메일을 입력해 주세요." }, { status: 400 });
  const environment = await ownershipEnv();
  await ensureOwnershipSchema(environment.DB);
  const server = await ownedServer(environment.DB, serverId, ownerEmail);
  if (server.owner_verification_status === "disputed") throw Response.json({ error: "소유권 분쟁 중인 서버는 이전할 수 없습니다." }, { status: 409 });
  const active = await environment.DB.prepare(`SELECT id FROM server_ownership_transfers
    WHERE server_id = ? AND status IN ('pending_acceptance', 'pending_verification') LIMIT 1`).bind(serverId).first();
  if (active) throw Response.json({ error: "이미 진행 중인 소유권 이전이 있습니다." }, { status: 409 });
  await assertNoOwnershipFinancialLock(environment.DB, serverId);
  const now = unixNow();
  const id = crypto.randomUUID().replaceAll("-", "");
  const lock = await environment.DB.prepare(`UPDATE directory_servers SET owner_verification_status = 'transfer_pending', updated_at = ?
    WHERE id = ? AND owner_email = ? AND owner_verification_status NOT IN ('transfer_pending', 'disputed')`)
    .bind(now, serverId, ownerEmail).run();
  if (lock.meta.changes !== 1) throw Response.json({ error: "소유권 상태가 변경되었습니다. 화면을 새로고침해 주세요." }, { status: 409 });
  try {
    await environment.DB.prepare(`INSERT INTO server_ownership_transfers
      (id, server_id, from_email, to_email, status, requested_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending_acceptance', ?, ?)`).bind(id, serverId, ownerEmail, toEmail, now, now).run();
  } catch (error) {
    await restoreOwnerVerificationStatus(environment.DB, serverId, ownerEmail, now);
    throw error;
  }
  await writeAudit(environment.DB, ownerEmail, "ownership.transfer.requested", "server", serverId, { transferId: id, toEmail });
  try {
    await notify(environment, toEmail, `${server.title} 서버 소유권 이전 요청`,
      `${ownerEmail} 운영자가 ${server.title} 서버의 소유권 이전을 요청했습니다. Minecraft.kr에 ${toEmail}로 로그인해 수락하고 서버를 재인증해 주세요.`,
      `ownership-transfer/${id}`);
  } catch (error) {
    await environment.DB.prepare("UPDATE server_ownership_transfers SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?")
      .bind(now, now, id).run();
    await restoreOwnerVerificationStatus(environment.DB, serverId, ownerEmail, now);
    throw error;
  }
  return { transfer: serializeTransfer({ id, server_id: serverId, from_email: ownerEmail, to_email: toEmail, status: "pending_acceptance", challenge_hash: null, challenge_expires_at: null, requested_at: now, accepted_at: null, verified_at: null, completed_at: null, cancelled_at: null, updated_at: now, title: server.title, address: server.address, port: server.port }) };
}

export async function updateOwnershipTransfer(request: Request, ownerEmail: string, transferId: string, payload: unknown) {
  assertSameOrigin(request);
  if (!/^[a-f0-9]{32}$/.test(transferId)) throw Response.json({ error: "유효하지 않은 이전 요청입니다." }, { status: 400 });
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const action = typeof body.action === "string" ? body.action : "";
  const environment = await ownershipEnv();
  await ensureOwnershipSchema(environment.DB);
  const transfer = await environment.DB.prepare("SELECT * FROM server_ownership_transfers WHERE id = ?").bind(transferId).first<TransferRow>();
  if (!transfer) throw Response.json({ error: "이전 요청을 찾을 수 없습니다." }, { status: 404 });
  const server = await serverById(environment.DB, transfer.server_id);
  const now = unixNow();

  if (action === "cancel") {
    if (ownerEmail !== transfer.from_email && ownerEmail !== transfer.to_email) throw Response.json({ error: "이전 요청을 취소할 권한이 없습니다." }, { status: 403 });
    if (!new Set(["pending_acceptance", "pending_verification"]).has(transfer.status)) throw Response.json({ error: "취소할 수 없는 이전 상태입니다." }, { status: 409 });
    const cancelled = await environment.DB.batch([
      environment.DB.prepare(`UPDATE server_ownership_transfers SET status = 'cancelled', cancelled_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('pending_acceptance', 'pending_verification')`)
        .bind(now, now, transferId),
      environment.DB.prepare(`UPDATE directory_servers SET owner_verification_status =
        CASE WHEN owner_verified_at IS NULL THEN 'unverified' ELSE 'verified' END, updated_at = ?
        WHERE id = ? AND owner_email = ? AND owner_verification_status = 'transfer_pending' AND changes() = 1`)
        .bind(now, transfer.server_id, transfer.from_email),
    ]);
    if (cancelled[0].meta.changes !== 1) throw Response.json({ error: "이전 요청 상태가 이미 변경되었습니다. 새로고침해 주세요." }, { status: 409 });
    await writeAudit(environment.DB, ownerEmail, "ownership.transfer.cancelled", "server", transfer.server_id, { transferId });
    return { status: "cancelled" };
  }

  if (ownerEmail !== transfer.to_email) throw Response.json({ error: "이전 대상 이메일로 로그인해 주세요." }, { status: 403 });
  if (action === "accept" || action === "challenge") {
    if (!new Set(["pending_acceptance", "pending_verification"]).has(transfer.status)) throw Response.json({ error: "수락할 수 없는 이전 상태입니다." }, { status: 409 });
    const token = ownershipToken();
    const expiresAt = now + 3600;
    const accepted = await environment.DB.prepare(`UPDATE server_ownership_transfers SET status = 'pending_verification', challenge_hash = ?,
      challenge_expires_at = ?, accepted_at = COALESCE(accepted_at, ?), updated_at = ?
      WHERE id = ? AND to_email = ? AND status IN ('pending_acceptance', 'pending_verification')`)
      .bind(await hashHex(token), expiresAt, now, now, transferId, ownerEmail).run();
    if (accepted.meta.changes !== 1) throw Response.json({ error: "이전 요청 상태가 이미 변경되었습니다. 새로고침해 주세요." }, { status: 409 });
    await writeAudit(environment.DB, ownerEmail, "ownership.transfer.accepted", "server", transfer.server_id, { transferId, challengeExpiresAt: expiresAt });
    return { status: "pending_verification", verificationToken: token, marker: `[MKR-TRANSFER:${token}]`, expiresAt };
  }

  if (action === "verify") {
    if (transfer.status !== "pending_verification" || !transfer.challenge_hash || !transfer.challenge_expires_at || transfer.challenge_expires_at <= now) {
      throw Response.json({ error: "인증 토큰이 만료되었습니다. 인증 문자열을 다시 발급해 주세요." }, { status: 409 });
    }
    const token = typeof body.verificationToken === "string" ? body.verificationToken : "";
    if (!token || await hashHex(token) !== transfer.challenge_hash) throw Response.json({ error: "인증 토큰이 일치하지 않습니다." }, { status: 400 });
    const ping = await pingMinecraftServer(server.address, server.port, environment.ALLOW_PRIVATE_BRIDGE_VERIFY === "true");
    if (!ping.descriptionText.includes(`[MKR-TRANSFER:${token}]`)) {
      throw Response.json({ error: "실제 서버 MOTD에서 이전 인증 문자열을 찾지 못했습니다.", observedMotd: ping.descriptionText }, { status: 422 });
    }
    await assertNoOwnershipFinancialLock(environment.DB, transfer.server_id);
    await completeOwnershipChange(environment.DB, server, transfer.to_email, ownerEmail, {
      kind: "transfer", requestId: transferId, now,
    });
    await notify(environment, transfer.from_email, `${server.title} 서버 소유권 이전 완료`, `${server.title} 서버의 소유권이 ${transfer.to_email} 계정으로 이전되었습니다.`, `ownership-complete/${transferId}`).catch(() => false);
    return { status: "completed", serverId: transfer.server_id };
  }
  throw Response.json({ error: "지원하지 않는 이전 작업입니다." }, { status: 400 });
}

export async function createOwnershipClaim(request: Request, claimantEmail: string, payload: unknown) {
  assertSameOrigin(request);
  if (!payload || typeof payload !== "object") throw Response.json({ error: "서버 주장 정보를 확인해 주세요." }, { status: 400 });
  const body = payload as Record<string, unknown>;
  const serverId = typeof body.serverId === "string" ? body.serverId : "";
  const method: OwnershipMethod = body.method === "dns" ? "dns" : "motd";
  if (!/^[a-f0-9]{32}$/.test(serverId)) throw Response.json({ error: "유효한 서버를 선택해 주세요." }, { status: 400 });
  const environment = await ownershipEnv();
  await ensureOwnershipSchema(environment.DB);
  const server = await serverById(environment.DB, serverId);
  if (server.owner_email === claimantEmail) throw Response.json({ error: "이미 이 서버의 소유자입니다." }, { status: 409 });
  if (server.status !== "active") throw Response.json({ error: "현재 공개 운영 중인 서버만 소유권을 주장할 수 있습니다." }, { status: 409 });
  const existing = await environment.DB.prepare(`SELECT id FROM server_ownership_claims WHERE server_id = ? AND claimant_email = ?
    AND status IN ('pending_verification', 'pending_review') LIMIT 1`).bind(serverId, claimantEmail).first();
  if (existing) throw Response.json({ error: "이미 진행 중인 서버 주장 요청이 있습니다. 운영자센터에서 상태를 확인해 주세요." }, { status: 409 });
  const now = unixNow();
  const id = crypto.randomUUID().replaceAll("-", "");
  const token = ownershipToken();
  const expiresAt = now + 3600;
  await environment.DB.prepare(`INSERT INTO server_ownership_claims
    (id, server_id, claimant_email, method, status, challenge_hash, challenge_expires_at, requested_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending_verification', ?, ?, ?, ?)`)
    .bind(id, serverId, claimantEmail, method, await hashHex(token), expiresAt, now, now).run();
  await writeAudit(environment.DB, claimantEmail, "ownership.claim.requested", "server", serverId, { claimId: id, method });
  return { claim: serializeClaim({ id, server_id: serverId, claimant_email: claimantEmail, method, status: "pending_verification", challenge_hash: "", challenge_expires_at: expiresAt, requested_at: now, verified_at: null, reviewed_at: null, reviewed_by: null, review_note: "", updated_at: now, title: server.title, address: server.address, port: server.port }), verificationToken: token, challenge: challengeFor(method, server.address, token) };
}

export async function updateOwnershipClaim(request: Request, claimantEmail: string, claimId: string, payload: unknown) {
  assertSameOrigin(request);
  if (!/^[a-f0-9]{32}$/.test(claimId)) throw Response.json({ error: "유효하지 않은 서버 주장 요청입니다." }, { status: 400 });
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const action = typeof body.action === "string" ? body.action : "";
  const environment = await ownershipEnv();
  await ensureOwnershipSchema(environment.DB);
  const claim = await environment.DB.prepare("SELECT * FROM server_ownership_claims WHERE id = ? AND claimant_email = ?")
    .bind(claimId, claimantEmail).first<ClaimRow>();
  if (!claim) throw Response.json({ error: "서버 주장 요청을 찾을 수 없습니다." }, { status: 404 });
  const server = await serverById(environment.DB, claim.server_id);
  const now = unixNow();
  if (action === "cancel") {
    if (!new Set(["pending_verification", "pending_review"]).has(claim.status)) throw Response.json({ error: "취소할 수 없는 요청입니다." }, { status: 409 });
    const cancelled = await environment.DB.prepare(`UPDATE server_ownership_claims SET status = 'cancelled', updated_at = ?
      WHERE id = ? AND status IN ('pending_verification', 'pending_review')`).bind(now, claimId).run();
    if (cancelled.meta.changes !== 1) throw Response.json({ error: "요청 상태가 이미 변경되었습니다. 새로고침해 주세요." }, { status: 409 });
    await refreshDisputeStatus(environment.DB, claim.server_id, now);
    await writeAudit(environment.DB, claimantEmail, "ownership.claim.cancelled", "server", claim.server_id, { claimId });
    return { status: "cancelled" };
  }
  if (action === "challenge") {
    if (claim.status !== "pending_verification") throw Response.json({ error: "인증 문자열을 다시 발급할 수 없는 상태입니다." }, { status: 409 });
    const token = ownershipToken();
    const expiresAt = now + 3600;
    const challenged = await environment.DB.prepare(`UPDATE server_ownership_claims SET challenge_hash = ?, challenge_expires_at = ?, updated_at = ?
      WHERE id = ? AND claimant_email = ? AND status = 'pending_verification'`)
      .bind(await hashHex(token), expiresAt, now, claimId, claimantEmail).run();
    if (challenged.meta.changes !== 1) throw Response.json({ error: "요청 상태가 이미 변경되었습니다. 새로고침해 주세요." }, { status: 409 });
    return { status: claim.status, verificationToken: token, challenge: challengeFor(claim.method, server.address, token), expiresAt };
  }
  if (action !== "verify") throw Response.json({ error: "지원하지 않는 서버 주장 작업입니다." }, { status: 400 });
  if (claim.status !== "pending_verification" || claim.challenge_expires_at <= now) throw Response.json({ error: "인증 문자열이 만료되었습니다. 다시 발급해 주세요." }, { status: 409 });
  const token = typeof body.verificationToken === "string" ? body.verificationToken : "";
  if (!token || await hashHex(token) !== claim.challenge_hash) throw Response.json({ error: "인증 토큰이 일치하지 않습니다." }, { status: 400 });
  if (claim.method === "motd") {
    const ping = await pingMinecraftServer(server.address, server.port, environment.ALLOW_PRIVATE_BRIDGE_VERIFY === "true");
    if (!ping.descriptionText.includes(`[MKR-CLAIM:${token}]`)) throw Response.json({ error: "실제 서버 MOTD에서 주장 인증 문자열을 찾지 못했습니다.", observedMotd: ping.descriptionText }, { status: 422 });
  } else {
    const verified = await verifyDnsClaim(server.address, token);
    if (!verified) throw Response.json({ error: `_${"minecraft-kr-verify"}.${server.address} TXT 레코드에서 인증값을 찾지 못했습니다.` }, { status: 422 });
  }
  const verified = await environment.DB.batch([
    environment.DB.prepare("UPDATE server_ownership_claims SET status = 'pending_review', verified_at = ?, updated_at = ? WHERE id = ? AND status = 'pending_verification'").bind(now, now, claimId),
    environment.DB.prepare("UPDATE directory_servers SET owner_verification_status = 'disputed', updated_at = ? WHERE id = ? AND changes() = 1").bind(now, claim.server_id),
    prepareAuditWrite(environment.DB, claimantEmail, "ownership.claim.verified", "server", claim.server_id, {
      claimId,
      method: claim.method,
    }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
  ]);
  if (verified[0].meta.changes !== 1 || verified[1].meta.changes !== 1) {
    throw Response.json({ error: "요청 상태가 이미 변경되었습니다. 새로고침해 주세요." }, { status: 409 });
  }
  await Promise.all([
    notify(environment, server.owner_email, `${server.title} 서버 소유권 주장 알림`, `${claimantEmail} 계정이 ${server.title} 서버의 기술적 통제권을 인증했습니다. Minecraft.kr 총관리자 심사가 진행됩니다.`, `ownership-claim-owner/${claimId}`).catch(() => false),
    environment.ADMIN_EMAIL ? notify(environment, environment.ADMIN_EMAIL, `${server.title} 소유권 심사 필요`, `${claimantEmail} 계정이 ${claim.method.toUpperCase()} 인증을 완료했습니다. 총관리자 시스템에서 승인 또는 거절해 주세요.`, `ownership-claim-admin/${claimId}`).catch(() => false) : Promise.resolve(false),
  ]);
  return { status: "pending_review" };
}

export async function adminOwnershipDashboard(db: D1Database) {
  await ensureOwnershipSchema(db);
  await expireOwnershipRequests(db);
  const [claims, transfers] = await Promise.all([
    db.prepare(`SELECT c.*, d.title, d.address, d.port, d.owner_email FROM server_ownership_claims c
      JOIN directory_servers d ON d.id = c.server_id
      WHERE d.deleted_at IS NULL AND (
        c.status IN ('pending_verification', 'pending_review')
        OR c.id IN (SELECT id FROM server_ownership_claims ORDER BY updated_at DESC LIMIT 200)
      )
      ORDER BY CASE c.status WHEN 'pending_review' THEN 0 WHEN 'pending_verification' THEN 1 ELSE 2 END, c.updated_at DESC`).all<ClaimRow>(),
    db.prepare(`SELECT t.*, d.title, d.address, d.port FROM server_ownership_transfers t
      JOIN directory_servers d ON d.id = t.server_id
      WHERE d.deleted_at IS NULL AND (
        t.status IN ('pending_acceptance', 'pending_verification')
        OR t.id IN (SELECT id FROM server_ownership_transfers ORDER BY updated_at DESC LIMIT 200)
      )
      ORDER BY CASE WHEN t.status IN ('pending_acceptance', 'pending_verification') THEN 0 ELSE 1 END, t.updated_at DESC`).all<TransferRow>(),
  ]);
  return { claims: claims.results.map((claim) => serializeClaim(claim, true)), transfers: transfers.results.map(serializeTransfer) };
}

export async function reviewOwnershipClaim(request: Request, adminEmail: string, claimId: string, payload: unknown) {
  assertSameOrigin(request);
  if (!/^[a-f0-9]{32}$/.test(claimId)) throw Response.json({ error: "유효하지 않은 서버 주장 요청입니다." }, { status: 400 });
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const action = body.action === "approve" ? "approve" : body.action === "reject" ? "reject" : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (!action) throw Response.json({ error: "승인 또는 거절 작업을 선택해 주세요." }, { status: 400 });
  const environment = await ownershipEnv();
  await ensureOwnershipSchema(environment.DB);
  const claim = await environment.DB.prepare("SELECT * FROM server_ownership_claims WHERE id = ?").bind(claimId).first<ClaimRow>();
  if (!claim) throw Response.json({ error: "서버 주장 요청을 찾을 수 없습니다." }, { status: 404 });
  if (claim.status !== "pending_review") throw Response.json({ error: "기술 인증과 심사 대기 상태인 요청만 처리할 수 있습니다." }, { status: 409 });
  const server = await serverById(environment.DB, claim.server_id);
  const now = unixNow();
  if (action === "reject") {
    const rejected = await environment.DB.batch([
      environment.DB.prepare(`UPDATE server_ownership_claims SET status = 'rejected', reviewed_at = ?, reviewed_by = ?, review_note = ?, updated_at = ?
        WHERE id = ? AND status = 'pending_review'`).bind(now, adminEmail, note, now, claimId),
      prepareAuditWrite(environment.DB, adminEmail, "ownership.claim.rejected", "server", claim.server_id, {
        claimId,
        claimantEmail: claim.claimant_email,
        note,
      }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
    ]);
    if (rejected[0].meta.changes !== 1) throw Response.json({ error: "요청 상태가 이미 변경되었습니다. 새로고침해 주세요." }, { status: 409 });
    await refreshDisputeStatus(environment.DB, claim.server_id, now);
    await notify(environment, claim.claimant_email, `${server.title} 서버 주장 심사 결과`, `서버 소유권 주장 요청이 거절되었습니다.${note ? ` 사유: ${note}` : ""}`, `ownership-claim-rejected/${claimId}`).catch(() => false);
    return { status: "rejected" };
  }
  await assertNoOwnershipFinancialLock(environment.DB, claim.server_id);
  await completeOwnershipChange(environment.DB, server, claim.claimant_email, adminEmail, {
    kind: "claim", requestId: claimId, note, now,
  });
  await environment.DB.batch([
    environment.DB.prepare(`UPDATE server_ownership_claims SET status = 'rejected', reviewed_at = ?, reviewed_by = ?,
      review_note = '다른 소유권 요청이 승인되어 자동 종료', updated_at = ? WHERE server_id = ? AND id <> ?
      AND status IN ('pending_verification', 'pending_review')`).bind(now, adminEmail, now, claim.server_id, claimId),
  ]);
  await Promise.all([
    notify(environment, claim.claimant_email, `${server.title} 서버 소유권 승인`, `${server.title} 서버가 ${claim.claimant_email} 계정으로 이전되었습니다. 운영자센터에서 새 브리지 키를 발급해 주세요.`, `ownership-claim-approved/${claimId}`).catch(() => false),
    notify(environment, server.owner_email, `${server.title} 서버 소유권 변경`, `Minecraft.kr 소유권 심사 결과 ${server.title} 서버가 ${claim.claimant_email} 계정으로 이전되었습니다.`, `ownership-claim-owner-changed/${claimId}`).catch(() => false),
  ]);
  return { status: "approved" };
}

async function completeOwnershipChange(
  db: D1Database,
  server: ServerOwnerRow,
  nextEmail: string,
  actorEmail: string,
  completion: { kind: "transfer"; requestId: string; now: number } | { kind: "claim"; requestId: string; note: string; now: number },
) {
  const transitionExists = completion.kind === "transfer"
    ? `EXISTS (SELECT 1 FROM server_ownership_transfers
        WHERE id = ? AND server_id = ? AND to_email = ? AND status = 'pending_verification')`
    : `EXISTS (SELECT 1 FROM server_ownership_claims
        WHERE id = ? AND server_id = ? AND claimant_email = ? AND status = 'pending_review')`;
  const ownerUpdate = db.prepare(`UPDATE directory_servers SET owner_email = ?, owner_verification_status = 'verified', owner_verified_at = ?,
      bridge_server_id = NULL, status = 'active', updated_at = ?
      WHERE id = ? AND owner_email = ? AND deleted_at IS NULL AND ${transitionExists}
        AND NOT EXISTS (
          SELECT 1 FROM premium_bids
          WHERE server_id = directory_servers.id AND status IN ('active', 'winner_pending')
        )
        AND NOT EXISTS (
          SELECT 1 FROM premium_awards
          WHERE server_id = directory_servers.id AND status IN ('payment_pending', 'scheduled', 'active')
        )
        AND NOT EXISTS (
          SELECT 1 FROM premium_placements
          WHERE server_id = directory_servers.id AND status IN ('scheduled', 'active')
        )`)
    .bind(nextEmail, completion.now, completion.now, server.id, server.owner_email,
      completion.requestId, server.id, nextEmail);
  const transitionUpdate = completion.kind === "transfer"
    ? db.prepare(`UPDATE server_ownership_transfers SET status = 'completed', verified_at = ?, completed_at = ?, updated_at = ?
        WHERE id = ? AND server_id = ? AND to_email = ? AND status = 'pending_verification' AND changes() = 1`)
      .bind(completion.now, completion.now, completion.now, completion.requestId, server.id, nextEmail)
    : db.prepare(`UPDATE server_ownership_claims SET status = 'approved', reviewed_at = ?, reviewed_by = ?, review_note = ?, updated_at = ?
        WHERE id = ? AND server_id = ? AND claimant_email = ? AND status = 'pending_review' AND changes() = 1`)
      .bind(completion.now, actorEmail, completion.note, completion.now, completion.requestId, server.id, nextEmail);
  const completionGuard = completion.kind === "transfer"
    ? `EXISTS (SELECT 1 FROM server_ownership_transfers
        WHERE id = ? AND server_id = ? AND to_email = ? AND status = 'completed' AND completed_at = ?)`
    : `EXISTS (SELECT 1 FROM server_ownership_claims
        WHERE id = ? AND server_id = ? AND claimant_email = ? AND status = 'approved' AND reviewed_at = ?)`;
  const guardValues = [completion.requestId, server.id, nextEmail, completion.now] as const;
  const auditStatements = [
    prepareAuditWrite(db, actorEmail, "ownership.credentials.rotated", "server", server.id, {
      reason: completion.kind,
      previousOwner: server.owner_email,
      nextOwner: nextEmail,
    }, { createdAt: completion.now, onlyIfPreviousStatementChanged: true }),
    ...(completion.kind === "transfer" ? [
      prepareAuditWrite(db, actorEmail, "ownership.transfer.completed", "server", server.id, {
        transferId: completion.requestId,
        fromEmail: server.owner_email,
        toEmail: nextEmail,
      }, { createdAt: completion.now, onlyIfPreviousStatementChanged: true }),
    ] : []),
    ...(completion.kind === "claim" ? [
      prepareAuditWrite(db, actorEmail, "ownership.claim.approved", "server", server.id, {
        claimId: completion.requestId,
        fromEmail: server.owner_email,
        toEmail: nextEmail,
        note: completion.note,
      }, { createdAt: completion.now, onlyIfPreviousStatementChanged: true }),
    ] : []),
  ];
  const cleanupStatements = [
    db.prepare(`DELETE FROM admin_messages WHERE server_id = ? AND ${completionGuard}`).bind(server.id, ...guardValues),
    db.prepare(`DELETE FROM admin_conversations WHERE server_id = ? AND ${completionGuard}`).bind(server.id, ...guardValues),
    db.prepare(`DELETE FROM chat_realtime_tickets WHERE server_id = ? AND ${completionGuard}`).bind(server.id, ...guardValues),
  ];
  if (server.bridge_server_id) {
    cleanupStatements.unshift(
      db.prepare(`DELETE FROM bridge_backends WHERE server_id = ? AND ${completionGuard}`).bind(server.bridge_server_id, ...guardValues),
      db.prepare(`DELETE FROM bridge_nonces WHERE server_id = ? AND ${completionGuard}`).bind(server.bridge_server_id, ...guardValues),
      db.prepare(`DELETE FROM bridge_telemetry_history WHERE server_id = ? AND ${completionGuard}`).bind(server.bridge_server_id, ...guardValues),
      db.prepare(`DELETE FROM bridge_servers WHERE server_id = ? AND ${completionGuard}`).bind(server.bridge_server_id, ...guardValues),
    );
  }
  const completionResults = await db.batch([ownerUpdate, transitionUpdate, ...auditStatements, ...cleanupStatements]);
  if (completionResults[0].meta.changes !== 1 || completionResults[1].meta.changes !== 1) {
    throw Response.json({ error: "소유권 상태가 이미 변경되었습니다. 화면을 새로고침해 다시 확인해 주세요." }, { status: 409 });
  }
}

async function assertNoOwnershipFinancialLock(db: D1Database, serverId: string) {
  await ensurePremiumAuctionSchema(db);
  if (await hasActiveFinancialLock(db, serverId)) {
    throw Response.json({ error: "진행 중인 입찰·미결제 낙찰·광고가 있어 소유권을 변경할 수 없습니다. 총관리자에게 먼저 정리를 요청해 주세요." }, { status: 409 });
  }
}

async function expireOwnershipRequests(db: D1Database) {
  const now = unixNow();
  const expired = await db.prepare(`SELECT id, server_id, from_email FROM server_ownership_transfers
    WHERE status IN ('pending_acceptance', 'pending_verification') AND
    (requested_at < ? OR challenge_expires_at IS NOT NULL AND challenge_expires_at < ?)`).bind(now - 7 * 86_400, now - 24 * 60 * 60).all<{ id: string; server_id: string; from_email: string }>();
  for (const item of expired.results) {
    await db.batch([
      db.prepare("UPDATE server_ownership_transfers SET status = 'expired', updated_at = ? WHERE id = ?").bind(now, item.id),
      db.prepare(`UPDATE directory_servers SET owner_verification_status =
        CASE WHEN owner_verified_at IS NULL THEN 'unverified' ELSE 'verified' END, updated_at = ?
        WHERE id = ? AND owner_email = ? AND owner_verification_status = 'transfer_pending'`).bind(now, item.server_id, item.from_email),
    ]);
  }
}

async function backfillVerifiedOwners(db: D1Database) {
  await db.prepare(`UPDATE directory_servers SET owner_verification_status = 'verified',
    owner_verified_at = COALESCE(owner_verified_at, (SELECT verified_at FROM bridge_servers WHERE server_id = directory_servers.bridge_server_id))
    WHERE status = 'active' AND owner_verification_status = 'unverified' AND bridge_server_id IN
    (SELECT server_id FROM bridge_servers WHERE verified_at IS NOT NULL)`).run();
}

async function restoreOwnerVerificationStatus(db: D1Database, serverId: string, ownerEmail: string, now: number) {
  await db.prepare(`UPDATE directory_servers SET owner_verification_status =
    CASE WHEN owner_verified_at IS NULL THEN 'unverified' ELSE 'verified' END, updated_at = ?
    WHERE id = ? AND owner_email = ? AND owner_verification_status = 'transfer_pending'`)
    .bind(now, serverId, ownerEmail).run();
}

async function refreshDisputeStatus(db: D1Database, serverId: string, now: number) {
  await db.prepare(`UPDATE directory_servers SET owner_verification_status =
    CASE WHEN owner_verified_at IS NULL THEN 'unverified' ELSE 'verified' END, updated_at = ?
    WHERE id = ? AND owner_verification_status = 'disputed'
      AND NOT EXISTS (SELECT 1 FROM server_ownership_claims
        WHERE server_id = ? AND status = 'pending_review')`).bind(now, serverId, serverId).run();
}

async function ownedServer(db: D1Database, serverId: string, ownerEmail: string) {
  const server = await db.prepare("SELECT * FROM directory_servers WHERE id = ? AND owner_email = ? AND deleted_at IS NULL")
    .bind(serverId, ownerEmail).first<ServerOwnerRow>();
  if (!server) throw Response.json({ error: "서버를 찾을 수 없거나 소유권이 없습니다." }, { status: 404 });
  return server;
}

async function serverById(db: D1Database, serverId: string) {
  const server = await db.prepare("SELECT * FROM directory_servers WHERE id = ? AND deleted_at IS NULL").bind(serverId).first<ServerOwnerRow>();
  if (!server) throw Response.json({ error: "서버를 찾을 수 없습니다." }, { status: 404 });
  return server;
}

async function verifyDnsClaim(address: string, token: string) {
  const name = `_minecraft-kr-verify.${address}`;
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
    headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return false;
  const body = await response.json() as { Answer?: Array<{ data?: string }> };
  return (body.Answer ?? []).some((answer) => (answer.data ?? "").replace(/^"|"$/g, "").includes(`mkr-claim=${token}`));
}

function challengeFor(method: OwnershipMethod, address: string, token: string) {
  return method === "motd"
    ? { method, marker: `[MKR-CLAIM:${token}]`, label: "서버 MOTD에 아래 문자열 추가" }
    : { method, host: `_minecraft-kr-verify.${address}`, recordType: "TXT", value: `mkr-claim=${token}`, label: "DNS TXT 레코드 추가" };
}

function serializeTransfer(row: TransferRow) {
  return { id: row.id, serverId: row.server_id, serverTitle: row.title ?? "", address: row.address ?? "", port: row.port ?? 25565, fromEmail: row.from_email, toEmail: row.to_email, status: row.status, requestedAt: row.requested_at, acceptedAt: row.accepted_at, verifiedAt: row.verified_at, completedAt: row.completed_at, updatedAt: row.updated_at };
}

function serializeClaim(row: ClaimRow, includeCurrentOwnerEmail = false) {
  return {
    id: row.id,
    serverId: row.server_id,
    serverTitle: row.title ?? "",
    address: row.address ?? "",
    port: row.port ?? 25565,
    ...(includeCurrentOwnerEmail ? { currentOwnerEmail: row.owner_email ?? "" } : {}),
    claimantEmail: row.claimant_email,
    method: row.method,
    status: row.status,
    requestedAt: row.requested_at,
    verifiedAt: row.verified_at,
    reviewedAt: row.reviewed_at,
    ...(includeCurrentOwnerEmail ? { reviewedBy: row.reviewed_by } : {}),
    reviewNote: row.review_note,
    updatedAt: row.updated_at,
  };
}

async function notify(environment: OwnershipEnvironment, to: string, subject: string, text: string, idempotencyKey: string) {
  if (environment.AUTH_LOCAL_PREVIEW === "true" && (!environment.RESEND_API_KEY || !environment.AUTH_EMAIL_FROM)) return false;
  return sendProductEmail(environment, { to, subject, text, html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px"><b>Minecraft.kr</b><h1 style="font-size:21px">${escapeHtml(subject)}</h1><p style="line-height:1.7">${escapeHtml(text)}</p><a href="https://minecraft.kr/operator">운영자센터 열기</a></div>`, idempotencyKey });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}

function ownershipToken() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 20);
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

import { createHash, createHmac, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

let baseUrl = process.env.BRIDGE_TEST_URL ?? "http://localhost:3000";
let serverId = process.env.BRIDGE_TEST_SERVER_ID ?? "";
let sharedSecret = process.env.BRIDGE_TEST_SHARED_SECRET ?? "";
let directoryServerId = "";
let directoryTitle = "";
const origin = new URL(baseUrl).origin;
const ownerHeaders = { Origin: origin, "Content-Type": "application/json", "X-MKR-Local-Owner": "minecraft-kr-local-preview" };

if (!serverId || !sharedSecret) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  directoryTitle = `Bridge security ${suffix}`;
  const create = await fetch(`${baseUrl}/api/servers`, {
    method: "POST", headers: ownerHeaders,
    body: JSON.stringify({
      title: directoryTitle, shortDescription: "브리지 서명 보안 자동 검증 서버",
      description: "서명 검증과 nonce 재전송 차단을 자동으로 검증하기 위한 임시 Minecraft 서버입니다.",
      edition: "JE", minVersion: "1.21.1", maxVersion: "1.21.8",
      address: `bridge-security-${suffix}.minecraft.kr`, port: 25565, categories: ["야생"],
    }),
  });
  if (create.status !== 201) throw new Error(`local bridge server creation failed: ${create.status} ${await create.text()}`);
  directoryServerId = (await create.json()).server.id;
  const provision = await fetch(`${baseUrl}/api/servers/${directoryServerId}/bridge`, {
    method: "POST", headers: ownerHeaders, body: JSON.stringify({ platform: "paper" }),
  });
  if (provision.status !== 201) throw new Error(`local bridge provision failed: ${provision.status} ${await provision.text()}`);
  const bridge = (await provision.json()).bridge;
  serverId = bridge.serverId;
  sharedSecret = bridge.bridgeSecret;
  const reissue = await fetch(`${baseUrl}/api/servers/${directoryServerId}/bridge`, {
    method: "POST", headers: ownerHeaders, body: JSON.stringify({ platform: "paper" }),
  });
  if (reissue.status !== 200) throw new Error(`local bridge reissue failed: ${reissue.status} ${await reissue.text()}`);
  const reissuedBridge = (await reissue.json()).bridge;
  if (!reissuedBridge.reissued || reissuedBridge.serverId !== serverId || reissuedBridge.bridgeSecret !== sharedSecret) {
    throw new Error("bridge reissue did not preserve the existing bridge connection");
  }
  if (reissuedBridge.verificationToken === bridge.verificationToken) throw new Error("bridge reissue did not rotate the MOTD token");
  const invalidOwnerVerify = await fetch(`${baseUrl}/api/servers/${directoryServerId}/bridge/verify`, {
    method: "POST", headers: ownerHeaders, body: JSON.stringify({ verificationToken: "invalid-token" }),
  });
  if (invalidOwnerVerify.status !== 400) {
    throw new Error(`owner MOTD verification did not reject an invalid token: ${invalidOwnerVerify.status} ${await invalidOwnerVerify.text()}`);
  }
  const unauthenticatedOwnerVerify = await fetch(`${baseUrl}/api/servers/${directoryServerId}/bridge/verify`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ verificationToken: reissuedBridge.verificationToken }),
  });
  if (unauthenticatedOwnerVerify.status !== 401) {
    throw new Error(`owner MOTD verification did not require owner auth: ${unauthenticatedOwnerVerify.status} ${await unauthenticatedOwnerVerify.text()}`);
  }
  const pendingConnection = await fetch(`${baseUrl}/api/servers/${directoryServerId}/bridge`, { headers: ownerHeaders });
  if (pendingConnection.status !== 200) throw new Error(`pending bridge config lookup failed: ${pendingConnection.status} ${await pendingConnection.text()}`);
  const pendingBridge = (await pendingConnection.json()).bridge;
  if (pendingBridge.serverId !== serverId || pendingBridge.bridgeSecret !== sharedSecret || pendingBridge.verified) {
    throw new Error("pending bridge config lookup returned inconsistent credentials");
  }
  const d1Directory = new URL("../.wrangler/state/v3/d1/miniflare-D1DatabaseObject", import.meta.url).pathname;
  const d1Files = (await readdir(d1Directory)).filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
  if (d1Files.length !== 1) throw new Error("local D1 database file was not unique");
  const db = new DatabaseSync(join(d1Directory, d1Files[0]));
  const now = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE bridge_servers SET verified_at = ?, last_seen_at = ? WHERE server_id = ?").run(now, now, serverId);
  db.prepare("UPDATE directory_servers SET status = 'active', owner_verification_status = 'verified', owner_verified_at = ?, updated_at = ? WHERE id = ?").run(now, now, directoryServerId);
  db.close();
  const activeConnection = await fetch(`${baseUrl}/api/servers/${directoryServerId}/bridge`, { headers: ownerHeaders });
  if (activeConnection.status !== 200) throw new Error(`active bridge config lookup failed: ${activeConnection.status} ${await activeConnection.text()}`);
  const activeBridge = (await activeConnection.json()).bridge;
  if (activeBridge.serverId !== serverId || activeBridge.bridgeSecret !== sharedSecret || !activeBridge.verified || activeBridge.verificationToken !== "") {
    throw new Error("active bridge config lookup did not return the safe post-verification config");
  }
}

try {
  const pathname = "/api/bridge/telemetry";
  const body = JSON.stringify({
    platform: "paper", totalPlayers: 0, maxPlayers: 32, averagePingMs: 0,
    software: "SecuritySmoke", version: "1", pluginVersion: "1.0.0",
    backends: [{ id: "smoke", players: 0, maxPlayers: 32, online: true, software: "SecuritySmoke", version: "1" }],
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = `${timestamp}\n${nonce}\nPOST\n${pathname}\n${bodyHash}`;
  const signature = createHmac("sha256", sharedSecret).update(canonical).digest("hex");
  const headers = {
    "Content-Type": "application/json", "X-MKR-Server-Id": serverId,
    "X-MKR-Timestamp": timestamp, "X-MKR-Nonce": nonce, "X-MKR-Signature": signature,
  };
  const accepted = await fetch(new URL(pathname, baseUrl), { method: "POST", headers, body });
  if (accepted.status !== 200) throw new Error(`valid request failed: ${accepted.status} ${await accepted.text()}`);
  const replay = await fetch(new URL(pathname, baseUrl), { method: "POST", headers, body });
  if (replay.status !== 409) throw new Error(`replay was not blocked: ${replay.status} ${await replay.text()}`);
  const badHeaders = { ...headers, "X-MKR-Nonce": randomUUID(), "X-MKR-Signature": "0".repeat(64) };
  const invalid = await fetch(new URL(pathname, baseUrl), { method: "POST", headers: badHeaders, body });
  if (invalid.status !== 401) throw new Error(`bad signature was not blocked: ${invalid.status} ${await invalid.text()}`);
  console.log(JSON.stringify({ validRequest: accepted.status, replayBlocked: replay.status, badSignatureBlocked: invalid.status }));
} finally {
  if (directoryServerId) {
    await fetch(`${baseUrl}/api/servers/${directoryServerId}`, {
      method: "DELETE", headers: ownerHeaders, body: JSON.stringify({ confirmation: directoryTitle }),
    }).catch(() => undefined);
  }
}

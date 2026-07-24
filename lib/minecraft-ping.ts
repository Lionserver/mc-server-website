import { isPrivateHostName, isPrivateOrReservedIp, normalizeIpAddress } from "@/lib/ip-security.mjs";

export interface MinecraftPingResult {
  descriptionText: string;
  playersOnline: number;
  playersMax: number;
  version: string;
  latencyMs: number;
  resolvedHost: string;
  resolvedPort: number;
  usedSrv: boolean;
}

export async function pingMinecraftServer(host: string, port: number, allowPrivate = false): Promise<MinecraftPingResult> {
  const endpoint = await resolveMinecraftEndpoint(host, port);
  const privateNetworkAllowed = allowPrivate && process.env.NODE_ENV === "development";
  const connectHost = privateNetworkAllowed ? endpoint.host : await resolvePublicHostAddress(endpoint.host);
  const { connect } = await import("cloudflare:sockets");
  const startedAt = Date.now();
  // Connect to the exact public IP returned by our trusted resolver. Resolving
  // the hostname again inside connect() would reopen a DNS-rebinding window.
  const socket = connect({ hostname: connectHost, port: endpoint.port }, { secureTransport: "off", allowHalfOpen: false });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    socket.close();
  }, 5_000);
  try {
    const handshakePayload = concat(
      encodeVarInt(0),
      encodeVarInt(769),
      encodeString(host),
      new Uint8Array([(endpoint.port >> 8) & 0xff, endpoint.port & 0xff]),
      encodeVarInt(1),
    );
    await writer.write(concat(encodeVarInt(handshakePayload.length), handshakePayload));
    await writer.write(new Uint8Array([1, 0]));
    const stream = new ByteReader(reader);
    const packetLength = await stream.readVarInt();
    if (packetLength < 2 || packetLength > 2_000_000) throw new Error("invalid Minecraft status packet length");
    const packetId = await stream.readVarInt();
    if (packetId !== 0) throw new Error("unexpected Minecraft status packet");
    const jsonLength = await stream.readVarInt();
    if (jsonLength < 2 || jsonLength > packetLength || jsonLength > 2_000_000) throw new Error("invalid Minecraft status JSON length");
    const payload = JSON.parse(new TextDecoder().decode(await stream.read(jsonLength))) as Record<string, unknown>;
    const players = payload.players as { online?: unknown; max?: unknown } | undefined;
    const version = payload.version as { name?: unknown } | undefined;
    return {
      descriptionText: flattenDescription(payload.description),
      playersOnline: Number(players?.online ?? 0),
      playersMax: Number(players?.max ?? 0),
      version: String(version?.name ?? "unknown"),
      latencyMs: Date.now() - startedAt,
      resolvedHost: endpoint.host,
      resolvedPort: endpoint.port,
      usedSrv: endpoint.usedSrv,
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    if (timedOut) {
      throw Response.json({
        error: `${endpoint.host}:${endpoint.port} 외부 연결이 5초 안에 응답하지 않았습니다. 공개 게임 포트, 방화벽·포트포워딩, DNS 주소를 확인해 주세요.`,
        code: "MINECRAFT_PING_TIMEOUT",
      }, { status: 504 });
    }
    throw Response.json({
      error: `${endpoint.host}:${endpoint.port}의 Minecraft 상태 정보를 읽지 못했습니다. 등록 주소가 실제 게임 서버로 직접 연결되는지 확인해 주세요.`,
      code: "MINECRAFT_PING_FAILED",
    }, { status: 502 });
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
    writer.releaseLock();
    socket.close();
  }
}

export interface MinecraftEndpoint {
  host: string;
  port: number;
  usedSrv: boolean;
}

export async function resolveMinecraftEndpoint(host: string, port: number): Promise<MinecraftEndpoint> {
  const fallback = { host, port, usedSrv: false };
  if (port !== 25565 || isPrivateHostName(host)) return fallback;
  try {
    const query = `_minecraft._tcp.${host.replace(/\.$/, "")}`;
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(query)}&type=SRV`, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return fallback;
    const body = await response.json() as { Answer?: Array<{ type?: number; data?: string }> };
    const records = (body.Answer ?? []).flatMap((answer) => {
      if (answer.type !== 33 || typeof answer.data !== "string") return [];
      const match = /^(\d+)\s+(\d+)\s+(\d+)\s+([^\s]+)$/.exec(answer.data.trim());
      if (!match) return [];
      const target = match[4].replace(/\.$/, "").toLowerCase();
      const targetPort = Number(match[3]);
      if (!/^(?=.{1,253}$)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(target) || targetPort < 1 || targetPort > 65535) return [];
      return [{ priority: Number(match[1]), weight: Number(match[2]), host: target, port: targetPort }];
    }).sort((left, right) => left.priority - right.priority || right.weight - left.weight);
    const selected = records[0];
    return selected ? { host: selected.host, port: selected.port, usedSrv: true } : fallback;
  } catch {
    return fallback;
  }
}

export async function resolvePublicHostAddress(host: string): Promise<string> {
  const normalizedHost = host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const literal = normalizeIpAddress(normalizedHost);
  if (literal) {
    if (isPrivateOrReservedIp(literal)) throw privateAddressResponse();
    return literal;
  }
  if (isPrivateHostName(normalizedHost)
    || !/^(?=.{1,253}$)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(normalizedHost)) {
    throw privateAddressResponse();
  }

  const resolved = new Set<string>();
  await Promise.allSettled([1, 28].map(async (recordType) => {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(normalizedHost)}&type=${recordType === 1 ? "A" : "AAAA"}`, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return;
    const body = await response.json() as { Answer?: Array<{ type?: number; data?: string }> };
    for (const answer of body.Answer ?? []) {
      if (answer.type !== recordType || typeof answer.data !== "string") continue;
      const address = normalizeIpAddress(answer.data);
      if (address) resolved.add(address);
    }
  }));

  const publicAddress = [...resolved].find((address) => !isPrivateOrReservedIp(address));
  if (publicAddress) return publicAddress;
  if (resolved.size > 0) throw privateAddressResponse();
  throw Response.json({
    error: "서버 주소의 공개 IPv4 또는 IPv6 DNS 레코드를 확인할 수 없습니다.",
    code: "MINECRAFT_DNS_UNRESOLVED",
  }, { status: 502 });
}

function flattenDescription(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenDescription).join("");
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `${typeof object.text === "string" ? object.text : ""}${flattenDescription(object.extra)}`;
  }
  return "";
}

function privateAddressResponse() {
  return Response.json({
    error: "사설·루프백·예약 네트워크 주소는 서버 인증에 사용할 수 없습니다.",
    code: "MINECRAFT_PRIVATE_ADDRESS",
  }, { status: 400 });
}

function encodeString(value: string) {
  const bytes = new TextEncoder().encode(value);
  return concat(encodeVarInt(bytes.length), bytes);
}

function encodeVarInt(input: number) {
  let value = input >>> 0;
  const bytes: number[] = [];
  do {
    let current = value & 0x7f;
    value >>>= 7;
    if (value !== 0) current |= 0x80;
    bytes.push(current);
  } while (value !== 0);
  return new Uint8Array(bytes);
}

function concat(...arrays: Uint8Array[]) {
  const output = new Uint8Array(arrays.reduce((size, item) => size + item.length, 0));
  let offset = 0;
  for (const item of arrays) {
    output.set(item, offset);
    offset += item.length;
  }
  return output;
}

class ByteReader {
  private buffered = new Uint8Array();

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async read(length: number): Promise<Uint8Array> {
    while (this.buffered.length < length) {
      const chunk = await this.reader.read();
      if (chunk.done) throw new Error("Minecraft server closed the status connection early");
      this.buffered = concat(this.buffered, chunk.value);
    }
    const result = this.buffered.slice(0, length);
    this.buffered = this.buffered.slice(length);
    return result;
  }

  async readVarInt() {
    let value = 0;
    for (let position = 0; position < 5; position++) {
      const byte = (await this.read(1))[0];
      value |= (byte & 0x7f) << (7 * position);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error("VarInt exceeds five bytes");
  }
}

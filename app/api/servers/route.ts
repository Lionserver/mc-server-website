import {
  directoryEnv, directoryErrorResponse, ownerEmailFromRequest, parseDirectoryInput,
  serializeDirectoryServer, staffProfilesByServer, type DirectoryServerRow,
} from "@/lib/server-directory";
import { assertAddressNotBlacklisted, synchronizeServerEnforcements } from "@/lib/admin-security";
import { assertSameOrigin } from "@/lib/user-auth";
import { ensurePublicDirectorySchema, publicServerList } from "@/lib/public-directory";
import { descriptionPlainText, parseDescriptionDocument } from "@/lib/server-description";
import { assertServerCreationAllowed } from "@/lib/request-guards";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const mine = url.searchParams.get("mine") === "1";
    const environment = await directoryEnv();
    await ensurePublicDirectorySchema(environment.DB);
    if (mine) {
      const ownerEmail = await ownerEmailFromRequest(request);
      await synchronizeServerEnforcements(environment.DB);
      const rows = await environment.DB.prepare(`SELECT * FROM directory_servers
        WHERE owner_email = ? AND deleted_at IS NULL ORDER BY updated_at DESC`).bind(ownerEmail).all<DirectoryServerRow>();
      const staff = await staffProfilesByServer(environment.DB, rows.results.map((row) => row.id));
      const serverIds = rows.results.map((row) => row.id);
      const activeEnforcements = serverIds.length ? await environment.DB.prepare(`SELECT id, server_id, kind, reason, starts_at, expires_at
        FROM server_enforcements WHERE status = 'active' AND server_id IN (${serverIds.map(() => "?").join(",")})
          AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC`)
        .bind(...serverIds, Math.floor(Date.now() / 1000)).all<{ id: string; server_id: string; kind: string; reason: string; starts_at: number; expires_at: number | null }>() : { results: [] };
      return Response.json({ servers: rows.results.map((row) => ({
        ...serializeDirectoryServer(row, staff.get(row.id) ?? []),
        activeEnforcements: activeEnforcements.results.filter((item) => item.server_id === row.id).map((item) => ({
          id: item.id, kind: item.kind, reason: item.reason, startsAt: item.starts_at, expiresAt: item.expires_at,
        })),
      })) });
    }
    return Response.json(await publicServerList(request), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ownerEmail = await ownerEmailFromRequest(request);
    const payload = await request.json();
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    if (typeof body.descriptionDocument === "string") return Response.json({ error: "HTML·소스 문자열은 소개 문서로 저장할 수 없습니다." }, { status: 400 });
    let descriptionDocument;
    try { descriptionDocument = parseDescriptionDocument(body.descriptionDocument, typeof body.description === "string" ? body.description : ""); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "서버 소개 문서를 확인해 주세요." }, { status: 400 }); }
    const input = parseDirectoryInput({ ...body, description: descriptionPlainText(descriptionDocument) });
    const environment = await directoryEnv();
    await ensurePublicDirectorySchema(environment.DB);
    await assertServerCreationAllowed(environment.DB, request, ownerEmail);
    const resolvedIps = await assertAddressNotBlacklisted(environment.DB, input.address);
    const duplicate = await environment.DB.prepare(`SELECT id FROM directory_servers
      WHERE lower(address) = ? AND port = ? AND deleted_at IS NULL`).bind(input.address.toLowerCase(), input.port).first();
    if (duplicate) return Response.json({ error: "this server address is already registered" }, { status: 409 });
    const id = crypto.randomUUID().replaceAll("-", "");
    const now = Math.floor(Date.now() / 1000);
    await environment.DB.prepare(`INSERT INTO directory_servers
      (id, owner_email, title, short_description, description, description_document, edition, min_version, max_version, address, port,
       categories, status, resolved_ips, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
      .bind(id, ownerEmail, input.title, input.shortDescription, input.description, JSON.stringify(descriptionDocument), input.edition, input.minVersion,
        input.maxVersion, input.address, input.port, JSON.stringify(input.categories), JSON.stringify(resolvedIps), now, now).run();
    const row = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ?").bind(id).first<DirectoryServerRow>();
    return Response.json({ server: serializeDirectoryServer(row as DirectoryServerRow), nextStep: "motd-verification" }, { status: 201 });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}

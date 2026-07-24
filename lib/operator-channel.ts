import { ensureAdminSchema } from "@/lib/admin-security";

export type OperatorChannelRow = {
  id: string;
  server_id: string;
  server_title: string;
  owner_email: string;
  body: string;
  created_at: number;
};

export type OperatorChannelMessage = {
  id: string;
  serverId: string;
  serverTitle: string;
  ownerEmail: string;
  body: string;
  createdAt: number;
};

export async function ensureOperatorChannelSchema(db: D1Database) {
  if (process.env.NODE_ENV === "production") return;
  await ensureAdminSchema(db);
}

export function serializeOperatorMessage(row: OperatorChannelRow): OperatorChannelMessage {
  return {
    id: row.id,
    serverId: row.server_id,
    serverTitle: row.server_title,
    ownerEmail: "",
    body: row.body,
    createdAt: row.created_at,
  };
}

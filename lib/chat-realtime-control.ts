export type RealtimeControlEnvironment = {
  CHAT_ROOMS?: DurableObjectNamespace;
};

export async function disconnectChatPrincipal(
  environment: RealtimeControlEnvironment,
  input: {
    role: "admin" | "owner";
    principalEmail: string;
    serverIds?: string[];
  },
) {
  if (!environment.CHAT_ROOMS) return 0;
  const serverIds = [...new Set((input.serverIds ?? []).filter((value) => /^[a-f0-9]{32}$/.test(value)))];
  const roomNames = input.role === "admin"
    ? ["global:admins"]
    : ["global:operators", ...serverIds.map((serverId) => `server:${serverId}`)];
  const results = await Promise.all([...new Set(roomNames)].map(async (roomName) => {
    const id = environment.CHAT_ROOMS?.idFromName(roomName);
    if (!id) return 0;
    const response = await environment.CHAT_ROOMS?.get(id).fetch("https://chat.internal/disconnect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MKR-Realtime-Internal": "disconnect",
      },
      body: JSON.stringify({
        role: input.role,
        principalEmail: input.principalEmail,
        serverIds,
      }),
    });
    if (!response?.ok) return 0;
    return Number((await response.json() as { disconnected?: number }).disconnected ?? 0);
  }));
  return results.reduce((total, count) => total + count, 0);
}

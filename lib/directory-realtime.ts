export type DirectoryRealtimeEnvironment = { DIRECTORY_LIVE?: DurableObjectNamespace };

export async function broadcastDirectoryUpdate(environment: DirectoryRealtimeEnvironment, serverId: string, updatedAt = Math.floor(Date.now() / 1000)) {
  if (!environment.DIRECTORY_LIVE) return false;
  const room = environment.DIRECTORY_LIVE.get(environment.DIRECTORY_LIVE.idFromName("public-directory"));
  const response = await room.fetch("https://directory.internal/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-MKR-Realtime-Internal": "broadcast" },
    body: JSON.stringify({ type: "directory.updated", serverId, updatedAt }),
  });
  return response.ok;
}

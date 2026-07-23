package kr.minecraft.bridge.common;

public record BackendSnapshot(
        String id,
        int players,
        int maxPlayers,
        boolean online,
        String software,
        String version
) {}

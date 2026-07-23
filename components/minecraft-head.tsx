"use client";

/* eslint-disable @next/next/no-img-element -- MCHeads serves exact Minecraft pixel-art avatars with a local fallback. */

import { useEffect, useState } from "react";

type MinecraftHeadProps = {
  nickname: string;
  minecraftUuid?: string | null;
  size: number;
  resolveNickname?: boolean;
};

type ResolvedState = { nickname: string; uuid: string };

export function MinecraftHead({ nickname, minecraftUuid, size, resolveNickname = true }: MinecraftHeadProps) {
  const normalized = nickname.trim();
  const validNickname = /^[A-Za-z0-9_]{3,16}$/.test(normalized);
  const suppliedUuid = minecraftUuid?.replaceAll("-", "").toLowerCase() ?? "";
  const validUuid = /^[a-f0-9]{32}$/.test(suppliedUuid);
  const [resolved, setResolved] = useState<ResolvedState | null>(null);
  const [failedIdentifier, setFailedIdentifier] = useState("");

  useEffect(() => {
    if (validUuid || !resolveNickname || !validNickname) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/minecraft/profile?nickname=${encodeURIComponent(normalized)}`, { signal: controller.signal })
        .then(async (response) => {
          const body = await response.json() as { profile?: { uuid?: string } };
          if (!response.ok || !body.profile?.uuid) throw new Error("profile lookup failed");
          setResolved({ nickname: normalized, uuid: body.profile.uuid });
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) setResolved(null);
        });
    }, 600);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalized, resolveNickname, validNickname, validUuid]);

  const resolvedUuid = resolved?.nickname.toLowerCase() === normalized.toLowerCase() ? resolved.uuid : "";
  const identifier = validUuid ? suppliedUuid : /^[a-f0-9]{32}$/.test(resolvedUuid) ? resolvedUuid : "";
  const failed = identifier !== "" && failedIdentifier === identifier;
  return <span className="minecraft-head" style={{ width: size, height: size }} aria-label={validNickname ? `${normalized} Minecraft 머리` : "Minecraft 닉네임 입력 대기"}>
    {identifier && !failed
      ? <img src={`https://mc-heads.net/avatar/${identifier}/64`} alt="" width={64} height={64} loading="lazy" onError={() => setFailedIdentifier(identifier)} />
      : <b aria-hidden="true">{normalized.slice(0, 1).toUpperCase() || "?"}</b>}
  </span>;
}

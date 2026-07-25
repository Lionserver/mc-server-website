"use client";
/* eslint-disable @next/next/no-img-element -- Minecraft skin heads are exact-size external pixel art with an error fallback. */

import { type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Activity, ArrowLeft, ArrowRightLeft, BadgeCheck, CheckCircle2, Crop, Crown, Download, ExternalLink, EyeOff, Gavel, ImageIcon, LogOut, MessageSquare, Minus, Network, PauseCircle, Pencil, Plug, Plus, RefreshCw, Save, Send, Server as ServerIcon, ShieldAlert, ShieldCheck, Timer, Trash2, TrendingUp, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImageCropEditor, prepareImageCropSession, type ImageCropSession } from "@/components/image-crop-editor";
import { ServerCategoryTags } from "@/components/server-category-tags";
import { ServerRegistrationDialog } from "@/components/server-registration-dialog";
import { ServerDescriptionEditor } from "@/components/server-description-editor";
import { MinecraftHead } from "@/components/minecraft-head";
import { useTimedMotion } from "@/components/use-timed-motion";
import { assetAccept, assetSizeLabel, assetSpecs, isMotionAssetType, motionAssetAutoFits, type AssetKind } from "@/lib/image-assets";
import { descriptionPlainText, type DescriptionDocument } from "@/lib/server-description";
import { useChatRealtime, type ChatConnectionStatus } from "@/lib/use-chat-realtime";
import type { ChatRealtimeEvent } from "@/lib/chat-realtime";
import type { OperatorChannelMessage } from "@/lib/operator-channel";

type ManagedServer = {
  id: string;
  title: string;
  shortDescription: string;
  description: string;
  descriptionDocument: DescriptionDocument;
  edition: "JE" | "BE" | "JE + BE";
  minVersion: string;
  maxVersion: string;
  address: string;
  port: number;
  categories: string[];
  status: string;
  bridgeServerId: string | null;
  ownerVerificationStatus: string;
  ownerVerifiedAt: number | null;
  discordUrl: string;
  discordEnabled: boolean;
  websiteUrl: string;
  websiteEnabled: boolean;
  kakaoUrl: string;
  kakaoEnabled: boolean;
  staffIntroEnabled: boolean;
  staff: StaffMember[];
  premiumManaged: boolean;
  premiumTier: "none" | "premium";
  premiumStartsAt: number | null;
  premiumEndsAt: number | null;
  premiumNote: string;
  premiumActive: boolean;
  activeEnforcements: Array<{ id: string; kind: "warning" | "suspension" | "blind"; reason: string; startsAt: number; expiresAt: number | null }>;
  createdAt: number;
  updatedAt: number;
};

type StaffMember = {
  id?: string;
  sortOrder?: number;
  role: string;
  nickname: string;
  minecraftUuid: string | null;
  introduction: string;
  discordEnabled: boolean;
  discordUrl: string;
};

type BridgeProvision = {
  serverId: string;
  bridgeSecret: string;
  verificationToken: string;
  expiresAt: number;
  platform: "paper" | "velocity";
  publicHost: string;
  publicPort: number;
  apiBaseUrl: string;
  reissued?: boolean;
  verified?: boolean;
};

type DirectMessage = {
  id: string;
  sender_role: "admin" | "owner";
  sender_email: string;
  body: string;
  created_at: number;
};

type OwnershipTransfer = {
  id: string; serverId: string; serverTitle: string; address: string; port: number; fromEmail: string; toEmail: string;
  status: string; requestedAt: number; acceptedAt: number | null; verifiedAt: number | null; completedAt: number | null; updatedAt: number;
};
type OwnershipClaim = {
  id: string; serverId: string; serverTitle: string; address: string; currentOwnerEmail: string; claimantEmail: string;
  method: "motd" | "dns"; status: string; requestedAt: number; verifiedAt: number | null; reviewNote: string;
};
type OwnershipSummary = { outgoing: OwnershipTransfer[]; incoming: OwnershipTransfer[]; claims: OwnershipClaim[] };
type TransferChallenge = { transferId: string; verificationToken: string; marker: string; expiresAt: number };

type AuctionDashboard = {
  auction: {
    id: string; targetStartsAt: number; targetEndsAt: number; biddingOpensAt: number; blindStartsAt: number; latestClosesAt: number; blindActive: boolean;
    slotCount: number; minimumBid: number; minimumIncrement: number; status: string; finalizedAt: number | null;
  };
  server: { id: string; title: string; status: string; ownershipVerified: boolean; identityVerified: boolean; verifiedAt: number | null; lastSeenAt: number | null };
  eligible: boolean;
  eligibilityReason: string | null;
  ownBid: { id: string; amount: number; status: string; updatedAt: number } | null;
  ownerHasOtherBid: boolean;
  cutoffAmount: number;
  suggestedBid: number;
  leaderboard: Array<{ rank: number; serverId: string; serverTitle: string; amount: number; status: string; inWinningRange: boolean; mine: boolean; updatedAt: number }>;
  awards: Array<{ id: string; amount: number; status: string; paymentConfirmedAt: number | null }>;
};

type AssetGroup = "identity" | "list" | "detail";
type AssetTransform = { focusX: number; focusY: number; zoom: number };
type AssetMetadata = AssetTransform & { contentType: string; width: number; height: number };
const defaultAssetTransform: AssetTransform = { focusX: 50, focusY: 50, zoom: 100 };

const assetLabels: Array<{ kind: AssetKind; label: string; placement: string; group: AssetGroup }> = [
  { kind: "icon", label: "서버 아이콘", placement: "목록·상세 공통", group: "identity" },
  { kind: "desktopList", label: "PC·모바일 공용 목록 배너", placement: "전체 서버 리스트", group: "list" },
  { kind: "desktopDetail", label: "PC 상세 커버", placement: "상세보기 맨 위", group: "detail" },
  { kind: "mobileDetail", label: "모바일 상세 커버", placement: "모바일 상세보기 맨 위", group: "detail" },
];

const assetGroups: Array<{ id: AssetGroup; eyebrow: string; title: string; description: string }> = [
  { id: "identity", eyebrow: "IDENTITY", title: "서버 아이콘", description: "목록과 상세에 공통으로 표시됩니다." },
  { id: "list", eyebrow: "LIST PROMOTION", title: "목록 홍보 배너", description: "468×60 한 장이 PC와 모바일 목록에 동일하게 사용됩니다." },
  { id: "detail", eyebrow: "DETAIL COVER", title: "상세 상단 커버", description: "상세보기 맨 위 전용 이미지이며 목록 배너와 별도로 교체됩니다." },
];

function ownerHeaders() {
  return {};
}

function bridgeConfigText(bridge: BridgeProvision) {
  return [
    `apiBaseUrl=${bridge.apiBaseUrl}`,
    `serverId=${bridge.serverId}`,
    `sharedSecret=${bridge.bridgeSecret}`,
    `verificationToken=${bridge.verificationToken}`,
    "telemetryIntervalSeconds=30",
    `exposeVerificationToken=${bridge.verified ? "false" : "true"}`,
    `publicHost=${bridge.publicHost}`,
    `publicPort=${bridge.publicPort}`,
  ].join("\n");
}

export default function OperatorPage() {
  const router = useRouter();
  const [servers, setServers] = useState<ManagedServer[]>([]);
  const [selected, setSelected] = useState<ManagedServer | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verificationChecking, setVerificationChecking] = useState(false);
  const [verificationSeconds, setVerificationSeconds] = useState(0);
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [platform, setPlatform] = useState<"paper" | "velocity">("paper");
  const [bridgeProvision, setBridgeProvision] = useState<BridgeProvision | null>(null);
  const [assetFiles, setAssetFiles] = useState<Partial<Record<AssetKind, File>>>({});
  const [assetContentState, setAssetContentState] = useState<{ serverId: string; assets: Partial<Record<AssetKind, AssetMetadata>> }>({ serverId: "", assets: {} });
  const [assetRevision, setAssetRevision] = useState(0);
  const [editingAsset, setEditingAsset] = useState<AssetKind | null>(null);
  const [cropSession, setCropSession] = useState<ImageCropSession | null>(null);
  const [directMessages, setDirectMessages] = useState<DirectMessage[]>([]);
  const [directBody, setDirectBody] = useState("");
  const [directLoading, setDirectLoading] = useState(false);
  const [directSending, setDirectSending] = useState(false);
  const [directOpen, setDirectOpen] = useState(false);
  const [directUnread, setDirectUnread] = useState(0);
  const [channelMessages, setChannelMessages] = useState<OperatorChannelMessage[]>([]);
  const [channelBody, setChannelBody] = useState("");
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelSending, setChannelSending] = useState(false);
  const [channelOpen, setChannelOpen] = useState(false);
  const directEndRef = useRef<HTMLDivElement | null>(null);
  const channelEndRef = useRef<HTMLDivElement | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authMode, setAuthMode] = useState("email");
  const [ownership, setOwnership] = useState<OwnershipSummary>({ outgoing: [], incoming: [], claims: [] });
  const [transferEmail, setTransferEmail] = useState("");
  const [transferChallenge, setTransferChallenge] = useState<TransferChallenge | null>(null);
  const selectedServerId = selected?.id;

  const loadOwnership = useCallback(async () => {
    const response = await fetch("/api/ownership/summary", { cache: "no-store" });
    const body = await response.json() as OwnershipSummary & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "소유권 요청을 불러오지 못했습니다.");
    setOwnership(body);
  }, []);

  const loadDirectThread = useCallback(async (quiet = false, markRead = false) => {
    if (!selectedServerId) return;
    if (!quiet) setDirectLoading(true);
    try {
      const response = await fetch(`/api/support/threads/${selectedServerId}?markRead=${markRead ? "1" : "0"}`, { headers: ownerHeaders(), cache: "no-store" });
      const body = await response.json() as { messages?: DirectMessage[]; unreadOwner?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "직통라인을 불러오지 못했습니다.");
      setDirectMessages(body.messages ?? []);
      setDirectUnread(markRead ? 0 : Math.max(0, body.unreadOwner ?? 0));
    } catch (error) {
      if (!quiet) setMessage(error instanceof Error ? error.message : "직통라인 불러오기 실패");
    } finally {
      if (!quiet) setDirectLoading(false);
    }
  }, [selectedServerId]);

  const handleDirectRealtime = useCallback((event: ChatRealtimeEvent) => {
    if (event.serverId !== selectedServerId) return;
    setDirectMessages((current) => current.some((item) => item.id === event.message.id) ? current : [...current, event.message]);
    if (event.message.sender_role === "admin" && !directOpen) setDirectUnread((current) => current + 1);
    void loadDirectThread(true, directOpen);
  }, [directOpen, loadDirectThread, selectedServerId]);

  const directConnection = useChatRealtime({
    enabled: Boolean(selectedServerId && authEmail), role: "owner", serverId: selectedServerId, onEvent: handleDirectRealtime,
  });

  const channelEligible = selected?.status === "active" && selected.ownerVerificationStatus === "verified";

  const loadOperatorChannel = useCallback(async (quiet = false) => {
    if (!selectedServerId || !channelEligible) {
      setChannelMessages([]);
      return;
    }
    if (!quiet) setChannelLoading(true);
    try {
      const response = await fetch(`/api/operator/channel?serverId=${selectedServerId}`, { cache: "no-store" });
      const body = await response.json() as { messages?: OperatorChannelMessage[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "운영자 소통채널을 불러오지 못했습니다.");
      setChannelMessages(body.messages ?? []);
    } catch (error) {
      if (!quiet) setMessage(error instanceof Error ? error.message : "운영자 소통채널 불러오기 실패");
    } finally {
      if (!quiet) setChannelLoading(false);
    }
  }, [channelEligible, selectedServerId]);

  const handleChannelRealtime = useCallback((event: ChatRealtimeEvent) => {
    const incoming: OperatorChannelMessage = {
      id: event.message.id,
      serverId: event.serverId,
      serverTitle: event.message.server_title ?? "인증 서버",
      ownerEmail: event.message.sender_email,
      body: event.message.body,
      createdAt: event.message.created_at,
    };
    setChannelMessages((current) => current.some((item) => item.id === incoming.id) ? current : [...current, incoming].slice(-300));
  }, []);

  const channelConnection = useChatRealtime({
    enabled: Boolean(selectedServerId && authEmail && channelEligible),
    role: "owner",
    serverId: selectedServerId,
    channel: "operators",
    onEvent: handleChannelRealtime,
  });

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (sessionResponse) => {
        if (!sessionResponse.ok) { if (active) { setLoading(false); setAuthChecked(true); } return; }
        const session = await sessionResponse.json() as { email: string; authMode?: string };
        if (!active) return;
        setAuthEmail(session.email);
        setAuthMode(session.authMode ?? "email");
        const [response] = await Promise.all([fetch("/api/servers?mine=1"), loadOwnership()]);
        const body = await response.json() as { servers?: ManagedServer[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "서버 목록을 불러오지 못했습니다.");
        if (!active) return;
        const next = body.servers ?? [];
        const params = new URLSearchParams(window.location.search);
        const preferredId = params.get("created");
        setServers(next); setSelected(next.find((server) => server.id === preferredId) ?? next[0] ?? null);
        if (params.get("register") === "1") {
          setRegistrationOpen(true);
          params.delete("register");
          const nextQuery = params.toString();
          window.history.replaceState(window.history.state, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`);
        }
      })
      .catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "불러오기 실패"); })
      .finally(() => { if (active) { setLoading(false); setAuthChecked(true); } });
    return () => { active = false; };
  }, [loadOwnership]);

  useEffect(() => {
    if (!selectedServerId) return;
    const timer = window.setTimeout(() => { void loadDirectThread(false, false); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDirectThread, selectedServerId]);

  useEffect(() => {
    if (!directOpen || !selectedServerId) return;
    const timer = window.setTimeout(() => { setDirectUnread(0); void loadDirectThread(true, true); }, 0);
    return () => window.clearTimeout(timer);
  }, [directOpen, loadDirectThread, selectedServerId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadOperatorChannel(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadOperatorChannel]);

  useEffect(() => {
    if (!directOpen) return;
    directEndRef.current?.scrollIntoView({ block: "end" });
  }, [directMessages, directOpen]);

  useEffect(() => {
    if (!channelOpen) return;
    channelEndRef.current?.scrollIntoView({ block: "end" });
  }, [channelMessages, channelOpen]);

  useEffect(() => {
    if (!selectedServerId) return;
    const controller = new AbortController();
    fetch(`/api/servers/${selectedServerId}/assets`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { assets?: Array<{ kind: AssetKind; contentType: string; width: number; height: number; focusX: number; focusY: number; zoom: number }> };
        if (!response.ok) throw new Error("배너 정보를 불러오지 못했습니다.");
        setAssetContentState({ serverId: selectedServerId, assets: Object.fromEntries((body.assets ?? []).map((asset) => [asset.kind, { contentType: asset.contentType, width: asset.width, height: asset.height, focusX: asset.focusX, focusY: asset.focusY, zoom: asset.zoom }])) });
      })
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setAssetContentState({ serverId: selectedServerId, assets: {} }); });
    return () => controller.abort();
  }, [assetRevision, selectedServerId]);

  useEffect(() => {
    if (!verificationChecking) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setVerificationSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [verificationChecking]);

  useEffect(() => {
    if (!saveFeedback) return;
    const timer = window.setTimeout(() => setSaveFeedback(null), 4_500);
    return () => window.clearTimeout(timer);
  }, [saveFeedback]);

  async function reload(preferredServerId?: string) {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/servers?mine=1", { headers: ownerHeaders() });
      const body = await response.json() as { servers?: ManagedServer[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "새로고침 실패");
      const next = body.servers ?? [];
      setServers(next);
      setSelected((current) => next.find((server) => server.id === preferredServerId) ?? next.find((server) => server.id === current?.id) ?? next[0] ?? null);
      setBridgeProvision(null);
      await loadOwnership();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "새로고침 실패");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    if (authMode === "sites") {
      window.location.assign("/signout-with-chatgpt?return_to=/");
      return;
    }
    const response = await fetch("/api/auth/session", { method: "DELETE" });
    if (!response.ok) { setMessage("로그아웃에 실패했습니다."); return; }
    router.replace("/login?returnTo=/operator");
  }

  async function requestTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !transferEmail.trim()) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/ownership/transfers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId: selected.id, toEmail: transferEmail }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "서버 이전 요청에 실패했습니다.");
      setTransferEmail(""); await reload();
      setMessage(`${selected.title} 서버 이전 요청을 보냈습니다.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "서버 이전 요청 실패"); }
    finally { setSaving(false); }
  }

  async function transferAction(transfer: OwnershipTransfer, action: "accept" | "challenge" | "verify" | "cancel") {
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/ownership/transfers/${transfer.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, verificationToken: action === "verify" ? transferChallenge?.verificationToken : undefined }),
      });
      const body = await response.json() as { error?: string; verificationToken?: string; marker?: string; expiresAt?: number; status?: string };
      if (!response.ok) throw new Error(body.error ?? "소유권 이전 처리에 실패했습니다.");
      if (body.verificationToken && body.marker && body.expiresAt) {
        setTransferChallenge({ transferId: transfer.id, verificationToken: body.verificationToken, marker: body.marker, expiresAt: body.expiresAt });
      } else if (body.status === "completed") {
        setTransferChallenge(null); setMessage("서버 소유권 이전과 기존 자격 증명 폐기를 완료했습니다.");
      }
      await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "소유권 이전 처리 실패"); }
    finally { setSaving(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setMessage("");
    setSaveFeedback(null);
    try {
      const response = await fetch(`/api/servers/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...ownerHeaders() },
        body: JSON.stringify(selected),
      });
      const body = await response.json() as { server?: ManagedServer; error?: string; ownershipReset?: boolean };
      if (!response.ok || !body.server) throw new Error(body.error ?? "수정 실패");
      setSelected(body.server);
      setServers((current) => current.map((server) => server.id === body.server?.id ? body.server : server));
      const savedMessage = body.ownershipReset ? "저장 완료 · 포트 변경으로 MOTD 소유권 재인증이 필요합니다." : "변경사항을 안전하게 저장했습니다.";
      setMessage(savedMessage);
      setSaveFeedback({ tone: "success", text: savedMessage });
    } catch (error) {
      const failedMessage = error instanceof Error ? error.message : "수정 실패";
      setMessage(failedMessage);
      setSaveFeedback({ tone: "error", text: failedMessage });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selected || deleteConfirmation !== selected.title) {
      setMessage("삭제하려면 서버 제목을 정확히 입력하세요.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/servers/${selected.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...ownerHeaders() },
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      });
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error ?? "삭제 실패");
      }
      const next = servers.filter((server) => server.id !== selected.id);
      setServers(next);
      setSelected(next[0] ?? null);
      setDeleteConfirmation("");
      setBridgeProvision(null);
      setMessage("서버를 삭제했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "삭제 실패");
    } finally {
      setSaving(false);
    }
  }

  async function prepareVerification() {
    if (!selected) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/servers/${selected.id}/bridge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ownerHeaders() },
        body: JSON.stringify({ platform }),
      });
      const body = await response.json() as { server?: ManagedServer; bridge?: BridgeProvision; error?: string };
      if (!response.ok || !body.server || !body.bridge) throw new Error(body.error ?? "인증 준비 실패");
      setSelected(body.server);
      setServers((current) => current.map((server) => server.id === body.server?.id ? body.server : server));
      setBridgeProvision(body.bridge);
      setMessage(body.bridge.reissued
        ? "새 MOTD 인증 문자열을 발급했습니다. 기존 브리지 연결 정보는 그대로 사용할 수 있습니다."
        : "브리지 키와 MOTD 인증 문자열을 발급했습니다. 아래 순서대로 인증을 완료해 주세요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "인증 준비 실패");
    } finally {
      setSaving(false);
    }
  }

  async function verifyOwnershipNow() {
    if (!selected || !bridgeProvision) return;
    setVerificationSeconds(0);
    setVerificationChecking(true);
    setMessage("실제 게임 서버의 MOTD를 확인하고 있습니다…");
    try {
      const response = await fetch(`/api/servers/${selected.id}/bridge/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ownerHeaders() },
        body: JSON.stringify({ verificationToken: bridgeProvision.verificationToken }),
      });
      const body = await response.json() as { verified?: boolean; error?: string; observedMotd?: string };
      if (!response.ok || !body.verified) {
        const observed = body.observedMotd ? ` 현재 확인된 MOTD: ${body.observedMotd}` : "";
        throw new Error(`${body.error ?? "MOTD 인증에 실패했습니다."}${observed}`);
      }
      await reload();
      setMessage("MOTD 소유권 인증이 완료되었습니다. 서버가 공개 목록에 반영됩니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "MOTD 인증 실패");
    } finally {
      setVerificationChecking(false);
    }
  }

  async function copyBridgeConfig() {
    if (!bridgeProvision) return;
    try {
      await navigator.clipboard.writeText(bridgeConfigText(bridgeProvision));
      setMessage("플러그인 config.properties 설정값을 클립보드에 복사했습니다.");
    } catch {
      setMessage("설정값 복사 권한을 사용할 수 없습니다. 아래 내용을 직접 복사해 주세요.");
    }
  }

  async function loadBridgeConnection() {
    if (!selected?.bridgeServerId) return;
    setBridgeLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/servers/${selected.id}/bridge`, { cache: "no-store" });
      const body = await response.json() as { bridge?: BridgeProvision; error?: string };
      if (!response.ok || !body.bridge) throw new Error(body.error ?? "브리지 연결 정보를 불러오지 못했습니다.");
      setBridgeProvision(body.bridge);
      setMessage("이 서버의 플러그인 연결 설정을 불러왔습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "브리지 연결 정보 불러오기 실패");
    } finally {
      setBridgeLoading(false);
    }
  }

  async function sendDirectMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !directBody.trim()) return;
    setDirectSending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/support/threads/${selected.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ownerHeaders() },
        body: JSON.stringify({ body: directBody }),
      });
      const body = await response.json() as { message?: DirectMessage; error?: string };
      if (!response.ok || !body.message) throw new Error(body.error ?? "메시지 전송에 실패했습니다.");
      setDirectMessages((current) => current.some((item) => item.id === body.message?.id) ? current : [...current, body.message as DirectMessage]);
      setDirectBody("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "메시지 전송 실패");
    } finally {
      setDirectSending(false);
    }
  }

  async function sendChannelMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !channelEligible || !channelBody.trim()) return;
    setChannelSending(true);
    try {
      const response = await fetch("/api/operator/channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId: selected.id, body: channelBody }),
      });
      const body = await response.json() as { message?: OperatorChannelMessage; error?: string };
      if (!response.ok || !body.message) throw new Error(body.error ?? "메시지 전송에 실패했습니다.");
      setChannelMessages((current) => current.some((item) => item.id === body.message?.id) ? current : [...current, body.message as OperatorChannelMessage].slice(-300));
      setChannelBody("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "운영자 소통채널 메시지 전송 실패");
    } finally {
      setChannelSending(false);
    }
  }

  async function chooseAsset(kind: AssetKind, file?: File) {
    if (!file) return;
    const spec = assetSpecs[kind];
    try {
      const session = await prepareImageCropSession(kind, file);
      if (isMotionAssetType(file.type)) {
        URL.revokeObjectURL(session.sourceUrl);
        if (!motionAssetAutoFits(kind) && (session.sourceWidth !== spec.width || session.sourceHeight !== spec.height)) {
          setMessage(`${file.type === "video/webm" ? "WebM" : "GIF"}는 움직임 보존을 위해 ${spec.width}×${spec.height} 완성 규격으로 올려 주세요.`);
          return;
        }
        if (file.size > spec.maxBytes) {
          setMessage(`${assetLabels.find((asset) => asset.kind === kind)?.label} ${file.type === "video/webm" ? "WebM" : "GIF"}은 최대 ${assetSizeLabel(kind)}입니다.`);
          return;
        }
        setAssetFiles((current) => ({ ...current, [kind]: file }));
        setMessage(`${assetLabels.find((asset) => asset.kind === kind)?.label} ${file.type === "video/webm" ? "WebM" : "GIF"}${motionAssetAutoFits(kind) ? "를 화면 규격에 자동 맞춤합니다." : " 교체 파일을 확인했습니다."}`);
        return;
      }
      if (cropSession) URL.revokeObjectURL(cropSession.sourceUrl);
      setCropSession(session);
      setMessage(`${assetLabels.find((asset) => asset.kind === kind)?.label}에 사용할 영역을 조정하세요.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이미지를 읽을 수 없습니다.");
    }
  }

  function closeCrop() {
    if (cropSession) URL.revokeObjectURL(cropSession.sourceUrl);
    setCropSession(null);
  }

  function applyCrop(file: File) {
    if (!cropSession) return;
    const kind = cropSession.kind;
    setAssetFiles((current) => ({ ...current, [kind]: file }));
    setMessage(`${assetLabels.find((asset) => asset.kind === kind)?.label} 크롭 결과를 저장 대기 목록에 추가했습니다.`);
    closeCrop();
  }

  async function persistAssets(entries: Array<[AssetKind, File]>) {
    if (!selected) return;
    if (entries.length === 0) {
      setMessage("교체할 아이콘 또는 배너를 하나 이상 선택하세요.");
      return false;
    }
    setSaving(true);
    setMessage("");
    try {
      const uploaded: AssetKind[] = [];
      for (const [kind, file] of entries) {
        const form = new FormData();
        form.append(kind, file);
        const response = await fetch(`/api/servers/${selected.id}/assets`, { method: "POST", headers: ownerHeaders(), body: form });
        const body = await response.json() as { uploaded?: Array<{ kind: AssetKind }>; error?: string };
        if (!response.ok || !body.uploaded) throw new Error(body.error ?? `${kind} 이미지 교체 실패`);
        uploaded.push(...body.uploaded.map((asset) => asset.kind));
      }
      setAssetFiles((current) => {
        const next = { ...current };
        uploaded.forEach((kind) => delete next[kind]);
        return next;
      });
      setAssetRevision(Date.now());
      setMessage(`아이콘·배너 ${uploaded.length}개를 교체했습니다.`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이미지 교체 실패");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function editCurrentAsset(kind: AssetKind) {
    if (!selected) return;
    try {
      const pending = assetFiles[kind];
      let file = pending;
      if (!file) {
        const response = await fetch(`/api/servers/${selected.id}/assets/${kind}?v=${assetRevision}`, { cache: "no-store" });
        if (!response.ok) throw new Error("현재 등록된 이미지가 없습니다. 새 이미지를 선택해 주세요.");
        const blob = await response.blob();
        const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : blob.type === "image/jpeg" ? "jpg" : blob.type === "image/gif" ? "gif" : "webm";
        file = new File([blob], `current-${kind}.${extension}`, { type: blob.type });
      }
      if (isMotionAssetType(file.type)) {
        setMessage("GIF·WebM은 움직임 보존을 위해 크롭하지 않습니다. 편집 모드에서 교체하면 표시 영역에 자동 맞춤됩니다.");
        return;
      }
      const session = await prepareImageCropSession(kind, file);
      if (cropSession) URL.revokeObjectURL(cropSession.sourceUrl);
      setCropSession(session);
      setMessage(`${assetLabels.find((asset) => asset.kind === kind)?.label} 현재 이미지를 크롭 편집합니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "현재 이미지를 편집할 수 없습니다.");
    }
  }

  async function saveEditingAsset(transform: AssetTransform) {
    if (!editingAsset) return;
    const file = assetFiles[editingAsset];
    const currentMetadata = assetContentState.serverId === selected?.id ? assetContentState.assets[editingAsset] : undefined;
    const motion = isMotionAssetType(file?.type ?? currentMetadata?.contentType ?? "");
    if (!file && !motion) {
      setMessage("편집 모드에서 새 이미지를 선택하거나 현재 이미지를 크롭해 주세요.");
      return;
    }
    if (file && !(await persistAssets([[editingAsset, file]]))) return;
    if (!motion) {
      setEditingAsset(null);
      return;
    }
    if (!selected) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/servers/${selected.id}/assets`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...ownerHeaders() },
        body: JSON.stringify({ kind: editingAsset, ...transform }),
      });
      const body = await response.json() as { asset?: AssetTransform & { kind: AssetKind }; error?: string };
      if (!response.ok || !body.asset) throw new Error(body.error ?? "움직임 크롭 저장 실패");
      const contentType = file?.type ?? currentMetadata?.contentType ?? "";
      const width = currentMetadata?.width ?? assetSpecs[editingAsset].width;
      const height = currentMetadata?.height ?? assetSpecs[editingAsset].height;
      setAssetContentState((current) => ({ ...current, assets: { ...current.assets, [editingAsset]: { contentType, width, height, focusX: body.asset!.focusX, focusY: body.asset!.focusY, zoom: body.asset!.zoom } } }));
      setAssetRevision(Date.now());
      setMessage("움직임의 표시 위치와 확대값을 저장했습니다.");
      setEditingAsset(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "움직임 크롭 저장 실패");
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof ManagedServer>(key: K, value: ManagedServer[K]) {
    setSaveFeedback(null);
    setSelected((current) => current ? { ...current, [key]: value } : current);
  }

  function setStaffIntroEnabled(enabled: boolean) {
    setSaveFeedback(null);
    setSelected((current) => current ? {
      ...current,
      staffIntroEnabled: enabled,
      staff: enabled && current.staff.length === 0
        ? [{ role: "총관리자", nickname: "", minecraftUuid: null, introduction: "", discordEnabled: false, discordUrl: "" }]
        : current.staff,
    } : current);
  }

  function setAddressCase(value: string) {
    if (!selected || value.toLowerCase() !== selected.address.toLowerCase()) return;
    update("address", value);
  }

  function toggleAddressCharacter(index: number) {
    if (!selected) return;
    const characters = [...selected.address];
    const character = characters[index];
    if (!/[a-z]/i.test(character)) return;
    characters[index] = character === character.toUpperCase() ? character.toLowerCase() : character.toUpperCase();
    setAddressCase(characters.join(""));
  }

  function capitalizeAddress(value: string) {
    const lower = value.toLowerCase();
    const index = lower.search(/[a-z]/i);
    return index < 0 ? lower : `${lower.slice(0, index)}${lower[index].toUpperCase()}${lower.slice(index + 1)}`;
  }

  function updateStaff<K extends keyof Pick<StaffMember, "role" | "nickname" | "introduction" | "discordEnabled" | "discordUrl">>(index: number, key: K, value: StaffMember[K]) {
    setSaveFeedback(null);
    setSelected((current) => current ? {
      ...current,
      staff: current.staff.map((member, memberIndex) => memberIndex === index
        ? { ...member, [key]: value, ...(key === "nickname" ? { minecraftUuid: null } : {}) }
        : member),
    } : current);
  }

  function addStaff() {
    setSaveFeedback(null);
    setSelected((current) => current && current.staff.length < 12
      ? { ...current, staff: [...current.staff, { role: "운영자", nickname: "", minecraftUuid: null, introduction: "", discordEnabled: false, discordUrl: "" }] }
      : current);
  }

  function removeStaff(index: number) {
    setSaveFeedback(null);
    setSelected((current) => current ? { ...current, staff: current.staff.filter((_, memberIndex) => memberIndex !== index) } : current);
  }

  if (!authChecked) return <main className="operator-page"><div className="operator-auth-state">이메일 계정을 확인하는 중…</div></main>;
  if (!authEmail) return <main className="operator-page"><section className="operator-auth-state"><ShieldCheck size={28} /><h1>운영자 로그인이 필요합니다</h1><p>서버 등록·관리·양도와 소유권 주장 상태는 이메일 계정에 안전하게 연결됩니다.</p><Link href="/login?returnTo=/operator">이메일로 로그인</Link></section></main>;

  return <><main className="operator-page">
    <header className="operator-header"><div><Link href="/"><ArrowLeft size={15} /> 서버 목록</Link><span>OWNER CONSOLE</span><h1>서버 운영자 센터</h1><p>등록한 서버의 제목, 상세 설명, 버전과 접속 주소 표시를 관리합니다.</p></div><div className="operator-account-actions"><span className="operator-session"><ShieldCheck size={16} /><span><small>OWNER SESSION</small><b>{authEmail}</b></span></span><button className={`operator-tool-button refresh${loading ? " loading" : ""}`} type="button" onClick={() => void reload()} disabled={loading}><RefreshCw size={15} /> {loading ? "갱신 중" : "새로고침"}</button><button className="operator-tool-button logout" type="button" onClick={logout}><LogOut size={15} /> 로그아웃</button></div></header>

    {message && <div className="operator-message" role="status">{message}</div>}

    <section className="operator-chat-launchers" aria-label="운영자 대화 도구">
      <button type="button" disabled={!selected} onClick={() => setDirectOpen(true)}>
        <span className="operator-chat-launcher-icon"><MessageSquare size={19} /></span>
        <span><small>ADMIN DIRECT LINE</small><b>웹 총관리자 직통라인</b><em>{selected ? `${selected.title} · 1대1 문의` : "관리할 서버를 선택하세요"}</em></span>
        <span className="operator-chat-launcher-status"><RealtimeBadge status={directConnection} />{directUnread > 0 && <span className="operator-chat-new" aria-label={`새 총관리자 메시지 ${directUnread}개`}>NEW{directUnread > 1 ? ` ${directUnread}` : ""}</span>}<strong>{directMessages.length}</strong></span>
      </button>
      <button type="button" disabled={!selected || !channelEligible} onClick={() => setChannelOpen(true)}>
        <span className="operator-chat-launcher-icon community"><Network size={19} /></span>
        <span><small>VERIFIED OPERATORS</small><b>서버 운영자 소통채널</b><em>{selected ? channelEligible ? `${selected.title} 이름으로 참여` : "소유권 인증 완료 후 참여 가능" : "관리할 서버를 선택하세요"}</em></span>
        <span className="operator-chat-launcher-status"><RealtimeBadge status={channelConnection} /><strong>{channelMessages.length}</strong></span>
      </button>
    </section>

    <BridgeGuidePanel server={selected} bridge={bridgeProvision} busy={bridgeLoading} onLoad={loadBridgeConnection} onCopy={copyBridgeConfig} />

    <IncomingOwnershipPanel incoming={ownership.incoming} claims={ownership.claims} challenge={transferChallenge} busy={saving} onAction={transferAction} />

    <div className="operator-layout">
      <aside className="owned-server-list"><div className="owned-list-head"><div><span>MY SERVERS</span><b>{servers.length}개</b></div><button type="button" onClick={() => setRegistrationOpen(true)}>+ 새 서버 등록</button></div>
        {loading ? <p className="operator-empty">불러오는 중…</p> : servers.length === 0 ? <p className="operator-empty">등록된 서버가 없습니다.</p> : servers.map((server) => <button key={server.id} type="button" className={selected?.id === server.id ? "active" : ""} onClick={() => { setSelected(server); setDeleteConfirmation(""); setBridgeProvision(null); setAssetFiles({}); setEditingAsset(null); setAssetRevision(Date.now()); setMessage(""); setSaveFeedback(null); }}><span className="owned-server-icon" style={{ backgroundImage: `url(/api/servers/${server.id}/assets/icon?v=${assetRevision}),linear-gradient(135deg,var(--accent),var(--ink))` }} /><span><b>{server.title}</b><small>{server.address}:{server.port}</small></span><i data-status={server.status}>{server.status === "active" ? server.activeEnforcements?.some((item) => item.kind === "warning") ? "경고 적용" : "운영 중" : server.status === "draft" ? "인증 대기" : server.status === "pending_verification" ? "인증 중" : server.status === "suspended" ? "임시 차단" : server.status === "blinded" ? "블라인드" : server.status}</i></button>)}</aside>

      <section className="operator-editor">
        {!selected ? <div className="operator-no-selection"><ServerIcon size={26} /><h2>관리할 서버가 없습니다</h2><p>서버를 등록하면 이곳에서 정보를 수정하고 삭제할 수 있습니다.</p><button type="button" onClick={() => setRegistrationOpen(true)}>서버 등록하기</button></div> : <>
          <div className="editor-title"><div><span>SERVER SETTINGS</span><h2>{selected.title}</h2><p>마지막 수정 {new Date(selected.updatedAt * 1000).toLocaleString("ko-KR")}</p></div><div className={`server-state state-${selected.status}`}><CheckCircle2 size={15} /><span>{selected.status === "active" ? "소유권 인증 완료" : selected.status === "suspended" ? "운영 정책 임시 차단" : selected.status === "blinded" ? "공개 목록 블라인드" : selected.status === "pending_verification" ? "MOTD 인증 진행 중" : "MOTD 소유권 인증 대기"}</span></div></div>
          {selected.activeEnforcements?.length > 0 && <section className="operator-enforcement-notices" aria-label="서버 운영 제재 알림">{selected.activeEnforcements.map((entry) => <article key={entry.id} className={entry.kind}>{entry.kind === "warning" ? <ShieldAlert size={19} /> : entry.kind === "suspension" ? <PauseCircle size={19} /> : <EyeOff size={19} />}<div><span>{entry.kind === "warning" ? "SERVER WARNING" : entry.kind === "suspension" ? "TEMPORARY SUSPENSION" : "VISIBILITY BLIND"}</span><b>{entry.kind === "warning" ? "서버 경고가 적용되었습니다." : entry.kind === "suspension" ? "서버가 임시 차단되었습니다." : "서버가 공개 목록에서 블라인드 처리되었습니다."}</b><p>{entry.reason}</p><small>{entry.expiresAt ? `${new Date(entry.expiresAt * 1000).toLocaleString("ko-KR")} 자동 해제` : "총관리자 수동 해제까지 적용"}</small></div></article>)}</section>}
          {["draft", "pending_verification"].includes(selected.status) && <section className="verification-panel"><div><span>OWNERSHIP VERIFICATION</span><h3>플러그인·MOTD 소유권 인증</h3><p>{selected.bridgeServerId ? "이전에 발급한 화면을 닫았어도 새 인증 문자열을 다시 발급할 수 있습니다." : "인증 문자열 발급 후 서버 MOTD에 적용하고 직접 확인 버튼을 눌러 완료합니다."}</p></div>{!bridgeProvision ? <div className="verification-start"><select aria-label="인증할 서버 플랫폼" value={platform} onChange={(event) => setPlatform(event.target.value as "paper" | "velocity")}><option value="paper">Paper / Bukkit / Folia</option><option value="velocity">Velocity Proxy</option></select><button type="button" disabled={saving} onClick={prepareVerification}>{saving ? "발급 중…" : selected.bridgeServerId ? "인증 정보 다시 발급" : "인증 시작"}</button></div> : <><ol className="verification-steps" aria-label="MOTD 인증 순서"><li className="done"><b>01</b><span>인증 문자열 발급</span></li><li className="current"><b>02</b><span>MOTD 적용·서버 재시작</span></li><li><b>03</b><span>지금 인증하기</span></li></ol><div className="verification-credentials"><label><span>MOTD에 그대로 추가</span><code>[MKR-VERIFY:{bridgeProvision.verificationToken}]</code></label><label><span>Server ID</span><code>{bridgeProvision.serverId}</code></label><label><span>Bridge Secret · 플러그인 설정값</span><code>{bridgeProvision.bridgeSecret}</code></label><small>{new Date(bridgeProvision.expiresAt * 1000).toLocaleString("ko-KR")}까지 유효 · {bridgeProvision.platform} · 만료되면 인증 정보를 다시 발급하세요.</small></div><details className="bridge-config"><summary>플러그인 config.properties 설정 보기</summary><pre>{bridgeConfigText(bridgeProvision)}</pre><button type="button" onClick={copyBridgeConfig}>설정 전체 복사</button></details><div className="verification-network-check"><Network size={16} /><p><strong>{selected.address}:{selected.port}</strong>의 Minecraft SRV 레코드가 있으면 실제 대상 서버를 자동으로 따라갑니다. SRV 없이 Cloudflare 주황색 프록시만 사용하면 25565 확인이 막힐 수 있습니다.</p></div><div className="verification-action"><div><b>MOTD 적용을 마쳤나요?</b><p>MOTD 변경만으로 자동 인증되지 않습니다. 아래 버튼을 누르면 공개 게임 포트 응답을 5초 동안 기다립니다.</p></div><button type="button" disabled={verificationChecking || saving} onClick={verifyOwnershipNow}><ShieldCheck size={15} /> {verificationChecking ? `외부 연결 확인 중 · ${verificationSeconds}초` : "지금 인증하기"}</button></div></>}</section>}
          <PremiumRegistrationStatus server={selected} />
          <OwnershipTransferPanel server={selected} outgoing={ownership.outgoing.filter((item) => item.serverId === selected.id)} email={transferEmail} busy={saving} onEmail={setTransferEmail} onSubmit={requestTransfer} onCancel={(transfer) => transferAction(transfer, "cancel")} />
          <PremiumAuctionPanel key={selected.id} serverId={selected.id} onMessage={setMessage} />
          <form className="server-edit-form" onSubmit={save}>
            <fieldset><legend>기본 정보</legend><div className="operator-form-grid"><label><span>서버 제목</span><input value={selected.title} minLength={2} maxLength={60} required onChange={(event) => update("title", event.target.value)} /></label><label><span>목록 한 줄 소개</span><input value={selected.shortDescription} minLength={2} maxLength={80} required onChange={(event) => update("shortDescription", event.target.value)} /></label></div></fieldset>
            <ServerDescriptionEditor key={selected.id} serverId={selected.id} document={selected.descriptionDocument} disabled={saving} onMessage={setMessage} onChange={(document) => setSelected((current) => current ? { ...current, descriptionDocument: document, description: descriptionPlainText(document) } : current)} />

            <fieldset className="staff-editor"><legend>운영자 소개</legend><div className="staff-editor-head"><div><b>상세보기에 운영진 소개 표시</b><p>닉네임을 입력하면 Minecraft 스킨 머리가 자동으로 표시됩니다.</p><em className={selected.staffIntroEnabled && selected.staff.length > 0 ? "staff-publish-state ready" : "staff-publish-state"}>{selected.staffIntroEnabled && selected.staff.length > 0 ? "입력 후 ‘변경사항 저장’을 누르면 상세보기에 공개됩니다." : "ON으로 켜면 운영진 1명 입력란이 자동으로 준비됩니다."}</em></div><label className="staff-toggle"><input type="checkbox" checked={selected.staffIntroEnabled} onChange={(event) => setStaffIntroEnabled(event.target.checked)} /><span>{selected.staffIntroEnabled ? "ON" : "OFF"}</span></label></div>
              {selected.staffIntroEnabled && <><div className="staff-editor-list">{selected.staff.map((member, index) => <article key={member.id ?? index} className="staff-editor-card"><MinecraftHead nickname={member.nickname} minecraftUuid={member.minecraftUuid} size={64} /><div className="staff-editor-fields"><label><span>직급</span><input value={member.role} minLength={1} maxLength={30} placeholder="총관리자" required onChange={(event) => updateStaff(index, "role", event.target.value)} /></label><label><span>닉네임</span><input value={member.nickname} minLength={3} maxLength={16} pattern="[A-Za-z0-9_]{3,16}" placeholder="Steve" required onChange={(event) => updateStaff(index, "nickname", event.target.value)} /></label><label className="staff-introduction-field"><span>소개</span><input value={member.introduction} minLength={1} maxLength={160} placeholder="서버 운영과 콘텐츠 기획을 담당합니다." required onChange={(event) => updateStaff(index, "introduction", event.target.value)} /></label><div className="staff-discord-editor"><div><b>개인 Discord 연락처</b><small>사용자명·아이디·초대 링크 중 편한 형식으로 입력하세요.</small></div><label className="staff-toggle compact"><input type="checkbox" checked={member.discordEnabled} onChange={(event) => updateStaff(index, "discordEnabled", event.target.checked)} /><span>{member.discordEnabled ? "ON" : "OFF"}</span></label>{member.discordEnabled && <label className="staff-discord-link"><span>Discord 아이디 또는 링크</span><input type="text" value={member.discordUrl} minLength={1} maxLength={100} placeholder="username 또는 https://discord.gg/..." required onChange={(event) => updateStaff(index, "discordUrl", event.target.value)} /></label>}</div></div><button type="button" className="staff-remove" onClick={() => removeStaff(index)} aria-label={`${member.nickname || index + 1} 운영진 제거`}><Minus size={15} /></button></article>)}</div><button type="button" className="staff-add" onClick={addStaff} disabled={selected.staff.length >= 12}><Plus size={15} /> 운영진 추가 <small>{selected.staff.length}/12</small></button></>}
            </fieldset>

            <fieldset><legend>접속 정보와 버전</legend><div className="operator-form-grid three"><label><span>에디션</span><select value={selected.edition} onChange={(event) => update("edition", event.target.value as ManagedServer["edition"])}><option value="JE">Java Edition</option><option value="BE">Bedrock Edition</option><option value="JE + BE">Java + Bedrock</option></select></label><label><span>최소 버전</span><input value={selected.minVersion} maxLength={24} required onChange={(event) => update("minVersion", event.target.value)} /></label><label><span>최대 버전</span><input value={selected.maxVersion} maxLength={24} required onChange={(event) => update("maxVersion", event.target.value)} /></label></div><div className="operator-form-grid address"><div className="address-case-editor"><div className="address-case-label"><span>서버 주소 · 문자 고정</span><em><ShieldCheck size={12} /> 대소문자만 변경</em></div><div className="address-case-characters" role="group" aria-label={`${selected.address} 주소 대소문자 편집`}>{[...selected.address].map((character, index) => /[a-z]/i.test(character) ? <button key={`${index}-${character}`} type="button" onClick={() => toggleAddressCharacter(index)} aria-label={`${index + 1}번째 ${character} 대소문자 전환`}>{character}</button> : <i key={`${index}-${character}`}>{character}</i>)}</div><div className="address-case-presets"><span>빠른 스타일</span><button type="button" onClick={() => setAddressCase(selected.address.toLowerCase())}>minecraft.kr</button><button type="button" onClick={() => setAddressCase(capitalizeAddress(selected.address))}>Minecraft.kr</button><button type="button" onClick={() => setAddressCase(selected.address.toUpperCase())}>MINECRAFT.KR</button></div><small>알파벳을 직접 눌러 원하는 글자만 대문자·소문자로 바꿀 수 있습니다. 도메인 자체는 변경되지 않습니다.</small></div><label><span>포트</span><input type="number" min={1} max={65535} value={selected.port} required onChange={(event) => update("port", Number(event.target.value))} /></label></div><ServerCategoryTags value={selected.categories} onChange={(categories) => update("categories", categories)} disabled={saving} idPrefix={`operator-${selected.id}`} /><p className="address-warning">서버 주소는 도메인 변경 없이 표시 대소문자만 바꿀 수 있습니다. 포트를 변경하면 브리지 연결 해제와 MOTD 소유권 재인증이 필요합니다.</p></fieldset>

            <fieldset className="server-links-editor"><legend>서버 공식 링크</legend><p className="field-help">공개할 채널만 켜세요. OFF 상태의 링크는 상세보기에서 완전히 숨겨집니다.</p><div className="server-link-grid"><ServerLinkEditor label="Discord 커뮤니티" description="서버 공식 Discord 초대방" enabled={selected.discordEnabled} url={selected.discordUrl} placeholder="https://discord.gg/..." onEnabled={(value) => update("discordEnabled", value)} onUrl={(value) => update("discordUrl", value)} /><ServerLinkEditor label="서버 전용 사이트" description="공식 홈페이지·위키·상점" enabled={selected.websiteEnabled} url={selected.websiteUrl} placeholder="https://example.kr" onEnabled={(value) => update("websiteEnabled", value)} onUrl={(value) => update("websiteUrl", value)} /><ServerLinkEditor label="카카오톡" description="오픈채팅·공식 문의방" enabled={selected.kakaoEnabled} url={selected.kakaoUrl} placeholder="https://open.kakao.com/o/..." onEnabled={(value) => update("kakaoEnabled", value)} onUrl={(value) => update("kakaoUrl", value)} /></div></fieldset>

            <div className="editor-actions"><span className={saveFeedback ? `save-result ${saveFeedback.tone}` : "save-result"}>{saveFeedback?.tone === "success" ? "저장 완료" : saveFeedback?.tone === "error" ? "저장 실패 · 내용을 확인하세요" : "수정 후 저장 버튼을 눌러 적용"}</span><a href={`/api/servers/${selected.id}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> API 확인</a><button type="submit" disabled={saving}><Save size={15} /> {saving ? "저장 중…" : saveFeedback?.tone === "success" ? "저장 완료" : "변경사항 저장"}</button></div>
          </form>

          <section className="asset-editor">
            <div className="asset-editor-head"><div><span>VISUAL ASSETS</span><h3>아이콘·배너 교체</h3><p>정적 이미지는 위치·확대를 조정해 자동 크롭합니다. 상세 커버 GIF·WebM은 움직임을 보존하며 PC·모바일 표시 영역에 자동 맞춤합니다.</p></div><ImageIcon size={20} /></div>
            <div key={`${selected.id}-${assetRevision}`}>
              <div className="asset-edit-groups">
                {assetGroups.map((group) => <section className={`asset-edit-group ${group.id}`} key={group.id} aria-labelledby={`asset-group-${group.id}`}>
                  <div className="asset-edit-group-head"><span>{group.eyebrow}</span><div><b id={`asset-group-${group.id}`}>{group.title}</b><p>{group.description}</p></div></div>
                  <div className={`asset-edit-grid ${group.id}`}>
                    {assetLabels.filter((asset) => asset.group === group.id).map(({ kind, label, placement }) => {
                      const spec = assetSpecs[kind];
                      const selectedFile = assetFiles[kind];
                      const metadata = assetContentState.serverId === selected.id ? assetContentState.assets[kind] : undefined;
                      return <article key={kind} className={selectedFile ? `asset-edit-card selected ${kind}` : `asset-edit-card ${kind}`}>
                        <button type="button" className="asset-edit-open" onClick={() => setEditingAsset(kind)} aria-label={`${label} 편집 모드 열기`}>
                          <AssetCurrentPreview serverId={selected.id} kind={kind} revision={assetRevision} file={selectedFile} contentType={metadata?.contentType} transform={metadata} />
                          <span className="asset-edit-copy"><b>{label}</b><small>{placement} · {spec.width}×{spec.height}{spec.animated ? ` · GIF·WebM 가능 · 최대 ${assetSizeLabel(kind)}` : ""}</small><em>{selectedFile ? selectedFile.name : motionAssetAutoFits(kind) ? "정지 이미지 크롭 · 움직이는 커버 자동 맞춤" : "기존 이미지 또는 편집 버튼을 눌러 편집"}</em></span>
                          <span className="asset-edit-cta"><Pencil size={13} /> 편집</span>
                        </button>
                      </article>;
                    })}
                  </div>
                </section>)}
              </div>
              <p className="asset-editor-mode-hint"><Pencil size={13} /> 기존 이미지나 편집 버튼을 눌러 전용 편집 모드에서 개별 저장하세요.</p>
            </div>
          </section>

          <section className="danger-zone"><div><span>DANGER ZONE</span><h3>서버 삭제</h3><p>즉시 숨김 처리되어 7일 복구함에 보관됩니다. 복구가 필요하면 관리자에게 요청하세요.</p></div><label><span>확인을 위해 <b>{selected.title}</b> 입력</span><input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={selected.title} /></label><button type="button" disabled={saving || deleteConfirmation !== selected.title} onClick={remove}><Trash2 size={15} /> 서버 삭제</button></section>
        </>}
      </section>
    </div>
  </main>
  <Dialog.Root open={directOpen} onOpenChange={setDirectOpen}>
    <Dialog.Portal>
      <Dialog.Overlay className="operator-chat-overlay" />
      <Dialog.Content className="operator-chat-dialog" aria-describedby="direct-chat-description">
        <div className="owner-direct-line in-dialog">
          <div className="owner-direct-head"><div><span>ADMIN DIRECT LINE</span><Dialog.Title><MessageSquare size={18} /> 웹 총관리자 직통라인</Dialog.Title><Dialog.Description id="direct-chat-description">서버 심사, 광고, 운영 정책을 Minecraft.kr 총관리자와 1대1로 대화합니다.</Dialog.Description></div><div className="owner-direct-meta"><RealtimeBadge status={directConnection} /><b>{selected?.title ?? "서버 미선택"}</b><Dialog.Close aria-label="직통라인 닫기"><X size={18} /></Dialog.Close></div></div>
          <div className="owner-direct-messages">{directLoading ? <p>대화를 불러오는 중…</p> : directMessages.length === 0 ? <p>아직 대화가 없습니다. 문의 내용을 남기면 총관리자 센터에 바로 전달됩니다.</p> : directMessages.map((item) => <article key={item.id} className={item.sender_role === "owner" ? "mine" : "admin-reply"}><span>{item.sender_role === "owner" ? selected?.title ?? "내 서버" : "Minecraft.kr 총관리자"}</span><div>{item.body}</div><time>{new Date(item.created_at * 1000).toLocaleString("ko-KR")}</time></article>)}<div ref={directEndRef} /></div>
          <form onSubmit={sendDirectMessage}><textarea value={directBody} onChange={(event) => setDirectBody(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} maxLength={2000} placeholder="문의 내용을 입력하세요 · Enter 전송 · Shift+Enter 줄바꿈" aria-label="총관리자에게 보낼 메시지" /><button type="submit" disabled={directSending || !directBody.trim()}><Send size={15} /> {directSending ? "전송 중" : "전송"}</button></form>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
  <Dialog.Root open={channelOpen} onOpenChange={setChannelOpen}>
    <Dialog.Portal>
      <Dialog.Overlay className="operator-chat-overlay" />
      <Dialog.Content className="operator-chat-dialog operator-community-dialog" aria-describedby="operator-channel-description">
        <div className="owner-direct-line operator-community-chat in-dialog">
          <div className="owner-direct-head"><div><span>VERIFIED OPERATORS CHANNEL</span><Dialog.Title><Network size={18} /> 서버 운영자 소통채널</Dialog.Title><Dialog.Description id="operator-channel-description">소유권 인증을 마친 서버 운영자들이 서버 이름으로 대화하는 실시간 공용 채널입니다.</Dialog.Description></div><div className="owner-direct-meta"><RealtimeBadge status={channelConnection} /><b>{selected?.title ?? "서버 미선택"}로 참여</b><Dialog.Close aria-label="운영자 소통채널 닫기"><X size={18} /></Dialog.Close></div></div>
          <div className="operator-channel-notice"><ShieldCheck size={15} /><span>닉네임은 직접 수정할 수 없으며, 현재 선택한 인증 서버의 제목으로 자동 표시됩니다.</span></div>
          <div className="owner-direct-messages operator-channel-messages">{channelLoading ? <p>운영자 대화를 불러오는 중…</p> : channelMessages.length === 0 ? <p>첫 대화를 남겨 운영자 소통채널을 시작해 보세요.</p> : channelMessages.map((item) => <article key={item.id} className={item.serverId === selected?.id ? "mine" : "operator-peer"}><span><ServerIcon size={11} /> {item.serverTitle}</span><div>{item.body}</div><time>{new Date(item.createdAt * 1000).toLocaleString("ko-KR")}</time></article>)}<div ref={channelEndRef} /></div>
          <form onSubmit={sendChannelMessage}><textarea value={channelBody} onChange={(event) => setChannelBody(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} maxLength={2000} placeholder={`${selected?.title ?? "선택한 서버"} 이름으로 입력 · Enter 전송 · Shift+Enter 줄바꿈`} aria-label="운영자 소통채널에 보낼 메시지" /><button type="submit" disabled={channelSending || !channelEligible || !channelBody.trim()}><Send size={15} /> {channelSending ? "전송 중" : "전송"}</button></form>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
  <ServerRegistrationDialog open={registrationOpen} onOpenChange={setRegistrationOpen} loginReturnTo="/operator?register=1" onMessage={setMessage} onCreated={async (serverId) => { await reload(serverId); setMessage("새 서버를 등록했습니다. 아래에서 MOTD 소유권 인증을 계속해 주세요."); }} />
  {selected && editingAsset && <AssetEditDialog serverId={selected.id} kind={editingAsset} revision={assetRevision} file={assetFiles[editingAsset]} metadata={assetContentState.serverId === selected.id ? assetContentState.assets[editingAsset] : undefined} saving={saving} onClose={() => { setAssetFiles((current) => { const next = { ...current }; delete next[editingAsset]; return next; }); setEditingAsset(null); }} onChoose={chooseAsset} onCropCurrent={editCurrentAsset} onSave={saveEditingAsset} />}
  {saveFeedback && <div className={`operator-save-toast ${saveFeedback.tone}`} role={saveFeedback.tone === "error" ? "alert" : "status"} aria-live="polite"><CheckCircle2 size={18} /><div><b>{saveFeedback.tone === "success" ? "변경사항 저장 완료" : "저장하지 못했습니다"}</b><span>{saveFeedback.text}</span></div></div>}
  {cropSession && <ImageCropEditor session={cropSession} onCancel={closeCrop} onApply={applyCrop} onError={setMessage} />}
  </>;
}

function AssetCurrentPreview({ serverId, kind, revision, file, contentType, transform = defaultAssetTransform }: {
  serverId: string;
  kind: AssetKind;
  revision: number;
  file?: File;
  contentType?: string;
  transform?: AssetTransform;
}) {
  const spec = assetSpecs[kind];
  const localUrl = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);
  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);
  const sourceUrl = localUrl ?? `/api/servers/${serverId}/assets/${kind}?v=${revision}`;
  const sourceType = file?.type ?? contentType;
  const webm = sourceType === "video/webm";
  const gif = sourceType === "image/gif";
  const motionActive = useTimedMotion(webm || gif ? sourceUrl : null);
  const assetLabel = assetLabels.find((asset) => asset.kind === kind)?.label ?? "서버 이미지";
  const motionStyle = { objectPosition: `${transform.focusX}% ${transform.focusY}%`, transform: `scale(${transform.zoom / 100})`, transformOrigin: `${transform.focusX}% ${transform.focusY}%` } as CSSProperties;
  return <span className="asset-current" style={{ aspectRatio: `${spec.width}/${spec.height}`, backgroundImage: webm || gif ? "linear-gradient(125deg,var(--accent),var(--ink))" : `url(${sourceUrl}),linear-gradient(125deg,var(--accent),var(--ink))` }}>
    {motionActive && webm && <video className="motion-media" src={sourceUrl} style={motionStyle} autoPlay loop muted playsInline preload="metadata" aria-label={`${assetLabel} WebM 미리보기`} />}
    {motionActive && gif && <img className="motion-media" src={sourceUrl} style={motionStyle} alt={`${assetLabel} GIF 미리보기`} />}
    {!motionActive && (webm || gif) && <span className="motion-preview-stopped">움직임 미리보기 정지</span>}
    <i>{file ? "교체 준비" : "현재 이미지 · 미등록 시 기본 비주얼"}</i>
  </span>;
}

function MotionCropWorkspace({ serverId, kind, revision, file, metadata, transform, onChange }: {
  serverId: string;
  kind: AssetKind;
  revision: number;
  file?: File;
  metadata?: AssetMetadata;
  transform: AssetTransform;
  onChange: (transform: AssetTransform) => void;
}) {
  const spec = assetSpecs[kind];
  const localUrl = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);
  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);
  const sourceUrl = localUrl ?? `/api/servers/${serverId}/assets/${kind}?v=${revision}`;
  const sourceType = file?.type ?? metadata?.contentType ?? "";
  const motionActive = useTimedMotion(isMotionAssetType(sourceType) ? sourceUrl : null);
  const assetLabel = assetLabels.find((asset) => asset.kind === kind)?.label ?? "서버 이미지";
  const [sourceSize, setSourceSize] = useState({ width: metadata?.width ?? spec.width, height: metadata?.height ?? spec.height });
  const sourceRatio = Math.max(0.01, sourceSize.width / sourceSize.height);
  const targetRatio = spec.width / spec.height;
  const maxCropWidth = Math.min(100, (targetRatio / sourceRatio) * 100);
  const maxCropHeight = Math.min(100, (sourceRatio / targetRatio) * 100);
  const cropWidth = maxCropWidth * (100 / transform.zoom);
  const cropHeight = maxCropHeight * (100 / transform.zoom);
  const frameCenterX = cropWidth / 2 + ((100 - cropWidth) * transform.focusX) / 100;
  const frameCenterY = cropHeight / 2 + ((100 - cropHeight) * transform.focusY) / 100;
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<null | { mode: "move" | "resize"; x: number; y: number; focusX: number; focusY: number; zoom: number; cropWidth: number; cropHeight: number; horizontal?: -1 | 1; vertical?: -1 | 1 }>(null);

  function alignmentFromCenter(center: number, size: number) {
    const travel = 100 - size;
    if (travel <= 0.001) return 50;
    return Math.round(Math.max(0, Math.min(100, ((center - size / 2) / travel) * 100)));
  }

  function updateZoom(nextZoom: number, centerX = frameCenterX, centerY = frameCenterY) {
    const zoom = Math.max(100, Math.min(300, Math.round(nextZoom)));
    const nextWidth = maxCropWidth * (100 / zoom);
    const nextHeight = maxCropHeight * (100 / zoom);
    onChange({
      zoom,
      focusX: alignmentFromCenter(Math.max(nextWidth / 2, Math.min(100 - nextWidth / 2, centerX)), nextWidth),
      focusY: alignmentFromCenter(Math.max(nextHeight / 2, Math.min(100 - nextHeight / 2, centerY)), nextHeight),
    });
  }

  function startMove(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { mode: "move", x: event.clientX, y: event.clientY, focusX: frameCenterX, focusY: frameCenterY, zoom: transform.zoom, cropWidth, cropHeight };
  }

  function moveFrame(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragRef.current;
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!start || start.mode !== "move" || !bounds) return;
    const nextX = start.focusX + ((event.clientX - start.x) / bounds.width) * 100;
    const nextY = start.focusY + ((event.clientY - start.y) / bounds.height) * 100;
    const centerX = Math.max(cropWidth / 2, Math.min(100 - cropWidth / 2, nextX));
    const centerY = Math.max(cropHeight / 2, Math.min(100 - cropHeight / 2, nextY));
    onChange({ zoom: start.zoom, focusX: alignmentFromCenter(centerX, cropWidth), focusY: alignmentFromCenter(centerY, cropHeight) });
  }

  function startResize(event: ReactPointerEvent<HTMLButtonElement>, horizontal: -1 | 1, vertical: -1 | 1) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { mode: "resize", x: event.clientX, y: event.clientY, focusX: frameCenterX, focusY: frameCenterY, zoom: transform.zoom, cropWidth, cropHeight, horizontal, vertical };
  }

  function resizeFrame(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = dragRef.current;
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!start || start.mode !== "resize" || !bounds || !start.horizontal || !start.vertical) return;
    const horizontalGrowth = (start.horizontal * (event.clientX - start.x) * 2) / Math.max(1, bounds.width * start.cropWidth / 100);
    const verticalGrowth = (start.vertical * (event.clientY - start.y) * 2) / Math.max(1, bounds.height * start.cropHeight / 100);
    const scale = Math.max(0.05, 1 + Math.max(horizontalGrowth, verticalGrowth));
    const nextWidth = Math.max(maxCropWidth / 3, Math.min(maxCropWidth, start.cropWidth * scale));
    updateZoom((maxCropWidth / nextWidth) * 100, start.focusX, start.focusY);
  }

  const stopPointer = () => { dragRef.current = null; };
  return <div className="motion-crop-workspace">
    <section className="motion-source-panel">
      <div className="motion-workspace-heading"><div><span>원본 영역 선택</span><b>{sourceSize.width} × {sourceSize.height}</b></div><small>박스 안을 이동 · 모서리를 드래그해 크기 조절</small></div>
      <div ref={stageRef} className="motion-source-canvas" style={{ "--source-ratio": sourceRatio, aspectRatio: `${sourceSize.width}/${sourceSize.height}` } as CSSProperties}>
        {sourceType === "video/webm"
          ? motionActive ? <video className="motion-media" src={sourceUrl} autoPlay loop muted playsInline preload="metadata" aria-label={`${assetLabel} WebM 원본`} onLoadedMetadata={(event) => setSourceSize({ width: event.currentTarget.videoWidth || spec.width, height: event.currentTarget.videoHeight || spec.height })} /> : <span className="motion-preview-stopped">움직임 미리보기 정지</span>
          : motionActive ? <img className="motion-media" src={sourceUrl} alt={`${assetLabel} GIF 원본`} onLoad={(event) => setSourceSize({ width: event.currentTarget.naturalWidth || spec.width, height: event.currentTarget.naturalHeight || spec.height })} /> : <span className="motion-preview-stopped">움직임 미리보기 정지</span>}
        <div className="motion-crop-frame" style={{ left: `${frameCenterX - cropWidth / 2}%`, top: `${frameCenterY - cropHeight / 2}%`, width: `${cropWidth}%`, height: `${cropHeight}%` }} onPointerDown={startMove} onPointerMove={moveFrame} onPointerUp={stopPointer} onPointerCancel={stopPointer}>
          <span>{spec.width}:{spec.height} 출력 영역</span>
          <button type="button" className="corner-tl" aria-label="왼쪽 위 모서리로 크롭 크기 조절" onPointerDown={(event) => startResize(event, -1, -1)} onPointerMove={resizeFrame} onPointerUp={stopPointer} onPointerCancel={stopPointer} />
          <button type="button" className="corner-tr" aria-label="오른쪽 위 모서리로 크롭 크기 조절" onPointerDown={(event) => startResize(event, 1, -1)} onPointerMove={resizeFrame} onPointerUp={stopPointer} onPointerCancel={stopPointer} />
          <button type="button" className="corner-bl" aria-label="왼쪽 아래 모서리로 크롭 크기 조절" onPointerDown={(event) => startResize(event, -1, 1)} onPointerMove={resizeFrame} onPointerUp={stopPointer} onPointerCancel={stopPointer} />
          <button type="button" className="corner-br" aria-label="오른쪽 아래 모서리로 크롭 크기 조절" onPointerDown={(event) => startResize(event, 1, 1)} onPointerMove={resizeFrame} onPointerUp={stopPointer} onPointerCancel={stopPointer} />
        </div>
      </div>
    </section>
    <aside className="motion-result-panel">
      <div className="motion-workspace-heading"><div><span>실시간 결과 미리보기</span><b>{spec.width} × {spec.height}</b></div><small>움직임은 5초 뒤 자동 정지</small></div>
      <div className="motion-result-preview" style={{ aspectRatio: `${spec.width}/${spec.height}` }}><AssetCurrentPreview serverId={serverId} kind={kind} revision={revision} file={file} contentType={metadata?.contentType} transform={transform} /></div>
      <div className="motion-crop-controls">
        <label><span>표시 확대 <b>{transform.zoom}%</b></span><input type="range" min="100" max="300" step="1" value={transform.zoom} onChange={(event) => updateZoom(Number(event.target.value))} aria-label="움직임 이미지 확대" /></label>
        <div><button type="button" disabled={transform.zoom <= 100} onClick={() => updateZoom(transform.zoom - 10)}>− 축소</button><button type="button" disabled={transform.zoom >= 300} onClick={() => updateZoom(transform.zoom + 10)}>+ 확대</button></div>
        <button type="button" className="motion-crop-reset" onClick={() => onChange({ focusX: 50, focusY: 50, zoom: 100 })}>전체 영역에 맞춤</button>
      </div>
      <dl className="motion-crop-values"><div><dt>가로 중심</dt><dd>{Math.round(frameCenterX)}%</dd></div><div><dt>세로 중심</dt><dd>{Math.round(frameCenterY)}%</dd></div><div><dt>선택 크기</dt><dd>{Math.round(cropWidth)} × {Math.round(cropHeight)}%</dd></div></dl>
    </aside>
  </div>;
}

function AssetEditDialog({ serverId, kind, revision, file, metadata, saving, onClose, onChoose, onCropCurrent, onSave }: {
  serverId: string;
  kind: AssetKind;
  revision: number;
  file?: File;
  metadata?: AssetMetadata;
  saving: boolean;
  onClose: () => void;
  onChoose: (kind: AssetKind, file?: File) => Promise<void>;
  onCropCurrent: (kind: AssetKind) => Promise<void>;
  onSave: (transform: AssetTransform) => Promise<void>;
}) {
  const spec = assetSpecs[kind];
  const item = assetLabels.find((asset) => asset.kind === kind);
  const sourceType = file?.type ?? metadata?.contentType ?? "";
  const motion = isMotionAssetType(sourceType);
  const hasSource = Boolean(file || metadata);
  const [focusX, setFocusX] = useState(metadata?.focusX ?? defaultAssetTransform.focusX);
  const [focusY, setFocusY] = useState(metadata?.focusY ?? defaultAssetTransform.focusY);
  const [zoom, setZoom] = useState(metadata?.zoom ?? defaultAssetTransform.zoom);
  const transform = { focusX, focusY, zoom };
  const format = sourceType === "image/gif" ? "GIF" : sourceType === "video/webm" ? "WebM" : sourceType === "image/png" ? "PNG" : sourceType === "image/webp" ? "WebP" : sourceType === "image/jpeg" ? "JPG" : "기본 이미지";
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="asset-edit-modal-backdrop" />
      <Dialog.Content className="asset-edit-modal" aria-modal="true" aria-labelledby="asset-edit-title" onPointerDownOutside={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}>
        <header><div><span>IMAGE EDIT MODE</span><Dialog.Title id="asset-edit-title">{item?.label ?? kind} 편집</Dialog.Title><Dialog.Description>기존 이미지를 확인한 뒤 원하는 영역을 맞추거나 새 파일로 교체하세요.</Dialog.Description></div><Dialog.Close asChild><button type="button" disabled={saving} aria-label="이미지 편집 닫기"><X size={17} /></button></Dialog.Close></header>
        <div className="asset-edit-modal-body">
          {motion
            ? <MotionCropWorkspace serverId={serverId} kind={kind} revision={revision} file={file} metadata={metadata} transform={transform} onChange={(next) => { setFocusX(next.focusX); setFocusY(next.focusY); setZoom(next.zoom); }} />
            : <div className={`asset-edit-stage ${kind}`}><AssetCurrentPreview serverId={serverId} kind={kind} revision={revision} file={file} contentType={metadata?.contentType} transform={transform} /></div>}
          <div className="asset-edit-info"><div><span>출력 규격</span><b>{spec.width} × {spec.height}</b></div><div><span>현재 형식</span><b>{format}</b></div><div><span>용량 한도</span><b>{assetSizeLabel(kind)}</b></div></div>
          <div className={`asset-edit-motion-note${motion ? " motion" : ""}`}><ImageIcon size={16} /><p>{motion ? "원본 위 사각형을 이동하고 네 모서리를 늘리거나 줄이세요. 오른쪽 결과 미리보기에서 움직임과 실제 출력 영역을 바로 확인할 수 있습니다." : "PNG·JPG·WebP는 현재 이미지 또는 새 이미지를 크롭 편집할 수 있습니다."}</p></div>
          <div className="asset-edit-mode-actions">
            <button type="button" disabled={!hasSource || motion || saving} onClick={() => void onCropCurrent(kind)}><Crop size={15} /> {!hasSource ? "현재 이미지 없음" : motion ? "움직임은 위에서 크롭" : "현재 이미지 크롭 편집"}</button>
            <label className="asset-edit-file-button"><ImageIcon size={15} /> {file ? "다른 이미지 선택" : "새 이미지 선택"}<input type="file" accept={assetAccept(kind)} onChange={(event) => { const next = event.target.files?.[0]; event.target.value = ""; void onChoose(kind, next); }} /></label>
          </div>
        </div>
        <footer><button type="button" disabled={saving} onClick={onClose}>취소</button><button type="button" className="primary" disabled={(!file && !motion) || saving} onClick={() => void onSave(transform)}><Save size={15} /> {saving ? "이미지 저장 중…" : motion ? "움직임 크롭 저장" : file ? "이 이미지로 저장" : "변경 이미지를 선택하세요"}</button></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function ServerLinkEditor({ label, description, enabled, url, placeholder, onEnabled, onUrl }: {
  label: string;
  description: string;
  enabled: boolean;
  url: string;
  placeholder: string;
  onEnabled: (value: boolean) => void;
  onUrl: (value: string) => void;
}) {
  return <article className={`server-link-card${enabled ? " enabled" : ""}`}><div className="server-link-head"><div><b>{label}</b><small>{description}</small></div><label className="staff-toggle compact"><input type="checkbox" checked={enabled} onChange={(event) => onEnabled(event.target.checked)} /><span>{enabled ? "ON" : "OFF"}</span></label></div>{enabled ? <label><span>공개 링크</span><input type="url" value={url} placeholder={placeholder} required onChange={(event) => onUrl(event.target.value)} /></label> : <p>상세보기에서 숨김 상태입니다.</p>}</article>;
}

function BridgeGuidePanel({ server, bridge, busy, onLoad, onCopy }: {
  server: ManagedServer | null;
  bridge: BridgeProvision | null;
  busy: boolean;
  onLoad: () => Promise<void>;
  onCopy: () => Promise<void>;
}) {
  return <section className="bridge-guide" aria-labelledby="bridge-guide-title">
    <header><div className="bridge-guide-mark"><Plug size={20} /></div><div><span>MINECRAFT.KR BRIDGE</span><h2 id="bridge-guide-title">서버와 홈페이지를 실시간으로 연결하세요</h2><p>MOTD 소유권 확인 뒤 접속자·버전·상태를 서명된 HTTPS 요청으로 전송합니다. 게임 포트를 새로 개방하거나 원격 명령 권한을 제공하지 않습니다.</p></div><b>v1.0.1 · JAVA 21+</b></header>
    <div className="bridge-role-grid">
      <article><ShieldCheck size={17} /><div><b>소유권 인증</b><p>발급된 토큰을 서버 목록 MOTD에 노출해 실제 운영 서버임을 확인합니다.</p></div></article>
      <article><Activity size={17} /><div><b>실시간 상태</b><p>30초마다 현재·최대 접속자, 서버 버전, 구현체와 응답 상태를 전송합니다.</p></div></article>
      <article><Network size={17} /><div><b>프록시 통합</b><p>Velocity는 프록시 전체 인원과 등록된 백엔드별 접속 가능 여부를 한 번에 집계합니다.</p></div></article>
    </div>
    <div className="bridge-downloads">
      <a href="/downloads/minecraft-kr-paper-bridge-1.0.1.jar" download><Download size={17} /><span><b>Paper · Bukkit · Folia</b><small>단일 서버용 JAR 다운로드</small></span></a>
      <a href="/downloads/minecraft-kr-velocity-bridge-1.0.1.jar" download><Download size={17} /><span><b>Velocity Proxy</b><small>프록시·백엔드 통합 JAR 다운로드</small></span></a>
      <a className="checksum" href="/downloads/SHA256SUMS" download><ShieldCheck size={15} /> SHA-256 무결성 값</a>
    </div>
    {server && <div className="bridge-current-server"><div><span>SELECTED SERVER</span><b>{server.title}</b><small>{server.address}:{server.port} · {server.status === "active" ? "소유권 인증 완료" : "인증 전"}</small></div>{server.bridgeServerId ? <button type="button" disabled={busy} onClick={() => void onLoad()}>{busy ? "설정 불러오는 중…" : bridge?.serverId === server.bridgeServerId ? "연결 설정 새로고침" : "이 서버 연결 설정 열기"}</button> : <p>아래 서버 설정의 소유권 인증에서 먼저 인증 정보를 발급하세요.</p>}{bridge?.serverId === server.bridgeServerId && <details className="bridge-current-config" open><summary>{bridge.verified ? "인증 완료 서버용 config.properties" : "인증 진행용 config.properties"}</summary><pre>{bridgeConfigText(bridge)}</pre><button type="button" onClick={() => void onCopy()}>설정 전체 복사</button><small>{bridge.verified ? "이미 인증된 서버이므로 verificationToken은 비워 두고 exposeVerificationToken=false로 사용합니다." : "인증 완료 전까지 verificationToken과 exposeVerificationToken=true를 유지하세요."}</small></details>}</div>}
    <details open><summary>설치·연결 순서 자세히 보기</summary><div className="bridge-install-grid"><ol><li><b>1. 알맞은 JAR 선택</b><span>단일 서버와 Folia는 Paper용, 프록시 전체를 집계하려면 Velocity용을 받습니다.</span></li><li><b>2. plugins 폴더에 설치</b><span>JAR을 넣고 서버를 한 번 실행해 <code>config.properties</code>를 생성합니다.</span></li><li><b>3. 운영자센터에서 인증 시작</b><span>Server ID, Bridge Secret, 인증 토큰을 발급한 뒤 설정 전체 복사로 파일에 붙여 넣습니다.</span></li><li><b>4. 재시작 후 인증</b><span>웹의 지금 인증하기 또는 콘솔의 <code>/mkrbridge verify</code>를 실행합니다.</span></li></ol><aside><b>플러그인 없이도 소유권 인증 가능</b><p>서버 MOTD에 발급 문자열을 직접 넣고 웹에서 지금 인증하기를 누르면 됩니다. 플러그인은 이후 실시간 접속자·상태 데이터를 자동 연동할 때 필요합니다.</p><strong>localhost 주의</strong><p>게임 서버가 다른 PC·호스팅에 있으면 그 서버에서 <code>localhost:3000</code>은 이 홈페이지가 아닙니다. 운영 도메인 또는 게임 서버가 접근 가능한 홈페이지 주소를 API 주소로 사용하세요.</p></aside></div></details>
  </section>;
}

function RealtimeBadge({ status }: { status: ChatConnectionStatus }) {
  const label = status === "live" ? "실시간 연결" : status === "connecting" || status === "reconnecting" ? "재연결 중" : "연결 대기";
  return <span className={`chat-realtime-badge status-${status}`}><i />{label}</span>;
}

function IncomingOwnershipPanel({ incoming, claims, challenge, busy, onAction }: {
  incoming: OwnershipTransfer[]; claims: OwnershipClaim[]; challenge: TransferChallenge | null; busy: boolean;
  onAction: (transfer: OwnershipTransfer, action: "accept" | "challenge" | "verify" | "cancel") => Promise<void>;
}) {
  const actionable = incoming.filter((item) => ["pending_acceptance", "pending_verification"].includes(item.status));
  const activeClaims = claims.filter((item) => ["pending_verification", "pending_review"].includes(item.status));
  if (actionable.length === 0 && activeClaims.length === 0) return null;
  return <section className="ownership-inbox">
    <header><div><span>OWNERSHIP INBOX</span><h2><ArrowRightLeft size={18} /> 소유권 요청함</h2></div><b>{actionable.length + activeClaims.length}건 진행 중</b></header>
    <div className="ownership-inbox-list">
      {actionable.map((transfer) => {
        const currentChallenge = challenge?.transferId === transfer.id ? challenge : null;
        return <article key={transfer.id}><div><b>{transfer.serverTitle}</b><span>{transfer.fromEmail} → {transfer.toEmail}</span><small>{transfer.address}:{transfer.port}</small></div><OwnershipStatus status={transfer.status} />
          {transfer.status === "pending_acceptance" ? <div className="ownership-actions"><button disabled={busy} onClick={() => void onAction(transfer, "accept")}>이전 수락·인증 시작</button><button disabled={busy} onClick={() => void onAction(transfer, "cancel")}>거절</button></div> : <div className="ownership-challenge"><p>MOTD에 인증 문자열을 추가한 뒤 확인하세요.</p>{currentChallenge ? <><code>{currentChallenge.marker}</code><small>{new Date(currentChallenge.expiresAt * 1000).toLocaleString("ko-KR")}까지 유효</small><div className="ownership-actions"><button disabled={busy} onClick={() => void onAction(transfer, "verify")}>MOTD 확인·이전 완료</button><button disabled={busy} onClick={() => void onAction(transfer, "challenge")}>문자열 재발급</button></div></> : <button disabled={busy} onClick={() => void onAction(transfer, "challenge")}>인증 문자열 다시 표시</button>}</div>}
        </article>;
      })}
      {activeClaims.map((claim) => <article key={claim.id}><div><b>{claim.serverTitle} 주장 요청</b><span>{claim.method === "motd" ? "MOTD" : "DNS TXT"} 인증</span><small>{claim.status === "pending_review" ? "총관리자 승인 대기 중" : "기술 인증 대기 중"}</small></div><OwnershipStatus status={claim.status} /></article>)}
    </div>
  </section>;
}

function OwnershipTransferPanel({ server, outgoing, email, busy, onEmail, onSubmit, onCancel }: {
  server: ManagedServer; outgoing: OwnershipTransfer[]; email: string; busy: boolean;
  onEmail: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCancel: (transfer: OwnershipTransfer) => Promise<void>;
}) {
  const active = outgoing.find((item) => ["pending_acceptance", "pending_verification"].includes(item.status));
  return <section className="ownership-transfer-panel">
    <header><div><span>SERVER OWNERSHIP</span><h3><ArrowRightLeft size={17} /> 서버 관리 양도하기</h3><p>새 운영자의 이메일 계정 수락과 실제 서버 MOTD 재인증이 모두 끝나야 이전됩니다.</p></div><OwnershipStatus status={server.ownerVerificationStatus} /></header>
    {active ? <div className="ownership-active-transfer"><div><b>{active.toEmail}</b><span>{active.status === "pending_acceptance" ? "새 운영자 수락 대기" : "새 운영자 MOTD 인증 대기"}</span></div><button type="button" disabled={busy} onClick={() => void onCancel(active)}>이전 취소</button></div> : <form onSubmit={(event) => void onSubmit(event)}><label><span>이전받을 운영자 이메일</span><input type="email" value={email} onChange={(event) => onEmail(event.target.value)} placeholder="new-owner@example.com" required /></label><button disabled={busy || !email.trim()}>{busy ? "처리 중…" : "이메일 이전 신청"}</button></form>}
    <small>진행 중인 경매·미결제 낙찰·광고·소유권 분쟁이 있으면 이전이 자동 차단됩니다.</small>
  </section>;
}

function OwnershipStatus({ status }: { status: string }) {
  const labels: Record<string, string> = {
    verified: "소유자 인증 완료", unverified: "소유자 미인증", verifying: "서버 인증 중", transfer_pending: "이전 진행 중",
    disputed: "소유권 분쟁", pending_acceptance: "수락 대기", pending_verification: "기술 인증 대기", pending_review: "총관리자 심사",
    completed: "이전 완료", approved: "승인", rejected: "거절", cancelled: "취소", expired: "만료",
  };
  return <span className={`ownership-status status-${status}`}>{labels[status] ?? status}</span>;
}

function PremiumRegistrationStatus({ server }: { server: ManagedServer }) {
  const [renderedAt] = useState(() => Date.now() / 1_000);
  if (server.premiumTier !== "premium") return null;
  const expired = Boolean(server.premiumEndsAt && server.premiumEndsAt <= renderedAt);
  const scheduled = Boolean(server.premiumStartsAt && server.premiumStartsAt > renderedAt);
  const state = server.premiumActive ? "active" : scheduled ? "scheduled" : expired ? "expired" : "pending";
  const title = state === "active" ? "프리미엄 서버 등록 중" : state === "scheduled" ? "프리미엄 서버 노출 예약" : state === "expired" ? "프리미엄 등록 기간 종료" : "프리미엄 등록 확인 중";
  const period = state === "active"
    ? server.premiumEndsAt ? `${fullDate(server.premiumEndsAt)}까지 등록 중` : "종료일 없이 등록 중"
    : state === "scheduled"
      ? `${server.premiumStartsAt ? fullDate(server.premiumStartsAt) : "시작일 확인 중"}부터 ${server.premiumEndsAt ? fullDate(server.premiumEndsAt) : "종료일 미정"}까지`
      : server.premiumEndsAt ? `${fullDate(server.premiumEndsAt)} 종료` : "광고 상태를 확인해 주세요.";
  return <section className={`owner-premium-registration state-${state}`} aria-label="프리미엄 서버 등록 상태">
    <Crown size={21} /><div><span>PREMIUM PLACEMENT</span><b>{title}</b><strong>{period}</strong>{server.premiumNote && <small>{server.premiumNote}</small>}</div>
  </section>;
}

function PremiumAuctionPanel({ serverId, onMessage }: { serverId: string; onMessage: (message: string) => void }) {
  const [data, setData] = useState<AuctionDashboard | null>(null);
  const [amount, setAmount] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bidding, setBidding] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const loadInFlight = useRef(false);

  const load = useCallback(async (quiet = false) => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/premium/auction?serverId=${serverId}`, { headers: ownerHeaders(), cache: "no-store" });
      const body = await response.json() as AuctionDashboard & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "프리미엄 경매를 불러오지 못했습니다.");
      setData(body);
      setAmount((current) => current || String(body.suggestedBid));
    } catch (error) {
      if (!quiet) onMessage(error instanceof Error ? error.message : "프리미엄 경매 불러오기 실패");
    } finally {
      loadInFlight.current = false;
      if (!quiet) setLoading(false);
    }
  }, [onMessage, serverId]);

  const blindStartsAt = (data?.auction.blindStartsAt ?? 0) * 1_000;
  const blindActive = Boolean(data && data.auction.status === "open" && (data.auction.blindActive || clock >= blindStartsAt));
  const refreshInterval = blindActive ? 1_000 : 5_000;

  useEffect(() => {
    let active = true;
    const initial = window.setTimeout(() => { if (active) void load(); }, 0);
    const refreshVisible = () => { if (active && document.visibilityState === "visible") void load(true); };
    document.addEventListener("visibilitychange", refreshVisible);
    return () => { active = false; window.clearTimeout(initial); document.removeEventListener("visibilitychange", refreshVisible); };
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, refreshInterval);
    return () => window.clearInterval(timer);
  }, [load, refreshInterval]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    setBidding(true);
    try {
      const response = await fetch("/api/premium/auction", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ownerHeaders() },
        body: JSON.stringify({ auctionId: data.auction.id, serverId, amount: Number(amount), acceptedTerms }),
      });
      const body = await response.json() as AuctionDashboard & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "입찰에 실패했습니다.");
      setData(body);
      setAmount(String((body.ownBid?.amount ?? Number(amount)) + body.auction.minimumIncrement));
      setAcceptedTerms(false);
      onMessage("프리미엄 경매 입찰가를 등록했습니다. 입찰 마감 전까지 인상만 가능합니다.");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "입찰 실패");
    } finally {
      setBidding(false);
    }
  }

  if (loading) return <section className="premium-auction owner-auction-loading">다음 주 프리미엄 경매를 불러오는 중…</section>;
  if (!data) return null;
  const auctionOpen = data.auction.status === "open";
  const ownRank = data.leaderboard.find((item) => item.mine)?.rank;
  const winning = Boolean(ownRank && ownRank <= data.auction.slotCount);
  const award = data.awards[0];
  const remainingSeconds = Math.max(0, Math.floor(data.auction.blindStartsAt - clock / 1000));
  const minimumAmount = data.ownBid ? data.ownBid.amount + data.auction.minimumIncrement : data.auction.minimumBid;
  const validAmount = Number.isSafeInteger(Number(amount)) && Number(amount) >= minimumAmount;
  return <section className="premium-auction">
    <header className="premium-auction-head"><div><span>WEEKLY PREMIUM AUCTION</span><h3><Gavel size={18} /> 다음 주 최상단 광고 경매</h3><p>공개 카운트 종료 후 최대 5분의 블라인드 구간에서 예고 없이 마감됩니다.</p></div><div className={`auction-status status-${data.auction.status}`}><i /><span>{auctionStatus(data.auction.status)}<small>{auctionOpen ? blindActive ? "블라인드 종료 감시 중" : "공개 카운트 진행 중" : data.auction.finalizedAt ? fullDate(data.auction.finalizedAt) : fullDate(data.auction.latestClosesAt)}</small></span></div></header>
    <div className={`auction-countdown${blindActive ? " blind" : ""}`} aria-live="polite"><span>{blindActive ? "BLIND CLOSING WINDOW" : "PUBLIC COUNTDOWN"}</span><strong>{blindActive ? "종료 시각 비공개" : auctionCountdown(remainingSeconds)}</strong><small>{blindActive ? "서버가 미리 정한 난수 시각에 즉시 종료됩니다. 순위는 1초마다 갱신됩니다." : "카운트가 끝나면 최대 5분 동안 정확한 종료 시각이 숨겨집니다."}</small></div>
    <div className="auction-period"><div><Crown size={15} /><span>광고 기간</span><b>{shortDate(data.auction.targetStartsAt)} — {shortDate(data.auction.targetEndsAt)}</b></div><div><Timer size={15} /><span>블라인드 종료</span><b>{fullDate(data.auction.blindStartsAt)}부터 5분 이내</b></div><div><TrendingUp size={15} /><span>낙찰 슬롯</span><b>상위 {data.auction.slotCount}개 서버</b></div><div><ShieldCheck size={15} /><span>참여 조건</span><b>본인·소유권 인증</b></div></div>
    <div className="auction-eligibility" aria-label="프리미엄 경매 참여 자격"><span className={data.server.identityVerified ? "verified" : "pending"}><ShieldCheck size={14} /><b>운영자 본인인증</b><em>{data.server.identityVerified ? "완료" : "필요"}</em></span><span className={data.server.ownershipVerified ? "verified" : "pending"}><BadgeCheck size={14} /><b>서버 소유권 인증</b><em>{data.server.ownershipVerified ? "완료" : "필요"}</em></span><span className={data.server.status === "active" ? "verified" : "pending"}><Activity size={14} /><b>서버 공개 상태</b><em>{data.server.status === "active" ? "운영 중" : "확인 필요"}</em></span></div>
    {award && <div className={`auction-award award-${award.status}`}><Crown size={17} /><div><b>{award.status === "payment_pending" ? "낙찰 · 결제 확인 대기" : award.status === "forfeited" ? "낙찰 포기 처리" : award.status === "active" ? "프리미엄 서버 등록 중" : "프리미엄 광고 확정"}</b><span>{won(award.amount)} · {award.status === "payment_pending" ? "총관리자 결제 확인 후 광고가 예약됩니다." : award.status === "active" ? `${fullDate(data.auction.targetEndsAt)}까지 등록 중` : `${fullDate(data.auction.targetStartsAt)}부터 자동 노출됩니다.`}</span></div></div>}
    <div className="auction-body"><div className="auction-bid-panel">
      <div className="auction-metrics"><span>내 현재 입찰<b>{data.ownBid ? won(data.ownBid.amount) : "미입찰"}</b></span><span>현재 낙찰선<b>{won(data.cutoffAmount)}</b></span><span>내 순위<b>{ownRank ? `${ownRank}위${winning ? " · 낙찰권" : ""}` : "-"}</b></span></div>
      {!data.eligible ? <div className="auction-ineligible"><ShieldCheck size={18} /><div><b>입찰 전 본인·소유권 인증이 필요합니다.</b><p>{data.eligibilityReason}</p></div></div> : data.ownerHasOtherBid ? <div className="auction-ineligible"><ShieldCheck size={18} /><div><b>이번 주 다른 보유 서버로 참여 중입니다.</b><p>공정한 슬롯 배정을 위해 운영자 계정당 한 서버만 입찰할 수 있습니다.</p></div></div> : <form onSubmit={submit} className="auction-bid-form"><label><span>입찰 금액 · 최소 인상 {won(data.auction.minimumIncrement)}</span><div><input className="auction-money-input" type="text" inputMode="numeric" pattern="[0-9,]*" autoComplete="off" aria-label="프리미엄 경매 입찰 금액" value={formatMoneyInput(amount)} onChange={(event) => setAmount(cleanMoneyInput(event.target.value))} /><b>원</b></div><small className="auction-money-preview">입찰 예정 금액 <strong>{Number(amount || 0).toLocaleString("ko-KR")}원</strong></small></label><div className="auction-bid-shortcuts"><button type="button" onClick={() => setAmount(String(data.suggestedBid))}>낙찰권 권장 {won(data.suggestedBid)}</button><button type="button" onClick={() => setAmount(String(Math.max(minimumAmount, Number(amount || 0)) + data.auction.minimumIncrement))}>+ {won(data.auction.minimumIncrement)}</button></div><label className="auction-terms"><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>낙찰 시 결제 의무가 있으며 블라인드 구간의 난수 마감 후 입찰을 취소·감액할 수 없음에 동의합니다.</span></label><button disabled={!auctionOpen || bidding || !acceptedTerms || !validAmount}>{!auctionOpen ? "입찰 마감" : bidding ? "입찰 처리 중…" : data.ownBid ? "입찰가 인상" : "입찰 참여"}</button></form>}
      <small className="auction-rule-note">동일 금액은 해당 금액에 먼저 도달한 서버가 우선합니다. 공개 카운트 종료 후 최대 5분 안에 예고 없이 마감되며, 낙찰 후 결제 미확인 시 차순위 서버로 승계됩니다.</small>
    </div><div className="auction-ranking"><div className="auction-ranking-head"><b>실시간 입찰 순위</b><span className={blindActive ? "fast" : ""}>{blindActive ? "블라인드 구간 · 1초 자동 갱신" : "5초 자동 갱신"}</span></div>{data.leaderboard.length === 0 ? <p>아직 입찰이 없습니다.</p> : <ol>{data.leaderboard.slice(0, 10).map((item) => <li key={item.serverId} className={`${item.inWinningRange ? "winning" : ""}${item.mine ? " mine" : ""}`}><strong>{String(item.rank).padStart(2, "0")}</strong><div><b>{item.serverTitle}</b><span>{item.mine ? "내 서버" : item.inWinningRange ? "현재 낙찰권" : "대기"}</span></div><em>{won(item.amount)}</em></li>)}</ol>}</div></div>
  </section>;
}

function auctionStatus(status: string) {
  return status === "open" ? "입찰 진행 중" : status === "closed" ? "낙찰 완료" : status === "cancelled" ? "경매 취소" : "입찰 예정";
}

function won(value: number) { return `${new Intl.NumberFormat("ko-KR").format(value)}원`; }
function cleanMoneyInput(value: string) { return value.replace(/\D/g, "").slice(0, 10).replace(/^0+(?=\d)/, ""); }
function formatMoneyInput(value: string) { const digits = cleanMoneyInput(value); return digits ? Number(digits).toLocaleString("ko-KR") : ""; }
function auctionCountdown(seconds: number) { const days = Math.floor(seconds / 86_400); const hours = Math.floor((seconds % 86_400) / 3_600); const minutes = Math.floor((seconds % 3_600) / 60); const secs = seconds % 60; return `${days ? `${days}일 ` : ""}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`; }
function shortDate(value: number) { return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric" }).format(value * 1000); }
function fullDate(value: number) { return `${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(value * 1000)} KST`; }

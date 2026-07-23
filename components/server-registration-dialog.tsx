"use client";
/* eslint-disable @next/next/no-img-element -- Local object URLs are required for exact crop previews. */

import { type FormEvent, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { ImageCropEditor, prepareImageCropSession, type ImageCropSession } from "@/components/image-crop-editor";
import { ServerCategoryTags } from "@/components/server-category-tags";
import { ServerDescriptionEditor, type DescriptionPosterUpload } from "@/components/server-description-editor";
import { assetAccept, assetSizeLabel, assetSpecs, isMotionAssetType, motionAssetAutoFits, type AssetKind } from "@/lib/image-assets";
import { descriptionPlainText, emptyDescriptionDocument, replaceDescriptionPosterIds, withoutDraftDescriptionPosters, type DescriptionDocument } from "@/lib/server-description";
import { parseServerCategories } from "@/lib/server-categories";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (serverId: string) => void | Promise<void>;
  onMessage: (message: string) => void;
  loginReturnTo?: string;
};

const initialStates = {
  icon: "선택 사항 · 미등록 시 이니셜 아이콘 자동 적용",
  desktopList: "선택 사항 · 미등록 시 기본 배너 자동 적용",
  desktopDetail: "선택 사항 · 미등록 시 기본 커버 자동 적용",
  mobileDetail: "선택 사항 · 미등록 시 기본 커버 자동 적용",
} satisfies Partial<Record<AssetKind, string>>;

export function ServerRegistrationDialog({ open, onOpenChange, onCreated, onMessage, loginReturnTo = "/?register=1" }: Props) {
  const router = useRouter();
  const [assetStates, setAssetStates] = useState(initialStates);
  const [assets, setAssets] = useState<Partial<Record<AssetKind, File>>>({});
  const [previews, setPreviews] = useState<Partial<Record<AssetKind, string>>>({});
  const [crop, setCrop] = useState<ImageCropSession | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [descriptionDocument, setDescriptionDocument] = useState<DescriptionDocument>(() => emptyDescriptionDocument());
  const [draftPosters, setDraftPosters] = useState<Record<string, { file: File; url: string }>>({});
  const [saving, setSaving] = useState(false);
  const previewsRef = useRef<Partial<Record<AssetKind, string>>>({});
  const draftPostersRef = useRef<Record<string, { file: File; url: string }>>({});

  useEffect(() => () => {
    Object.values(previewsRef.current).forEach((url) => URL.revokeObjectURL(url));
    Object.values(draftPostersRef.current).forEach(({ url }) => URL.revokeObjectURL(url));
  }, []);

  function setAssetState(kind: AssetKind, message: string) {
    setAssetStates((current) => ({ ...current, [kind]: message }));
  }

  function clearAsset(kind: AssetKind) {
    setAssets((current) => { const next = { ...current }; delete next[kind]; return next; });
    const previous = previewsRef.current[kind];
    if (previous) URL.revokeObjectURL(previous);
    const next = { ...previewsRef.current };
    delete next[kind];
    previewsRef.current = next;
    setPreviews(next);
  }

  function storeAsset(kind: AssetKind, file: File) {
    const previous = previewsRef.current[kind];
    if (previous) URL.revokeObjectURL(previous);
    const next = { ...previewsRef.current, [kind]: URL.createObjectURL(file) };
    previewsRef.current = next;
    setPreviews(next);
    setAssets((current) => ({ ...current, [kind]: file }));
  }

  function clearAllAssets() {
    Object.values(previewsRef.current).forEach((url) => URL.revokeObjectURL(url));
    previewsRef.current = {};
    setPreviews({});
    setAssets({});
    setAssetStates(initialStates);
  }

  function clearDraftPosters() {
    Object.values(draftPostersRef.current).forEach(({ url }) => URL.revokeObjectURL(url));
    draftPostersRef.current = {};
    setDraftPosters({});
  }

  async function queueDescriptionPoster(file: File): Promise<DescriptionPosterUpload> {
    if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) throw new Error("본문 이미지는 PNG, JPG, WebP만 사용할 수 있습니다.");
    if (file.size < 32 || file.size > 8 * 1024 * 1024) throw new Error("본문 이미지는 최대 8MB까지 사용할 수 있습니다.");
    if (Object.keys(draftPostersRef.current).length >= 12) throw new Error("본문 이미지는 최대 12장까지 추가할 수 있습니다.");
    const assetId = `draft-${crypto.randomUUID().replaceAll("-", "")}`;
    const url = URL.createObjectURL(file);
    const next = { ...draftPostersRef.current, [assetId]: { file, url } };
    draftPostersRef.current = next;
    setDraftPosters(next);
    return { assetId, url, alt: file.name.replace(/\.[^.]+$/, "").slice(0, 160) || "서버 홍보 이미지" };
  }

  async function chooseAsset(kind: AssetKind, file?: File) {
    if (!file) return;
    clearAsset(kind);
    try {
      const session = await prepareImageCropSession(kind, file);
      const spec = assetSpecs[kind];
      if (isMotionAssetType(file.type)) {
        URL.revokeObjectURL(session.sourceUrl);
        if (!motionAssetAutoFits(kind) && (session.sourceWidth !== spec.width || session.sourceHeight !== spec.height)) {
          setAssetState(kind, `${file.type === "video/webm" ? "WebM" : "GIF"} ${session.sourceWidth}×${session.sourceHeight} · ${spec.width}×${spec.height} 완성본 필요`);
          return;
        }
        if (file.size > spec.maxBytes) {
          setAssetState(kind, `${file.type === "video/webm" ? "WebM" : "GIF"} 용량 초과 · 최대 ${assetSizeLabel(kind)}`);
          return;
        }
        storeAsset(kind, file);
        setAssetState(kind, `✓ ${file.name} · ${file.type === "video/webm" ? "WebM" : "GIF"}${motionAssetAutoFits(kind) ? " 화면 규격 자동 맞춤" : " 규격 검증 완료"}`);
        return;
      }
      if (crop) URL.revokeObjectURL(crop.sourceUrl);
      setCrop(session);
      setAssetState(kind, `${session.sourceWidth}×${session.sourceHeight} 원본 · 사용할 영역을 실시간으로 조정하세요`);
    } catch (error) {
      setAssetState(kind, error instanceof Error ? error.message : "이미지를 읽을 수 없습니다.");
    }
  }

  function closeCrop() {
    if (crop) URL.revokeObjectURL(crop.sourceUrl);
    setCrop(null);
  }

  function applyCrop(file: File) {
    if (!crop) return;
    const kind = crop.kind;
    storeAsset(kind, file);
    setAssetState(kind, `✓ ${crop.sourceWidth}×${crop.sourceHeight} → ${assetSpecs[kind].width}×${assetSpecs[kind].height} 자동 크롭 완료`);
    closeCrop();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    let createdServerId = "";
    let createdServerTitle = "";
    try {
      const description = descriptionPlainText(descriptionDocument);
      if (description.length < 20) throw new Error("서버 상세 소개를 20자 이상 작성해 주세요.");
      const submittedCategories = parseServerCategories(categories);
      const registrationDocument = withoutDraftDescriptionPosters(descriptionDocument);
      const requestPayload = {
        title: form.get("title"), shortDescription: form.get("shortDescription"), description,
        descriptionDocument: registrationDocument,
        edition: form.get("edition"), minVersion: form.get("minVersion"), maxVersion: form.get("maxVersion"),
        address: form.get("address"), port: Number(form.get("port")), categories: submittedCategories,
      };
      const response = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });
      const result = await response.json() as { server?: { id: string; title: string }; error?: string };
      if (response.status === 401) { router.push(`/login?returnTo=${encodeURIComponent(loginReturnTo)}`); return; }
      if (!response.ok || !result.server) throw new Error(result.error ?? "서버 등록에 실패했습니다.");
      createdServerId = result.server.id;
      createdServerTitle = result.server.title;
      const posterReplacements: Record<string, string> = {};
      for (const [draftId, draft] of Object.entries(draftPostersRef.current)) {
        const poster = new FormData(); poster.set("poster", draft.file);
        const posterResponse = await fetch(`/api/servers/${createdServerId}/description-assets`, { method: "POST", body: poster });
        const posterBody = await posterResponse.json() as { asset?: { id: string }; error?: string };
        if (!posterResponse.ok || !posterBody.asset) throw new Error(posterBody.error ?? "소개 이미지 저장에 실패했습니다.");
        posterReplacements[draftId] = posterBody.asset.id;
      }
      if (Object.keys(posterReplacements).length) {
        const finalDocument = replaceDescriptionPosterIds(descriptionDocument, posterReplacements);
        const patchResponse = await fetch(`/api/servers/${createdServerId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...requestPayload, description: descriptionPlainText(finalDocument), descriptionDocument: finalDocument }) });
        const patchBody = await patchResponse.json() as { error?: string };
        if (!patchResponse.ok) throw new Error(patchBody.error ?? "소개문 저장에 실패했습니다.");
      }
      for (const kind of ["icon", "desktopList", "desktopDetail", "mobileDetail"] as AssetKind[]) {
        const file = assets[kind];
        if (!file) continue;
        const asset = new FormData();
        asset.append(kind, file);
        const assetResponse = await fetch(`/api/servers/${createdServerId}/assets`, { method: "POST", body: asset });
        if (!assetResponse.ok) {
          const assetResult = await assetResponse.json() as { error?: string };
          throw new Error(assetResult.error ?? "이미지 저장에 실패했습니다.");
        }
      }
      const serverId = createdServerId;
      clearAllAssets();
      clearDraftPosters();
      setCategories([]);
      setDescriptionDocument(emptyDescriptionDocument());
      onOpenChange(false);
      onMessage("서버 저장 완료. MOTD 인증을 계속해 주세요.");
      await onCreated(serverId);
    } catch (error) {
      if (createdServerId) await fetch(`/api/servers/${createdServerId}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: createdServerTitle }) }).catch(() => undefined);
      onMessage(error instanceof Error ? error.message : "서버 등록에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) closeCrop(); onOpenChange(next); }}>
      <Dialog.Portal><Dialog.Overlay className="modal-backdrop" /><Dialog.Content className="register-modal" aria-modal="true" aria-labelledby="register-title" onPointerDownOutside={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}>
        <Dialog.Close asChild><button className="modal-close" type="button" aria-label="등록 닫기"><X size={18} /></button></Dialog.Close>
        <div className="register-head"><span>SERVER ONBOARDING / 01</span><Dialog.Title asChild><h2 id="register-title">새 서버 등록</h2></Dialog.Title><Dialog.Description asChild><p>이미지는 어떤 크기든 선택하면 규격에 맞춰 실시간 크롭할 수 있습니다. 건너뛰면 Minecraft.kr 기본 비주얼이 적용됩니다.</p></Dialog.Description></div>
        <form onSubmit={submit}>
          <div className="form-grid"><label><span>서버 제목</span><input name="title" minLength={2} maxLength={60} required placeholder="표시할 서버 이름" /></label><label><span>목록 한 줄 소개</span><input name="shortDescription" minLength={2} maxLength={80} required placeholder="80자 이내 핵심 소개" /></label></div>
          <div className="registration-description-field"><ServerDescriptionEditor document={descriptionDocument} disabled={saving} onChange={setDescriptionDocument} onMessage={onMessage} onUploadPoster={queueDescriptionPoster} posterUrl={(assetId) => draftPosters[assetId]?.url ?? ""} /></div>
          <div className="form-grid three"><label><span>에디션</span><select name="edition" defaultValue="JE"><option value="JE">Java Edition</option><option value="BE">Bedrock Edition</option><option value="JE + BE">Java + Bedrock</option></select></label><label><span>최소 버전</span><input name="minVersion" maxLength={24} defaultValue="1.21.4" required /></label><label><span>최대 버전</span><input name="maxVersion" maxLength={24} defaultValue="1.21.8" required /></label></div>
          <div className="form-grid address"><label><span>서버 주소</span><input name="address" required placeholder="play.example.kr" /></label><label><span>포트</span><input name="port" type="number" min={1} max={65535} defaultValue={25565} required /></label></div>
          <div className="registration-category-row"><ServerCategoryTags value={categories} onChange={setCategories} disabled={saving} idPrefix="registration" /><div className="form-helper"><b>주소는 등록 후 잠금</b><p>도메인은 고정되며 운영자센터에서 표시 대소문자만 바꿀 수 있습니다.</p></div></div>
          <div className="icon-upload-row"><label className={assetStates.icon?.startsWith("✓") ? "upload-box icon-upload valid has-preview" : "upload-box icon-upload"}><input name="icon" type="file" accept={assetAccept("icon")} onChange={(event) => void chooseAsset("icon", event.target.files?.[0])} /><span className={`upload-visual square${previews.icon ? " preview" : ""}`}>{previews.icon ? <>{assets.icon?.type === "video/webm" ? <video src={previews.icon} autoPlay loop muted playsInline aria-label="서버 아이콘 WebM 미리보기" /> : <img src={previews.icon} alt="서버 아이콘 GIF·이미지 미리보기" />}<em className="upload-preview-badge">PREVIEW</em></> : <><b>256</b><small>× 256</small></>}</span><strong>{previews.icon ? "서버 아이콘 · 저장 준비 완료" : "서버 아이콘 · 자동 크롭"}</strong><small>{assetStates.icon}</small></label><div><b>정지 이미지·GIF·WebM 사용 가능</b><p>원본 크기와 무관하게 256×256 정사각형에 맞추며, 움직이는 아이콘도 실시간으로 미리봅니다.</p></div></div>
          <section className="asset-upload-section shared-list-upload" aria-labelledby="list-banner-upload-title"><div className="asset-upload-heading"><span>LIST PROMOTION</span><div><b id="list-banner-upload-title">PC·모바일 공용 목록 배너</b><p>468×60 한 장이 데스크톱과 모바일 서버 리스트에 동일하게 노출됩니다.</p></div></div><div className="upload-grid banner-upload-grid"><BannerUpload kind="desktopList" title="공용 목록 배너" state={assetStates.desktopList ?? ""} width={468} height={60} previewUrl={previews.desktopList} previewType={assets.desktopList?.type} onSelect={chooseAsset} /></div></section>
          <section className="asset-upload-section detail-cover-upload" aria-labelledby="detail-cover-upload-title"><div className="asset-upload-heading"><span>DETAIL COVER</span><div><b id="detail-cover-upload-title">상세 상단 커버</b><p>서버 상세보기 맨 위에만 쓰는 별도 이미지입니다. PC 1440×480 / 모바일 750×500.</p></div></div><div className="upload-grid banner-upload-grid"><BannerUpload kind="desktopDetail" title="PC 상세 커버" state={assetStates.desktopDetail ?? ""} width={1440} height={480} previewUrl={previews.desktopDetail} previewType={assets.desktopDetail?.type} onSelect={chooseAsset} /><BannerUpload kind="mobileDetail" title="모바일 상세 커버" state={assetStates.mobileDetail ?? ""} width={750} height={500} previewUrl={previews.mobileDetail} previewType={assets.mobileDetail?.type} onSelect={chooseAsset} /></div></section>
          <button className="submit-register" type="submit" disabled={saving}>{saving ? "서버 등록 중…" : "서버 등록 후 MOTD 인증 계속하기"}</button>
        </form>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
    {crop && <ImageCropEditor session={crop} onCancel={closeCrop} onApply={applyCrop} onError={(message) => setAssetState(crop.kind, message)} />}
  </>;
}

function BannerUpload({ kind, title, state, width, height, previewUrl, previewType, onSelect }: { kind: Exclude<AssetKind, "icon">; title: string; state: string; width: number; height: number; previewUrl?: string; previewType?: string; onSelect: (kind: AssetKind, file?: File) => Promise<void> }) {
  const motionGuide = motionAssetAutoFits(kind)
    ? `GIF·WebM 원본 크기 자동 맞춤 · 최대 ${assetSizeLabel(kind)}`
    : `GIF·WebM ${width}×${height} 완성본 · 최대 ${assetSizeLabel(kind)}`;
  return <label className={state.startsWith("✓") ? "upload-box banner-upload valid has-preview" : "upload-box banner-upload"}><input name={kind} type="file" accept={assetAccept(kind)} onChange={(event) => void onSelect(kind, event.target.files?.[0])} /><span className={`upload-visual wide${previewUrl ? " preview" : ""}`} style={{ aspectRatio: `${width}/${height}` }}>{previewUrl ? <>{previewType === "video/webm" ? <video src={previewUrl} autoPlay loop muted playsInline aria-label={`${title} WebM 결과 미리보기`} /> : <img src={previewUrl} alt={`${title} 결과 미리보기`} />}<em className="upload-preview-badge">PREVIEW</em></> : <><b>{width}</b><small>× {height}</small></>}</span><strong>{title} · {previewUrl ? "저장 준비 완료" : "자동 크롭"}</strong><small>{state} · 정지 이미지는 원본 크기 무관 · {motionGuide}</small></label>;
}

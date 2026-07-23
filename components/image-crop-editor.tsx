"use client";
/* eslint-disable @next/next/no-img-element -- Object URLs require a native image element for the local interactive crop stage. */

import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Crop, Move, RotateCcw, X, ZoomIn } from "lucide-react";
import { assetAccept, assetSpecs, type AssetKind } from "@/lib/image-assets";

export type ImageCropSession = {
  kind: AssetKind;
  file: File;
  sourceUrl: string;
  sourceWidth: number;
  sourceHeight: number;
};

type CropCorner = "tl" | "tr" | "bl" | "br";
type ResizeSession = { corner: CropCorner; stage: DOMRect; crop: ReturnType<typeof getCropRect> };

const labels: Record<AssetKind, string> = {
  icon: "서버 아이콘",
  desktopList: "PC 목록 배너",
  mobileList: "모바일 목록 배너",
  desktopDetail: "PC 상세 커버",
  mobileDetail: "모바일 상세 커버",
};

export async function prepareImageCropSession(kind: AssetKind, file: File): Promise<ImageCropSession> {
  const spec = assetSpecs[kind];
  const supportedTypes = new Set(assetAccept(kind).split(","));
  if (!supportedTypes.has(file.type)) throw new Error(`PNG, JPG, WebP${spec.animated ? ", GIF, WebM" : ""} 파일만 사용할 수 있습니다.`);
  if (file.size > 15 * 1024 * 1024) throw new Error("원본 파일은 최대 15MB까지 선택할 수 있습니다.");

  const sourceUrl = URL.createObjectURL(file);
  try {
    const dimensions = file.type === "video/webm" ? await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight });
      video.onerror = () => reject(new Error("WebM 영상을 읽을 수 없습니다."));
      video.src = sourceUrl;
    }) : await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
      image.src = sourceUrl;
    });
    return { kind, file, sourceUrl, sourceWidth: dimensions.width, sourceHeight: dimensions.height };
  } catch (error) {
    URL.revokeObjectURL(sourceUrl);
    throw error;
  }
}

function getCropRect(session: ImageCropSession, zoom: number, positionX: number, positionY: number) {
  const spec = assetSpecs[session.kind];
  const sourceRatio = session.sourceWidth / session.sourceHeight;
  const targetRatio = spec.width / spec.height;
  let cropWidth = session.sourceWidth;
  let cropHeight = session.sourceHeight;
  if (sourceRatio > targetRatio) cropWidth = session.sourceHeight * targetRatio;
  else cropHeight = session.sourceWidth / targetRatio;
  cropWidth /= zoom;
  cropHeight /= zoom;
  const x = (session.sourceWidth - cropWidth) * (positionX / 100);
  const y = (session.sourceHeight - cropHeight) * (positionY / 100);
  return { x, y, width: cropWidth, height: cropHeight };
}

export function ImageCropEditor({ session, onCancel, onApply, onError }: {
  session: ImageCropSession;
  onCancel: () => void;
  onApply: (file: File) => void;
  onError: (message: string) => void;
}) {
  const spec = assetSpecs[session.kind];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ pointerX: number; pointerY: number; positionX: number; positionY: number } | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const pendingPositionRef = useRef<{ x: number; y: number } | null>(null);
  const resizeRef = useRef<ResizeSession | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<{ zoom: number; x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [positionX, setPositionX] = useState(50);
  const [positionY, setPositionY] = useState(50);
  const [sourceReady, setSourceReady] = useState(false);
  const [applying, setApplying] = useState(false);
  const upscaled = session.sourceWidth < spec.width || session.sourceHeight < spec.height;
  const pixelUpscale = session.kind === "icon" && upscaled;
  const cropRect = getCropRect(session, zoom, positionX, positionY);
  const canMoveX = session.sourceWidth - cropRect.width > 0.5;
  const canMoveY = session.sourceHeight - cropRect.height > 0.5;
  const cropFrameStyle = {
    left: `${(cropRect.x / session.sourceWidth) * 100}%`,
    top: `${(cropRect.y / session.sourceHeight) * 100}%`,
    width: `${(cropRect.width / session.sourceWidth) * 100}%`,
    height: `${(cropRect.height / session.sourceHeight) * 100}%`,
  } as CSSProperties;

  useEffect(() => {
    let active = true;
    const source = new Image();
    source.onload = () => {
      if (!active) return;
      sourceImageRef.current = source;
      setSourceReady(true);
    };
    source.src = session.sourceUrl;
    return () => {
      active = false;
      sourceImageRef.current = null;
    };
  }, [session.sourceUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const source = sourceImageRef.current;
    if (!canvas || !source || !sourceReady) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const crop = getCropRect(session, zoom, positionX, positionY);
    context.clearRect(0, 0, spec.width, spec.height);
    context.imageSmoothingEnabled = !pixelUpscale;
    if (!pixelUpscale) context.imageSmoothingQuality = "high";
    context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, spec.width, spec.height);
  }, [pixelUpscale, positionX, positionY, session, sourceReady, spec.height, spec.width, zoom]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  useEffect(() => () => {
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current);
  }, []);

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canMoveX && !canMoveY) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, positionX, positionY };
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const deltaX = ((event.clientX - dragRef.current.pointerX) / rect.width) * 100;
    const deltaY = ((event.clientY - dragRef.current.pointerY) / rect.height) * 100;
    pendingPositionRef.current = {
      x: canMoveX ? Math.max(0, Math.min(100, dragRef.current.positionX + deltaX)) : 50,
      y: canMoveY ? Math.max(0, Math.min(100, dragRef.current.positionY + deltaY)) : 50,
    };
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      const next = pendingPositionRef.current;
      if (next) {
        if (canMoveX) setPositionX(next.x);
        if (canMoveY) setPositionY(next.y);
      }
      dragFrameRef.current = null;
    });
  }

  function stopDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    const next = pendingPositionRef.current;
    if (next) {
      if (canMoveX) setPositionX(next.x);
      if (canMoveY) setPositionY(next.y);
    }
    pendingPositionRef.current = null;
    dragRef.current = null;
  }

  function startResize(corner: CropCorner, event: ReactPointerEvent<HTMLButtonElement>) {
    const stage = stageRef.current;
    if (!stage) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = { corner, stage: stage.getBoundingClientRect(), crop: getCropRect(session, zoom, positionX, positionY) };
  }

  function moveResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = resizeRef.current;
    if (!active) return;
    event.preventDefault();
    event.stopPropagation();
    const targetRatio = spec.width / spec.height;
    const pointerX = Math.max(0, Math.min(session.sourceWidth, ((event.clientX - active.stage.left) / active.stage.width) * session.sourceWidth));
    const pointerY = Math.max(0, Math.min(session.sourceHeight, ((event.clientY - active.stage.top) / active.stage.height) * session.sourceHeight));
    const leftCorner = active.corner === "tl" || active.corner === "bl";
    const topCorner = active.corner === "tl" || active.corner === "tr";
    const anchorX = leftCorner ? active.crop.x + active.crop.width : active.crop.x;
    const anchorY = topCorner ? active.crop.y + active.crop.height : active.crop.y;
    const widthFromX = Math.max(0, leftCorner ? anchorX - pointerX : pointerX - anchorX);
    const widthFromY = Math.max(0, topCorner ? anchorY - pointerY : pointerY - anchorY) * targetRatio;
    const desiredWidth = Math.abs(widthFromX - active.crop.width) >= Math.abs(widthFromY - active.crop.width) ? widthFromX : widthFromY;
    const baseCrop = getCropRect(session, 1, 50, 50);
    const horizontalLimit = leftCorner ? anchorX : session.sourceWidth - anchorX;
    const verticalLimit = (topCorner ? anchorY : session.sourceHeight - anchorY) * targetRatio;
    const maxWidth = Math.min(baseCrop.width, horizontalLimit, verticalLimit);
    const minWidth = Math.min(maxWidth, Math.max(8, baseCrop.width / 4));
    const nextWidth = Math.max(minWidth, Math.min(maxWidth, desiredWidth));
    const nextHeight = nextWidth / targetRatio;
    const nextX = leftCorner ? anchorX - nextWidth : anchorX;
    const nextY = topCorner ? anchorY - nextHeight : anchorY;
    const availableX = session.sourceWidth - nextWidth;
    const availableY = session.sourceHeight - nextHeight;
    pendingResizeRef.current = {
      zoom: Math.max(1, Math.min(4, baseCrop.width / nextWidth)),
      x: availableX > 0.5 ? Math.max(0, Math.min(100, (nextX / availableX) * 100)) : 50,
      y: availableY > 0.5 ? Math.max(0, Math.min(100, (nextY / availableY) * 100)) : 50,
    };
    if (resizeFrameRef.current !== null) return;
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      const next = pendingResizeRef.current;
      if (next) {
        setZoom(next.zoom);
        setPositionX(next.x);
        setPositionY(next.y);
      }
      resizeFrameRef.current = null;
    });
  }

  function stopResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    const next = pendingResizeRef.current;
    if (next) {
      setZoom(next.zoom);
      setPositionX(next.x);
      setPositionY(next.y);
    }
    pendingResizeRef.current = null;
    resizeRef.current = null;
  }

  async function createCrop() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setApplying(true);
    try {
      let selectedBlob: Blob | null = null;
      for (const quality of [0.92, 0.84, 0.76, 0.68, 0.6]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
        if (blob && blob.size <= spec.maxBytes) { selectedBlob = blob; break; }
      }
      if (!selectedBlob) throw new Error(`자동 압축 후에도 ${Math.round(spec.maxBytes / 1024)}KB를 초과합니다. 확대 비율을 낮추거나 다른 이미지를 선택해 주세요.`);
      const baseName = session.file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9가-힣_-]+/g, "-") || "minecraft-server";
      onApply(new File([selectedBlob], `${baseName}-${session.kind}-${spec.width}x${spec.height}.webp`, { type: "image/webp" }));
    } catch (error) {
      onError(error instanceof Error ? error.message : "이미지 크롭에 실패했습니다.");
    } finally {
      setApplying(false);
    }
  }

  function resetCrop() {
    setZoom(1);
    setPositionX(50);
    setPositionY(50);
  }

  function changeZoom(nextZoom: number) {
    const nextCrop = getCropRect(session, nextZoom, positionX, positionY);
    setZoom(nextZoom);
    if (session.sourceWidth - nextCrop.width <= 0.5) setPositionX(50);
    if (session.sourceHeight - nextCrop.height <= 0.5) setPositionY(50);
  }

  return <Dialog.Root open onOpenChange={(open) => { if (!open) onCancel(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="crop-modal-backdrop" />
      <Dialog.Content className="crop-dialog" aria-modal="true" aria-labelledby="crop-dialog-title" onPointerDownOutside={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}>
      <header><div><span>LIVE IMAGE CROP</span><Dialog.Title asChild><h2 id="crop-dialog-title">{labels[session.kind]} 영역 맞추기</h2></Dialog.Title><Dialog.Description asChild><p>이미지를 움직이는 즉시 실제 저장 결과가 갱신됩니다. 확정하면 {spec.width}×{spec.height} WebP로 자동 변환됩니다.</p></Dialog.Description></div><button type="button" onClick={onCancel} aria-label="크롭 편집기 닫기"><X size={18} /></button></header>
      <div className="crop-workspace">
        <div className="crop-visual-grid">
          <section className="crop-source-panel" aria-labelledby="crop-source-title">
            <div className="crop-panel-heading"><span id="crop-source-title">원본에서 선택</span><b><Move size={13} /> 박스 이동 · 모서리 크기 조절</b></div>
            <div ref={stageRef} className={`crop-source-stage${canMoveX || canMoveY ? " movable" : " fixed"}`} style={{ aspectRatio: `${session.sourceWidth}/${session.sourceHeight}`, "--source-ratio": session.sourceWidth / session.sourceHeight } as CSSProperties} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} aria-label="원본 이미지와 현재 크롭 사각형">
              <img src={session.sourceUrl} alt="선택한 원본" draggable={false} />
              <div className="crop-frame" style={cropFrameStyle}><span>CROP · {spec.width}×{spec.height} · 비율 고정</span>{(["tl", "tr", "bl", "br"] as CropCorner[]).map((corner) => <button key={corner} type="button" className={`corner-${corner}`} aria-label={`${corner === "tl" ? "왼쪽 위" : corner === "tr" ? "오른쪽 위" : corner === "bl" ? "왼쪽 아래" : "오른쪽 아래"} 모서리로 크롭 크기 조절`} onPointerDown={(event) => startResize(corner, event)} onPointerMove={moveResize} onPointerUp={stopResize} onPointerCancel={stopResize} />)}</div>
            </div>
            <small className="crop-pan-note">모서리를 당겨 크기를 조절하고, 박스 안쪽을 드래그해 위치를 맞추세요. 출력 규격 비율은 자동으로 유지됩니다.</small>
          </section>
          <aside className="crop-result-panel" aria-labelledby="crop-result-title">
            <div className="crop-panel-heading"><span id="crop-result-title">실제 저장 결과</span><b><i className="crop-live-dot" /> LIVE</b></div>
            <div className="crop-result-preview" style={{ aspectRatio: `${spec.width}/${spec.height}` }}><canvas ref={canvasRef} width={spec.width} height={spec.height} aria-label="실제 저장 결과 미리보기" /></div>
            <small>{spec.width}×{spec.height} WebP · 표시된 모습 그대로 저장</small>
          </aside>
        </div>
        <div className="crop-meta"><span>원본 <b>{session.sourceWidth}×{session.sourceHeight}</b></span><span>결과 <b>{spec.width}×{spec.height}</b></span><span>처리 <b>{upscaled ? pixelUpscale ? "픽셀 선명 확대" : "고품질 확대" : "고품질 크롭"}</b></span><span>형식 <b>WebP</b></span></div>
        <div className="crop-controls">
          <label><span><ZoomIn size={13} /> 확대 <b>{Math.round(zoom * 100)}%</b></span><input type="range" min="100" max="400" step="5" value={Math.round(zoom * 100)} onChange={(event) => changeZoom(Number(event.target.value) / 100)} /></label>
          <label className={canMoveX ? "" : "disabled"}><span>가로 위치 <b>{canMoveX ? `${Math.round(positionX)}%` : "고정"}</b></span><input type="range" min="0" max="100" value={canMoveX ? positionX : 50} disabled={!canMoveX} onChange={(event) => setPositionX(Number(event.target.value))} /></label>
          <label className={canMoveY ? "" : "disabled"}><span>세로 위치 <b>{canMoveY ? `${Math.round(positionY)}%` : "고정"}</b></span><input type="range" min="0" max="100" value={canMoveY ? positionY : 50} disabled={!canMoveY} onChange={(event) => setPositionY(Number(event.target.value))} /></label>
        </div>
      </div>
      <footer><button type="button" className="crop-reset" onClick={resetCrop}><RotateCcw size={14} /> 중앙으로 초기화</button><div><button type="button" onClick={onCancel}>취소</button><button type="button" className="crop-apply" disabled={applying || !sourceReady} onClick={createCrop}><Crop size={15} /> {applying ? "변환 중…" : sourceReady ? "이 영역으로 적용" : "미리보기 준비 중…"}</button></div></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

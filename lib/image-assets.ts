export const assetSpecs = {
  icon: { width: 256, height: 256, maxBytes: 4 * 1024 * 1024, animated: true, motionAutoFit: true },
  desktopList: { width: 468, height: 60, maxBytes: 950 * 1024, animated: true, motionAutoFit: true },
  desktopDetail: { width: 1440, height: 480, maxBytes: 12 * 1024 * 1024, animated: true, motionAutoFit: true },
  mobileList: { width: 750, height: 300, maxBytes: 950 * 1024, animated: true, motionAutoFit: true },
  mobileDetail: { width: 750, height: 500, maxBytes: 8 * 1024 * 1024, animated: true, motionAutoFit: true },
} as const;

export type AssetKind = keyof typeof assetSpecs;

export const motionAssetTypes = new Set(["image/gif", "video/webm"]);
const MAX_MOTION_PIXELS = 8_294_400;
const MAX_GIF_FRAMES = 300;

export function isMotionAssetType(contentType: string) {
  return motionAssetTypes.has(contentType);
}

export function motionAssetAutoFits(kind: AssetKind) {
  return "motionAutoFit" in assetSpecs[kind] && assetSpecs[kind].motionAutoFit === true;
}

export function assetSizeLabel(kind: AssetKind) {
  const bytes = assetSpecs[kind].maxBytes;
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)}MB` : `${Math.round(bytes / 1024)}KB`;
}

export function assetAccept(kind: AssetKind) {
  return assetSpecs[kind].animated
    ? "image/png,image/jpeg,image/webp,image/gif,video/webm"
    : "image/png,image/jpeg,image/webp";
}

export async function validateAsset(file: File, kind: AssetKind) {
  const spec = assetSpecs[kind];
  const supportedTypes = new Set(["image/png", "image/jpeg", "image/webp", ...(spec.animated ? ["image/gif", "video/webm"] : [])]);
  if (!supportedTypes.has(file.type)) {
    throw Response.json({ error: `${kind} must be PNG, JPG, WebP${spec.animated ? ", GIF, or WebM" : ""}` }, { status: 400 });
  }
  if (file.size < 32 || file.size > spec.maxBytes) {
    throw Response.json({ error: `${kind} exceeds its file-size limit` }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = mediaDimensions(bytes, file.type);
  const autoFitMotion = isMotionAssetType(file.type) && motionAssetAutoFits(kind);
  if (!dimensions || (!autoFitMotion && (dimensions.width !== spec.width || dimensions.height !== spec.height))) {
    throw Response.json({ error: `${kind} must be exactly ${spec.width}x${spec.height}` }, { status: 400 });
  }
  if (autoFitMotion && (
    dimensions.width < 1
    || dimensions.height < 1
    || dimensions.width > 3_840
    || dimensions.height > 2_160
    || dimensions.width * dimensions.height > MAX_MOTION_PIXELS
  )) {
    throw Response.json({ error: `${kind} motion media exceeds the safe pixel limit` }, { status: 400 });
  }
  if (file.type === "image/gif") {
    const frameCount = gifFrameCount(bytes, MAX_GIF_FRAMES + 1);
    if (frameCount === null || frameCount > MAX_GIF_FRAMES) {
      throw Response.json({ error: `${kind} GIF is malformed or has more than ${MAX_GIF_FRAMES} frames` }, { status: 400 });
    }
  }
  return {
    file,
    bytes,
    ...dimensions,
    extension: file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type === "image/gif" ? "gif" : file.type === "video/webm" ? "webm" : "jpg",
  };
}

export async function validateDescriptionPoster(file: File) {
  const supportedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!supportedTypes.has(file.type)) throw Response.json({ error: "홍보 포스터는 PNG, JPG, WebP만 등록할 수 있습니다." }, { status: 400 });
  if (file.size < 32 || file.size > 8 * 1024 * 1024) throw Response.json({ error: "홍보 포스터는 최대 8MB까지 등록할 수 있습니다." }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = mediaDimensions(bytes, file.type);
  if (!dimensions || dimensions.width < 1 || dimensions.width > 2400 || dimensions.height < 1 || dimensions.height > 12_000
    || dimensions.width * dimensions.height > 12_000_000) {
    throw Response.json({ error: "이미지를 읽을 수 없거나 처리 가능한 크기를 초과했습니다. 브라우저에서 자동 축소 후 다시 등록해 주세요." }, { status: 400 });
  }
  return {
    file, bytes, ...dimensions,
    extension: file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg",
  };
}

function mediaDimensions(bytes: Uint8Array, contentType: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (contentType === "image/png" && bytes.length >= 24 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (contentType === "image/gif" && bytes.length >= 10 && new Set(["GIF87a", "GIF89a"]).has(ascii(bytes, 0, 6))) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (contentType === "image/jpeg" && bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    const sof = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (sof.has(marker)) return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = view.getUint16(offset + 2);
      if (length < 2) break;
      offset += length + 2;
    }
  }
  if (contentType === "image/webp" && bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8X") return { width: 1 + uint24(bytes, 24), height: 1 + uint24(bytes, 27) };
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const b1 = bytes[21], b2 = bytes[22], b3 = bytes[23], b4 = bytes[24];
      return { width: 1 + (b1 | ((b2 & 0x3f) << 8)), height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)) };
    }
  }
  if (contentType === "video/webm" && bytes.length >= 32 && view.getUint32(0) === 0x1a45dfa3) {
    return webmDimensions(bytes);
  }
  return null;
}

function gifFrameCount(bytes: Uint8Array, stopAfter: number) {
  if (bytes.length < 13 || !new Set(["GIF87a", "GIF89a"]).has(ascii(bytes, 0, 6))) return null;
  let offset = 13;
  const packed = bytes[10];
  if ((packed & 0x80) !== 0) {
    offset += 3 * 2 ** ((packed & 0x07) + 1);
  }
  let frames = 0;
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) return frames;
    if (marker === 0x21) {
      if (offset >= bytes.length) return null;
      offset += 1;
      offset = skipGifSubBlocks(bytes, offset);
      if (offset < 0) return null;
      continue;
    }
    if (marker !== 0x2c || offset + 9 > bytes.length) return null;
    const imagePacked = bytes[offset + 8];
    offset += 9;
    if ((imagePacked & 0x80) !== 0) {
      offset += 3 * 2 ** ((imagePacked & 0x07) + 1);
    }
    if (offset >= bytes.length) return null;
    offset += 1;
    offset = skipGifSubBlocks(bytes, offset);
    if (offset < 0) return null;
    frames += 1;
    if (frames >= stopAfter) return frames;
  }
  return null;
}

function skipGifSubBlocks(bytes: Uint8Array, start: number) {
  let offset = start;
  while (offset < bytes.length) {
    const size = bytes[offset++];
    if (size === 0) return offset;
    if (offset + size > bytes.length) return -1;
    offset += size;
  }
  return -1;
}

function webmDimensions(bytes: Uint8Array) {
  const masterElementIds = new Set([0x1a45dfa3, 0x18538067, 0x1654ae6b, 0xae, 0xe0]);
  let width: number | null = null;
  let height: number | null = null;

  function walk(start: number, end: number, depth: number) {
    if (depth > 8) return;
    let offset = start;
    while (offset < end && (width === null || height === null)) {
      const id = readEbmlVint(bytes, offset, true);
      if (!id) return;
      const size = readEbmlVint(bytes, offset + id.length, false);
      if (!size) return;
      const payloadStart = offset + id.length + size.length;
      const payloadEnd = size.unknown ? end : payloadStart + size.value;
      if (payloadStart > end || payloadEnd > end || payloadEnd < payloadStart) return;
      if (id.value === 0xb0) width = readUnsigned(bytes, payloadStart, payloadEnd);
      else if (id.value === 0xba) height = readUnsigned(bytes, payloadStart, payloadEnd);
      else if (masterElementIds.has(id.value)) walk(payloadStart, payloadEnd, depth + 1);
      if (width !== null && height !== null) return;
      offset = payloadEnd;
    }
  }

  walk(0, bytes.length, 0);
  return width && height ? { width, height } : null;
}

function readEbmlVint(bytes: Uint8Array, offset: number, preserveMarker: boolean) {
  if (offset >= bytes.length) return null;
  const first = bytes[offset];
  let length = 1;
  let marker = 0x80;
  while (length <= 8 && (first & marker) === 0) { length += 1; marker >>= 1; }
  if (length > 8 || offset + length > bytes.length) return null;
  let value = preserveMarker ? first : first & (marker - 1);
  let unknown = !preserveMarker && (first & (marker - 1)) === marker - 1;
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + bytes[offset + index];
    if (!preserveMarker && bytes[offset + index] !== 0xff) unknown = false;
  }
  return { value, length, unknown };
}

function readUnsigned(bytes: Uint8Array, start: number, end: number) {
  if (end <= start || end - start > 4) return null;
  let value = 0;
  for (let offset = start; offset < end; offset += 1) value = value * 256 + bytes[offset];
  return value > 0 ? value : null;
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function uint24(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

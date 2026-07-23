export const descriptionColors = ["default", "green", "blue", "gold", "red", "purple", "gray"] as const;
export const descriptionTextSizes = ["small", "normal", "large", "xlarge"] as const;
export const descriptionTextSizePxRange = { min: 8, max: 72 } as const;
export const descriptionFonts = [
  "default", "serif", "mono", "callifont", "memoment", "graceSerif", "jejuDoldam", "gmarketSans",
  "pretendard", "bmDohyeon", "monaSans", "sbAggro", "ownglyphDahyeon", "paperlogy",
] as const;
export type DescriptionColor = typeof descriptionColors[number];
export type DescriptionTextSize = typeof descriptionTextSizes[number];
export type DescriptionFont = typeof descriptionFonts[number];
export const descriptionFontLabels: Record<DescriptionFont, string> = {
  default: "기본 글꼴",
  serif: "명조체",
  mono: "고정폭",
  callifont: "캘리폰트 샤피",
  memoment: "메모먼트 꾸꾸꾸체",
  graceSerif: "우아한 세리프",
  jejuDoldam: "EF 제주돌담",
  gmarketSans: "G마켓 산스 Bold",
  pretendard: "Pretendard Bold",
  bmDohyeon: "배민 도현체",
  monaSans: "Mona Sans 12 KR",
  sbAggro: "SB 어그로 Bold",
  ownglyphDahyeon: "온글잎 박다현체",
  paperlogy: "페이퍼로지 7 Bold",
};
export const descriptionFontFamilies: Record<DescriptionFont, string | null> = {
  default: null,
  serif: 'Georgia,"Noto Serif KR",serif',
  mono: "ui-monospace,SFMono-Regular,Menlo,monospace",
  callifont: "MKRCallifontSharpie",
  memoment: "MKRMemomentKkukkukk",
  graceSerif: "MKRGraceSerif",
  jejuDoldam: "MKRJejuDoldam",
  gmarketSans: "MKRGmarketSans",
  pretendard: "MKRPretendard",
  bmDohyeon: "MKRBmDohyeon",
  monaSans: "MKRMonaSans12KR",
  sbAggro: "MKRSbAggro",
  ownglyphDahyeon: "MKROwnglyphDahyeon",
  paperlogy: "MKRPaperlogy7",
};
export type DescriptionAlign = "left" | "center" | "right" | "justify";
export type DescriptionTextRun = {
  text: string;
  color: DescriptionColor;
  size: DescriptionTextSize;
  sizePx: number | null;
  font: DescriptionFont;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  href: string;
};
export type DescriptionTextBlock = {
  id: string;
  type: "paragraph" | "heading" | "quote";
  text: string;
  runs: DescriptionTextRun[];
  align: DescriptionAlign;
  level?: 2 | 3;
};
export type DescriptionListBlock = {
  id: string;
  type: "bulletList" | "orderedList";
  items: DescriptionTextRun[][];
  align: DescriptionAlign;
};
export type DescriptionPosterBlock = {
  id: string;
  type: "poster";
  assetId: string;
  alt: string;
  caption: string;
  size: "normal" | "wide";
};
export type DescriptionDividerBlock = { id: string; type: "divider" };
export type DescriptionBlock = DescriptionTextBlock | DescriptionListBlock | DescriptionPosterBlock | DescriptionDividerBlock;
export type DescriptionDocument = { version: 1; blocks: DescriptionBlock[] };

const colorSet = new Set<string>(descriptionColors);
const sizeSet = new Set<string>(descriptionTextSizes);
const fontSet = new Set<string>(descriptionFonts);
const alignSet = new Set<string>(["left", "center", "right", "justify"]);
const textTypeSet = new Set<string>(["paragraph", "heading", "quote"]);
const listTypeSet = new Set<string>(["bulletList", "orderedList"]);

export function emptyDescriptionDocument(): DescriptionDocument {
  return { version: 1, blocks: [{ id: "intro-main", type: "paragraph", text: "", runs: [emptyRun()], align: "left" }] };
}

export function defaultDescriptionDocument(text: string): DescriptionDocument {
  const paragraphs = text.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean).slice(0, 40);
  if (!paragraphs.length) return emptyDescriptionDocument();
  return {
    version: 1,
    blocks: paragraphs.map((value, index) => ({
      id: `legacy-${index}`,
      type: index === 0 && value.length <= 120 ? "heading" : "paragraph",
      level: 2,
      text: value,
      runs: [{ ...emptyRun(), text: value, bold: index === 0 && value.length <= 120 }],
      align: "left",
    })),
  };
}

export function parseDescriptionDocument(value: unknown, fallbackText = ""): DescriptionDocument {
  if (value == null || value === "") return defaultDescriptionDocument(fallbackText);
  let raw = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return defaultDescriptionDocument(fallbackText); }
  }
  if (!raw || typeof raw !== "object") throw new Error("서버 소개 문서 형식이 올바르지 않습니다.");
  const source = raw as Record<string, unknown>;
  if (source.version !== 1 || !Array.isArray(source.blocks)) throw new Error("지원하지 않는 서버 소개 문서입니다.");
  if (source.blocks.length < 1 || source.blocks.length > 120) throw new Error("소개 문서는 최대 120개 문단까지 사용할 수 있습니다.");
  let totalText = 0;
  let posterCount = 0;
  let listItemCount = 0;
  const ids = new Set<string>();
  const blocks = source.blocks.map((item, index): DescriptionBlock => {
    if (!item || typeof item !== "object") throw new Error(`${index + 1}번째 소개 내용을 확인해 주세요.`);
    const block = item as Record<string, unknown>;
    const id = cleanId(block.id, index);
    if (ids.has(id)) throw new Error("소개 문단 ID가 중복되었습니다.");
    ids.add(id);
    if (textTypeSet.has(String(block.type))) {
      const type = block.type as DescriptionTextBlock["type"];
      const limit = type === "heading" ? 300 : type === "quote" ? 1500 : 5000;
      const runs = parseTextRuns(block, limit);
      const text = runs.map((run) => run.text).join("");
      totalText += text.length;
      assertTotalText(totalText);
      return {
        id, type, text, runs,
        align: cleanAlign(block.align),
        ...(type === "heading" ? { level: block.level === 3 ? 3 as const : 2 as const } : {}),
      };
    }
    if (listTypeSet.has(String(block.type))) {
      if (!Array.isArray(block.items) || block.items.length < 1 || block.items.length > 100) throw new Error("목록은 1-100개 항목까지 사용할 수 있습니다.");
      listItemCount += block.items.length;
      if (listItemCount > 200) throw new Error("소개 문서의 목록 항목은 최대 200개까지 사용할 수 있습니다.");
      const items = block.items.map((runs, itemIndex) => {
        const parsed = parseRunArray(runs, 1500, `${itemIndex + 1}번째 목록`);
        totalText += parsed.map((run) => run.text).join("").length;
        assertTotalText(totalText);
        return parsed;
      });
      return { id, type: block.type as DescriptionListBlock["type"], items, align: cleanAlign(block.align) };
    }
    if (block.type === "poster") {
      posterCount += 1;
      if (posterCount > 12) throw new Error("홍보 포스터는 최대 12장까지 사용할 수 있습니다.");
      const assetId = typeof block.assetId === "string" ? block.assetId : "";
      if (!/^[a-f0-9]{32}$/.test(assetId)) throw new Error("홍보 포스터 파일을 확인해 주세요.");
      return {
        id, type: "poster", assetId,
        alt: cleanText(block.alt, 160, "포스터 대체 문구", false),
        caption: optionalText(block.caption, 200),
        size: block.size === "normal" ? "normal" : "wide",
      };
    }
    if (block.type === "divider") return { id, type: "divider" };
    throw new Error("허용되지 않은 서버 소개 내용입니다.");
  });
  return { version: 1, blocks };
}

export function readDescriptionDocument(value: unknown, fallbackText = "") {
  try { return parseDescriptionDocument(value, fallbackText); }
  catch { return defaultDescriptionDocument(fallbackText); }
}

export function descriptionPlainText(document: DescriptionDocument) {
  return document.blocks.flatMap((block) => {
    if (block.type === "poster") return [block.alt, block.caption];
    if (block.type === "divider") return [];
    if ("items" in block) {
      return block.items.map((runs, index) => `${block.type === "bulletList" ? "•" : `${index + 1}.`} ${runs.map((run) => run.text).join("")}`);
    }
    return [block.text];
  }).filter(Boolean).join("\n\n").trim().slice(0, 10_000);
}

export function descriptionTextRuns(block: DescriptionTextBlock): DescriptionTextRun[] {
  return block.runs?.length ? block.runs : [{ ...emptyRun(), text: block.text }];
}

export function descriptionPosterIds(document: DescriptionDocument) {
  return [...new Set(document.blocks.flatMap((block) => block.type === "poster" && /^[a-f0-9]{32}$/.test(block.assetId) ? [block.assetId] : []))];
}

export function replaceDescriptionPosterIds(document: DescriptionDocument, replacements: Record<string, string>): DescriptionDocument {
  return { version: 1, blocks: document.blocks.map((block) => block.type === "poster" && replacements[block.assetId]
    ? { ...block, assetId: replacements[block.assetId] }
    : block) };
}

export function withoutDraftDescriptionPosters(document: DescriptionDocument): DescriptionDocument {
  const blocks = document.blocks.filter((block) => block.type !== "poster" || /^[a-f0-9]{32}$/.test(block.assetId));
  return { version: 1, blocks: blocks.length ? blocks : emptyDescriptionDocument().blocks };
}

function parseTextRuns(block: Record<string, unknown>, limit: number): DescriptionTextRun[] {
  if (!Array.isArray(block.runs)) {
    const text = cleanText(block.text, limit, "소개 문구", true);
    return [{
      ...emptyRun(), text,
      color: colorSet.has(String(block.color)) ? block.color as DescriptionColor : "default",
      bold: block.bold === true,
      italic: block.italic === true,
      underline: block.underline === true,
    }];
  }
  return parseRunArray(block.runs, limit, "소개 문구");
}

function parseRunArray(value: unknown, limit: number, label: string): DescriptionTextRun[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 600) throw new Error(`${label}의 글자 서식을 확인해 주세요.`);
  let length = 0;
  const runs: DescriptionTextRun[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error(`${label}의 글자 서식을 확인해 주세요.`);
    const run = item as Record<string, unknown>;
    if (typeof run.text !== "string") throw new Error(`${label}를 확인해 주세요.`);
    const text = run.text.replace(/\r\n?/g, "\n");
    if (!text) continue;
    length += text.length;
    if (length > limit) throw new Error(`${label}는 ${limit.toLocaleString("ko-KR")}자까지 입력할 수 있습니다.`);
    const normalized: DescriptionTextRun = {
      text,
      color: colorSet.has(String(run.color)) ? run.color as DescriptionColor : "default",
      size: sizeSet.has(String(run.size)) ? run.size as DescriptionTextSize : "normal",
      sizePx: normalizeDescriptionTextSizePx(run.sizePx),
      font: fontSet.has(String(run.font)) ? run.font as DescriptionFont : "default",
      bold: run.bold === true,
      italic: run.italic === true,
      underline: run.underline === true,
      strike: run.strike === true,
      href: cleanHttps(run.href),
    };
    const previous = runs.at(-1);
    if (previous && sameRunStyle(previous, normalized)) previous.text += text;
    else runs.push(normalized);
  }
  return runs.length ? runs : [emptyRun()];
}

function emptyRun(): DescriptionTextRun {
  return { text: "", color: "default", size: "normal", sizePx: null, font: "default", bold: false, italic: false, underline: false, strike: false, href: "" };
}

function sameRunStyle(left: DescriptionTextRun, right: DescriptionTextRun) {
  return left.color === right.color && left.size === right.size && left.sizePx === right.sizePx && left.font === right.font && left.bold === right.bold
    && left.italic === right.italic && left.underline === right.underline && left.strike === right.strike && left.href === right.href;
}

export function normalizeDescriptionTextSizePx(value: unknown): number | null {
  const size = typeof value === "string" && value.trim() ? Number(value) : typeof value === "number" ? value : Number.NaN;
  return Number.isInteger(size) && size >= descriptionTextSizePxRange.min && size <= descriptionTextSizePxRange.max ? size : null;
}

function cleanAlign(value: unknown): DescriptionAlign {
  return alignSet.has(String(value)) ? value as DescriptionAlign : "left";
}

function cleanId(value: unknown, index: number) {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{3,80}$/.test(id) ? id : `block-${index}`;
}

function cleanText(value: unknown, max: number, label: string, allowEmpty: boolean) {
  if (typeof value !== "string") throw new Error(`${label}를 입력해 주세요.`);
  const text = value.replace(/\r\n?/g, "\n");
  if ((!allowEmpty && !text.trim()) || text.length > max) throw new Error(`${label}는 ${allowEmpty ? `최대 ${max.toLocaleString("ko-KR")}` : `1-${max.toLocaleString("ko-KR")}`}자로 입력해 주세요.`);
  return text;
}

function optionalText(value: unknown, max: number) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw new Error("포스터 설명을 확인해 주세요.");
  return value.replace(/\r\n?/g, "\n").trim().slice(0, max);
}

function cleanHttps(value: unknown) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.length > 500) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch { return ""; }
}

function assertTotalText(length: number) {
  if (length > 10_000) throw new Error("서버 소개 글은 전체 10,000자까지 입력할 수 있습니다.");
}

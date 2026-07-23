"use client";
import { useEffect, useRef, useState } from "react";
import { mergeAttributes, Node as TiptapNode } from "@tiptap/core";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, type Editor, type JSONContent, type NodeViewProps, useEditor } from "@tiptap/react";
import * as Select from "@radix-ui/react-select";
import StarterKit from "@tiptap/starter-kit";
import Color from "@tiptap/extension-color";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Check, ChevronDown, ChevronUp, GripHorizontal, ImagePlus,
  Italic, Link2, List, ListOrdered, Minus, Quote, Redo2, RemoveFormatting, ShieldCheck,
  Strikethrough, Underline, Undo2, Unlink2,
} from "lucide-react";
import {
  descriptionColors, descriptionFontFamilies, descriptionFontLabels, descriptionFonts, descriptionPlainText, descriptionTextSizePxRange,
  normalizeDescriptionTextSizePx, type DescriptionAlign,
  type DescriptionBlock, type DescriptionColor, type DescriptionDocument, type DescriptionFont,
  type DescriptionListBlock, type DescriptionTextBlock, type DescriptionTextRun, type DescriptionTextSize,
} from "@/lib/server-description";

export type DescriptionPosterUpload = { assetId: string; url: string; alt: string };

type Props = {
  document: DescriptionDocument;
  disabled?: boolean;
  serverId?: string;
  onChange: (document: DescriptionDocument) => void;
  onMessage: (message: string) => void;
  onUploadPoster?: (file: File) => Promise<DescriptionPosterUpload>;
  posterUrl?: (assetId: string) => string;
};

const colorValues: Record<DescriptionColor, string | null> = {
  default: null, green: "#22a56f", blue: "#4f86c7", gold: "#b47d2c", red: "#c25959", purple: "#8a6db1", gray: "#738090",
};
const colorLabels: Record<DescriptionColor, string> = {
  default: "기본색", green: "초록", blue: "파랑", gold: "금색", red: "빨강", purple: "보라", gray: "회색",
};
const sizeValues: Record<DescriptionTextSize, string | null> = { small: "0.82em", normal: null, large: "1.2em", xlarge: "1.5em" };
const fontValues = descriptionFontFamilies;
type DescriptionToolbarOption = { value: string; label: string; sample: string; previewClass: string };
const blockTypeOptions: readonly DescriptionToolbarOption[] = [
  { value: "paragraph", label: "본문", sample: "일반적인 서버 소개 본문", previewClass: "preview-paragraph" },
  { value: "heading2", label: "큰 제목", sample: "서버의 핵심 제목", previewClass: "preview-heading-large" },
  { value: "heading3", label: "작은 제목", sample: "세부 항목 제목", previewClass: "preview-heading-small" },
  { value: "quote", label: "인용문", sample: "강조해서 보여줄 인용문", previewClass: "preview-quote" },
];
const textSizeOptions: readonly DescriptionToolbarOption[] = [
  { value: "small", label: "작게", sample: "가나다라마바사 Aa 123", previewClass: "preview-size-small" },
  { value: "normal", label: "기본 크기", sample: "가나다라마바사 Aa 123", previewClass: "preview-size-normal" },
  { value: "large", label: "크게", sample: "가나다라마바사 Aa 123", previewClass: "preview-size-large" },
  { value: "xlarge", label: "아주 크게", sample: "가나다라마바사 Aa 123", previewClass: "preview-size-xlarge" },
];

const DescriptionPosterNode = TiptapNode.create({
  name: "descriptionPoster",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      assetId: { default: "" },
      src: { default: "" },
      alt: { default: "서버 홍보 포스터" },
      caption: { default: "" },
      size: { default: "wide" },
    };
  },
  parseHTML() { return [{ tag: "figure[data-description-poster]" }]; },
  addNodeView() { return ReactNodeViewRenderer(DescriptionPosterView); },
  renderHTML({ HTMLAttributes }) {
    const { src, alt, caption, assetId, size } = HTMLAttributes;
    return ["figure", mergeAttributes({ "data-description-poster": assetId, class: `editor-inline-poster ${size === "normal" ? "normal" : "wide"}` }),
      ["img", { src, alt }], ["figcaption", {}, caption || "포스터를 클릭한 뒤 Delete 키로 제거할 수 있습니다."]];
  },
});

function DescriptionPosterView({ node, selected }: NodeViewProps) {
  const { src, alt, caption, assetId, size } = node.attrs as { src: string; alt: string; caption: string; assetId: string; size: string };
  const [collapsed, setCollapsed] = useState(false);
  return <NodeViewWrapper
    as="figure"
    data-description-poster={assetId}
    className={`editor-inline-poster ${size === "normal" ? "normal" : "wide"}${collapsed ? " editor-collapsed" : ""}${selected ? " ProseMirror-selectednode" : ""}`}
  >
    <div className="poster-node-toolbar">
      <div className="poster-drag-handle" data-drag-handle title="마우스로 잡고 원하는 문단 사이로 이동">
        <GripHorizontal size={15} /><span>잡아서 문단 사이로 이동</span>
      </div>
      <button
        type="button"
        className="poster-collapse-button"
        aria-expanded={!collapsed}
        aria-label={collapsed ? `${alt} 사진 펼치기` : `${alt} 사진을 편집기에서만 접기`}
        title={collapsed ? "사진 펼치기" : "사진을 편집기에서만 접기"}
        draggable={false}
        onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onClick={(event) => { event.stopPropagation(); setCollapsed((value) => !value); }}
      >
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        <span>{collapsed ? "사진 펼치기" : "편집기에서 접기"}</span>
      </button>
    </div>
    {/* User-uploaded R2 assets are already resized and served by the application route. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} alt={alt} draggable={false} />
    {collapsed
      ? <figcaption><b>{alt}</b><span>사진은 저장·공개 상태 그대로 유지됩니다.</span></figcaption>
      : <figcaption>{caption || "위 손잡이로 위치 이동 · 포스터를 선택하고 Delete 키로 제거"}</figcaption>}
  </NodeViewWrapper>;
}

const extensions = [
  StarterKit.configure({
    code: false,
    codeBlock: false,
    heading: { levels: [2, 3] },
    listKeymap: false,
    link: { openOnClick: false, autolink: false, linkOnPaste: false, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } },
    trailingNode: false,
  }),
  TextStyle,
  Color.configure({ types: ["textStyle"] }),
  FontSize.configure({ types: ["textStyle"] }),
  FontFamily.configure({ types: ["textStyle"] }),
  TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
  Placeholder.configure({ placeholder: "서버 콘텐츠, 운영 방식, 접속 안내를 자유롭게 작성하세요. 이미지도 본문 원하는 위치에 바로 넣을 수 있습니다." }),
  DescriptionPosterNode,
];

export function ServerDescriptionEditor({ document, disabled, serverId, onChange, onMessage, onUploadPoster, posterUrl }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const onChangeRef = useRef(onChange);
  const onMessageRef = useRef(onMessage);
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<{ tone: "working" | "success" | "error"; text: string } | null>(null);
  const [, setRevision] = useState(0);
  const resolvePoster = (assetId: string) => posterUrl?.(assetId) ?? (serverId ? `/api/servers/${serverId}/description-assets/${assetId}` : "");

  const editor = useEditor({
    extensions,
    content: documentToEditorJson(document, resolvePoster),
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "full-description-content", spellcheck: "true", "aria-label": "서버 상세 소개 편집" },
      handleTextInput(view, from, to, text) {
        if (view.state.doc.textContent.length - (to - from) + text.length <= 10_000) return false;
        onMessageRef.current("서버 소개는 전체 10,000자까지 입력할 수 있습니다.");
        return true;
      },
      handlePaste(_view, event) {
        const current = editorRef.current;
        if (!current) return false;
        const clipboard = event.clipboardData;
        if (!clipboard) return false;
        event.preventDefault();
        if (clipboard.files.length) {
          onMessageRef.current("이미지는 상단의 ‘이미지’ 버튼으로 추가해 주세요.");
          return true;
        }
        const source = clipboard.getData("text/plain").replace(/\r\n?/g, "\n");
        const currentLength = current.getText({ blockSeparator: "\n" }).length;
        const selectedLength = current.state.selection.to - current.state.selection.from;
        const accepted = source.slice(0, Math.max(0, 10_000 - currentLength + selectedLength));
        current.chain().focus().insertContent(plainTextContent(accepted)).run();
        if (accepted.length < source.length) onMessageRef.current("10,000자 제한에 맞춰 일부 내용만 붙여 넣었습니다.");
        else if (clipboard.getData("text/html")) onMessageRef.current("외부 HTML 서식을 제거하고 안전한 일반 글자로 붙여 넣었습니다.");
        return true;
      },
      handleDrop(_view, event, _slice, moved) {
        // ProseMirror serializes an internally dragged node as text/html too.
        // Let its native drop pipeline reposition the selected poster node;
        // only reject content that actually came from outside the editor.
        if (moved) return false;
        if (!event.dataTransfer?.files.length && !event.dataTransfer?.getData("text/html")) return false;
        event.preventDefault();
        onMessageRef.current("외부 HTML·파일 드롭은 차단됩니다. 이미지는 에디터의 이미지 버튼을 이용해 주세요.");
        return true;
      },
    },
    onCreate({ editor: current }) { editorRef.current = current; },
    onDestroy() { editorRef.current = null; },
    onUpdate({ editor: current }) {
      onChangeRef.current(editorJsonToDocument(current.getJSON()));
      setRevision((value) => value + 1);
    },
    onSelectionUpdate() { setRevision((value) => value + 1); },
    onTransaction() { setRevision((value) => value + 1); },
  }, []);

  useEffect(() => { editor?.setEditable(!disabled); }, [disabled, editor]);
  useEffect(() => { onChangeRef.current = onChange; onMessageRef.current = onMessage; }, [onChange, onMessage]);

  async function uploadPoster(file: File) {
    if (!editor || uploading) return;
    setUploading(true);
    setUploadNotice({ tone: "working", text: "이미지 크기와 비율을 확인하고 있습니다…" });
    try {
      const prepared = await prepareDescriptionPoster(file);
      setUploadNotice({
        tone: "working",
        text: prepared.resized
          ? `${prepared.originalWidth.toLocaleString()}×${prepared.originalHeight.toLocaleString()} → ${prepared.width.toLocaleString()}×${prepared.height.toLocaleString()} 비율 유지 자동 축소 · 업로드 중…`
          : `${prepared.width.toLocaleString()}×${prepared.height.toLocaleString()} 원본 크기로 업로드 중…`,
      });
      let uploaded: DescriptionPosterUpload;
      if (onUploadPoster) uploaded = await onUploadPoster(prepared.file);
      else {
        if (!serverId) throw new Error("이미지를 저장할 서버 정보가 없습니다.");
        const form = new FormData();
        form.set("poster", prepared.file);
        const response = await fetch(`/api/servers/${serverId}/description-assets`, { method: "POST", body: form });
        const body = await response.json().catch(() => ({})) as { asset?: { id: string; url: string }; error?: string };
        if (!response.ok || !body.asset) {
          if (response.status === 401) throw new Error(body.error ?? "로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");
          throw new Error(body.error ?? `이미지 업로드에 실패했습니다. (응답 ${response.status})`);
        }
        uploaded = { assetId: body.asset.id, url: body.asset.url, alt: cleanPosterName(file.name) };
      }
      const inserted = editor.chain().focus().insertContent({ type: "descriptionPoster", attrs: { assetId: uploaded.assetId, src: uploaded.url, alt: uploaded.alt, caption: "", size: "wide" } }).run();
      if (!inserted) throw new Error("이미지는 업로드됐지만 본문에 넣지 못했습니다. 다시 시도해 주세요.");
      setUploadNotice({
        tone: "success",
        text: prepared.resized
          ? `삽입 완료 · 원본 비율로 ${prepared.width.toLocaleString()}×${prepared.height.toLocaleString()} 자동 축소됨`
          : `삽입 완료 · 작은 이미지는 ${prepared.width.toLocaleString()}×${prepared.height.toLocaleString()} 원본 유지`,
      });
      onMessage("소개문 안에 이미지를 삽입했습니다. 저장 버튼을 눌러 공개하세요.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "이미지 업로드에 실패했습니다.";
      setUploadNotice({ tone: "error", text: message });
      onMessage(message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const blockType = activeBlockType(editor);
  const selectedColor = activeColor(editor);
  const selectedSize = activeSize(editor);
  const selectedSizePx = activeSizePx(editor);
  const selectedFont = activeFont(editor);
  const plainLength = descriptionPlainText(document).length;

  return <section className="full-description-editor">
    <header><div><span>FULL WYSIWYG EDITOR</span><h3>서버 상세 소개</h3><p>문단을 따로 만들 필요 없이 하나의 편집창에서 게시글처럼 바로 작성합니다.</p></div><div className="description-editor-security"><ShieldCheck size={17} /><span><b>HTML 소스 편집 차단</b><small>허용된 글·목록·링크·이미지만 구조화 저장</small></span></div></header>
    <div className="full-editor-toolbar" aria-label="서버 소개 서식 도구">
      <div className="toolbar-group history"><FormatButton label="실행 취소" disabled={disabled || !editor?.can().undo()} onRun={() => editor?.chain().focus().undo().run()}><Undo2 size={15} /></FormatButton><FormatButton label="다시 실행" disabled={disabled || !editor?.can().redo()} onRun={() => editor?.chain().focus().redo().run()}><Redo2 size={15} /></FormatButton></div>
      <div className="toolbar-group selectors"><DescriptionToolbarSelect label="문단 형식" value={blockType} disabled={disabled || !editor} options={blockTypeOptions} onValueChange={(value) => applyBlockType(editor, value)} /><DescriptionFontPicker value={selectedFont} disabled={disabled || !editor} onValueChange={(font) => applyFont(editor, font)} /><DescriptionSizePicker key={`size-${selectedSizePx ?? selectedSize}`} preset={selectedSize} sizePx={selectedSizePx} disabled={disabled || !editor} onPresetChange={(value) => applySize(editor, value)} onPxChange={(value) => { applyCustomSize(editor, value); onMessage(`글자 크기를 ${value}px로 적용했습니다.`); }} onInvalid={() => onMessage(`${descriptionTextSizePxRange.min}-${descriptionTextSizePxRange.max}px 사이의 정수를 입력해 주세요.`)} /></div>
      <div className="toolbar-group marks"><FormatButton label="굵게" active={Boolean(editor?.isActive("bold"))} disabled={disabled || !editor} onRun={() => editor?.chain().focus().toggleBold().run()}><Bold size={15} /></FormatButton><FormatButton label="기울임" active={Boolean(editor?.isActive("italic"))} disabled={disabled || !editor} onRun={() => editor?.chain().focus().toggleItalic().run()}><Italic size={15} /></FormatButton><FormatButton label="밑줄" active={Boolean(editor?.isActive("underline"))} disabled={disabled || !editor} onRun={() => editor?.chain().focus().toggleUnderline().run()}><Underline size={15} /></FormatButton><FormatButton label="취소선" active={Boolean(editor?.isActive("strike"))} disabled={disabled || !editor} onRun={() => editor?.chain().focus().toggleStrike().run()}><Strikethrough size={15} /></FormatButton><FormatButton label="서식 지우기" disabled={disabled || !editor} onRun={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}><RemoveFormatting size={15} /></FormatButton></div>
      <div className="toolbar-group color-palette" aria-label="글자색">{descriptionColors.map((color) => <button key={color} type="button" title={colorLabels[color]} aria-label={colorLabels[color]} aria-pressed={selectedColor === color} className={selectedColor === color ? `active color-${color}` : `color-${color}`} disabled={disabled || !editor} onMouseDown={(event) => { event.preventDefault(); applyColor(editor, color); }} onClick={(event) => { if (event.detail === 0) applyColor(editor, color); }}><span /></button>)}</div>
      <div className="toolbar-group align"><FormatButton label="왼쪽 정렬" active={Boolean(editor?.isActive({ textAlign: "left" }))} disabled={disabled || !editor} onRun={() => editor?.chain().focus().setTextAlign("left").run()}><AlignLeft size={15} /></FormatButton><FormatButton label="가운데 정렬" active={Boolean(editor?.isActive({ textAlign: "center" }))} disabled={disabled || !editor} onRun={() => editor?.chain().focus().setTextAlign("center").run()}><AlignCenter size={15} /></FormatButton><FormatButton label="오른쪽 정렬" active={Boolean(editor?.isActive({ textAlign: "right" }))} disabled={disabled || !editor} onRun={() => editor?.chain().focus().setTextAlign("right").run()}><AlignRight size={15} /></FormatButton><FormatButton label="양쪽 정렬" active={Boolean(editor?.isActive({ textAlign: "justify" }))} disabled={disabled || !editor} onRun={() => editor?.chain().focus().setTextAlign("justify").run()}><AlignJustify size={15} /></FormatButton></div>
      <div className="toolbar-group lists"><FormatButton label="글머리 기호 목록" active={Boolean(editor?.isActive("bulletList"))} disabled={disabled || !editor} onRun={() => editor?.chain().focus().toggleBulletList().run()}><List size={15} /></FormatButton><FormatButton label="번호 목록" active={Boolean(editor?.isActive("orderedList"))} disabled={disabled || !editor} onRun={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></FormatButton></div>
      <div className="toolbar-group inserts"><FormatButton label="링크 연결" disabled={disabled || !editor} onRun={() => editLink(editor, onMessage)}><Link2 size={15} /></FormatButton><FormatButton label="링크 해제" disabled={disabled || !editor || !editor.isActive("link")} onRun={() => editor?.chain().focus().unsetLink().run()}><Unlink2 size={15} /></FormatButton><FormatButton label="인용문" active={Boolean(editor?.isActive("blockquote"))} disabled={disabled || !editor} onRun={() => editor?.chain().focus().toggleBlockquote().run()}><Quote size={15} /></FormatButton><FormatButton label="구분선 삽입" disabled={disabled || !editor} onRun={() => editor?.chain().focus().setHorizontalRule().run()}><Minus size={15} /></FormatButton><button type="button" className="editor-image-button" disabled={disabled || uploading || !editor} onClick={() => fileRef.current?.click()}><ImagePlus size={15} /> <span>{uploading ? "업로드 중" : "이미지"}</span></button><input ref={fileRef} className="editor-image-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || uploading || !editor} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPoster(file); }} /></div>
    </div>
    <div className="full-editor-canvas"><EditorContent editor={editor} /></div>
    {uploadNotice && <div className={`description-image-upload-notice ${uploadNotice.tone}`} role="status" aria-live="polite"><ImagePlus size={14} /><span>{uploadNotice.text}</span></div>}
    <footer><span><ShieldCheck size={13} /> 외부 HTML 붙여넣기는 일반 글자로 변환됩니다. 큰 이미지는 비율 유지 자동 축소, 작은 이미지는 원본 유지됩니다.</span><b>{plainLength.toLocaleString()} / 10,000자</b></footer>
  </section>;
}

function DescriptionFontPicker({ value, disabled, onValueChange }: { value: DescriptionFont; disabled: boolean; onValueChange: (font: DescriptionFont) => void }) {
  const renderItems = (fonts: readonly DescriptionFont[]) => fonts.map((font) => <Select.Item className="description-font-item" key={font} value={font}>
    <Select.ItemText><span className="description-font-item-copy" style={{ fontFamily: descriptionFontFamilies[font] ?? undefined }}><b>{descriptionFontLabels[font]}</b><small>가나다라마바사 Aa 123</small></span></Select.ItemText>
    <Select.ItemIndicator className="description-font-indicator"><Check size={14} /></Select.ItemIndicator>
  </Select.Item>);
  return <Select.Root value={value} disabled={disabled} onValueChange={(font) => onValueChange(font as DescriptionFont)}>
    <Select.Trigger className="description-font-trigger" aria-label="글꼴 선택" style={{ fontFamily: descriptionFontFamilies[value] ?? undefined }}><Select.Value>{descriptionFontLabels[value]}</Select.Value><Select.Icon><ChevronDown size={14} /></Select.Icon></Select.Trigger>
    <Select.Portal><Select.Content className="description-font-content" position="popper" sideOffset={6} align="start">
      <Select.ScrollUpButton className="description-font-scroll"><ChevronUp size={14} /></Select.ScrollUpButton>
      <Select.Viewport className="description-font-viewport">
        <Select.Group><Select.Label className="description-font-label">기본 글꼴</Select.Label>{renderItems(descriptionFonts.slice(0, 3))}</Select.Group>
        <Select.Separator className="description-font-separator" />
        <Select.Group><Select.Label className="description-font-label">추가 글꼴 · 실제 미리보기</Select.Label>{renderItems(descriptionFonts.slice(3))}</Select.Group>
      </Select.Viewport>
      <Select.ScrollDownButton className="description-font-scroll"><ChevronDown size={14} /></Select.ScrollDownButton>
    </Select.Content></Select.Portal>
  </Select.Root>;
}

function DescriptionToolbarSelect({ label, value, disabled, options, onValueChange }: { label: string; value: string; disabled: boolean; options: readonly DescriptionToolbarOption[]; onValueChange: (value: string) => void }) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  return <Select.Root value={value} disabled={disabled} onValueChange={onValueChange}>
    <Select.Trigger className="description-toolbar-select-trigger" aria-label={label}><Select.Value>{selected?.label}</Select.Value><Select.Icon><ChevronDown size={14} /></Select.Icon></Select.Trigger>
    <Select.Portal><Select.Content className="description-toolbar-select-content" position="popper" sideOffset={6} align="start">
      <Select.Viewport className="description-toolbar-select-viewport">
        <Select.Group>
          <Select.Label className="description-toolbar-select-label">{label} · 실제 미리보기</Select.Label>
          {options.map((option) => <Select.Item className="description-toolbar-select-item" key={option.value} value={option.value}>
            <Select.ItemText><span className={`description-toolbar-select-copy ${option.previewClass}`}><b>{option.label}</b><small>{option.sample}</small></span></Select.ItemText>
            <Select.ItemIndicator className="description-toolbar-select-indicator"><Check size={14} /></Select.ItemIndicator>
          </Select.Item>)}
        </Select.Group>
      </Select.Viewport>
    </Select.Content></Select.Portal>
  </Select.Root>;
}

function DescriptionSizePicker({ preset, sizePx, disabled, onPresetChange, onPxChange, onInvalid }: { preset: DescriptionTextSize; sizePx: number | null; disabled: boolean; onPresetChange: (value: DescriptionTextSize) => void; onPxChange: (value: number) => void; onInvalid: () => void }) {
  const [draftPx, setDraftPx] = useState(String(sizePx ?? 16));
  const customValue = sizePx == null ? null : `custom-${sizePx}`;
  const options: readonly DescriptionToolbarOption[] = customValue
    ? [...textSizeOptions, { value: customValue, label: `${sizePx}px`, sample: `${sizePx}px 사용자 지정 크기`, previewClass: "preview-size-custom" }]
    : textSizeOptions;
  const applyDraft = () => {
    const normalized = normalizeDescriptionTextSizePx(draftPx);
    if (normalized == null) { onInvalid(); return; }
    setDraftPx(String(normalized));
    onPxChange(normalized);
  };
  return <div className="description-size-control">
    <DescriptionToolbarSelect label="글자 크기" value={customValue ?? preset} disabled={disabled} options={options} onValueChange={(value) => { if (!value.startsWith("custom-")) onPresetChange(value as DescriptionTextSize); }} />
    <div className="description-size-px-field">
      <input aria-label="직접 글자 크기(px)" title={`${descriptionTextSizePxRange.min}-${descriptionTextSizePxRange.max}px 정수 입력`} type="number" min={descriptionTextSizePxRange.min} max={descriptionTextSizePxRange.max} step={1} inputMode="numeric" value={draftPx} disabled={disabled} onChange={(event) => setDraftPx(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyDraft(); } }} />
      <span aria-hidden="true">PX</span>
    </div>
    <button type="button" className="description-size-apply" disabled={disabled} aria-label="직접 글자 크기 적용" title={`${descriptionTextSizePxRange.min}-${descriptionTextSizePxRange.max}px 적용`} onClick={applyDraft}><Check size={13} /><span>적용</span></button>
  </div>;
}

const descriptionPosterMaxWidth = 1600;
const descriptionPosterMaxHeight = 12_000;
const descriptionPosterMaxPixels = 11_500_000;
const descriptionPosterMaxBytes = 8 * 1024 * 1024;

async function prepareDescriptionPoster(file: File) {
  const supported = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!supported.has(file.type)) throw new Error("본문 이미지는 PNG, JPG, WebP만 사용할 수 있습니다.");
  if (file.size < 32 || file.size > 32 * 1024 * 1024) throw new Error("원본 이미지는 최대 32MB까지 자동 처리할 수 있습니다.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("이미지 파일을 읽을 수 없습니다. 손상되지 않은 PNG, JPG, WebP인지 확인해 주세요.");
  }
  try {
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    const pixelScale = Math.sqrt(descriptionPosterMaxPixels / (originalWidth * originalHeight));
    const scale = Math.min(1, descriptionPosterMaxWidth / originalWidth, descriptionPosterMaxHeight / originalHeight, pixelScale);
    const width = Math.max(1, Math.floor(originalWidth * scale));
    const height = Math.max(1, Math.floor(originalHeight * scale));
    if (scale === 1 && file.size <= descriptionPosterMaxBytes) {
      return { file, originalWidth, originalHeight, width, height, resized: false };
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("브라우저에서 이미지 축소 기능을 사용할 수 없습니다.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    let blob = await canvasBlob(canvas, "image/webp", 0.92);
    if (blob.size > descriptionPosterMaxBytes) blob = await canvasBlob(canvas, "image/webp", 0.8);
    if (blob.size > descriptionPosterMaxBytes) throw new Error("자동 축소 후에도 8MB를 넘습니다. 원본 해상도를 조금 줄여 주세요.");
    const baseName = cleanPosterName(file.name) || "server-description";
    return {
      file: new File([blob], `${baseName}.webp`, { type: "image/webp", lastModified: Date.now() }),
      originalWidth, originalHeight, width, height, resized: true,
    };
  } finally {
    bitmap.close();
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob); else reject(new Error("이미지 자동 축소에 실패했습니다."));
  }, type, quality));
}

function FormatButton({ label, active, disabled, onRun, children }: { label: string; active?: boolean; disabled?: boolean; onRun: () => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} className={active ? "active" : ""} disabled={disabled} onMouseDown={(event) => { event.preventDefault(); onRun(); }} onClick={(event) => { if (event.detail === 0) onRun(); }}>{children}</button>;
}

function applyBlockType(editor: Editor | null, value: string) {
  if (!editor) return;
  if (value === "heading2") editor.chain().focus().setHeading({ level: 2 }).run();
  else if (value === "heading3") editor.chain().focus().setHeading({ level: 3 }).run();
  else if (value === "quote") editor.chain().focus().setParagraph().toggleBlockquote().run();
  else editor.chain().focus().setParagraph().run();
}

function activeBlockType(editor: Editor | null) {
  if (editor?.isActive("heading", { level: 2 })) return "heading2";
  if (editor?.isActive("heading", { level: 3 })) return "heading3";
  if (editor?.isActive("blockquote")) return "quote";
  return "paragraph";
}

function applyColor(editor: Editor | null, color: DescriptionColor) {
  if (!editor) return;
  const value = colorValues[color];
  if (value) editor.chain().focus().setColor(value).run(); else editor.chain().focus().unsetColor().run();
}
function applySize(editor: Editor | null, size: DescriptionTextSize) {
  if (!editor) return;
  const value = sizeValues[size];
  if (value) editor.chain().focus().setFontSize(value).run(); else editor.chain().focus().unsetFontSize().run();
}
function applyCustomSize(editor: Editor | null, sizePx: number) {
  if (!editor) return;
  const normalized = normalizeDescriptionTextSizePx(sizePx);
  if (normalized != null) editor.chain().focus().setFontSize(`${normalized}px`).run();
}
function applyFont(editor: Editor | null, font: DescriptionFont) {
  if (!editor) return;
  const value = fontValues[font];
  if (value) editor.chain().focus().setFontFamily(value).run(); else editor.chain().focus().unsetFontFamily().run();
}
function activeColor(editor: Editor | null): DescriptionColor {
  const value = String(editor?.getAttributes("textStyle").color ?? "").toLowerCase();
  return (Object.entries(colorValues).find(([, item]) => item?.toLowerCase() === value)?.[0] as DescriptionColor | undefined) ?? "default";
}
function activeSize(editor: Editor | null): DescriptionTextSize {
  const value = String(editor?.getAttributes("textStyle").fontSize ?? "").toLowerCase();
  return (Object.entries(sizeValues).find(([, item]) => item?.toLowerCase() === value)?.[0] as DescriptionTextSize | undefined) ?? "normal";
}
function activeSizePx(editor: Editor | null): number | null {
  const value = String(editor?.getAttributes("textStyle").fontSize ?? "").trim().toLowerCase();
  const match = /^(\d{1,3})px$/.exec(value);
  return normalizeDescriptionTextSizePx(match?.[1]);
}
function activeFont(editor: Editor | null): DescriptionFont {
  const value = String(editor?.getAttributes("textStyle").fontFamily ?? "").toLowerCase();
  return (Object.entries(fontValues).find(([, item]) => item?.toLowerCase() === value)?.[0] as DescriptionFont | undefined) ?? "default";
}

function editLink(editor: Editor | null, onMessage: (message: string) => void) {
  if (!editor) return;
  const current = String(editor.getAttributes("link").href ?? "https://");
  const value = window.prompt("연결할 HTTPS 주소를 입력하세요.", current);
  if (value == null) return;
  if (!value.trim()) { editor.chain().focus().unsetLink().run(); return; }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") throw new Error("https required");
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.toString() }).run();
  } catch { onMessage("링크는 https://로 시작하는 안전한 주소만 사용할 수 있습니다."); }
}

function documentToEditorJson(document: DescriptionDocument, posterUrl: (assetId: string) => string): JSONContent {
  return { type: "doc", content: document.blocks.map((block) => blockToEditorNode(block, posterUrl)) };
}

function blockToEditorNode(block: DescriptionBlock, posterUrl: (assetId: string) => string): JSONContent {
  if (block.type === "divider") return { type: "horizontalRule" };
  if (block.type === "poster") return { type: "descriptionPoster", attrs: { assetId: block.assetId, src: posterUrl(block.assetId), alt: block.alt, caption: block.caption, size: block.size } };
  if ("items" in block) return {
    type: block.type,
    content: block.items.map((runs) => ({ type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: block.align }, content: runsToEditorNodes(runs) }] })),
  };
  const paragraph: JSONContent = { type: block.type === "heading" ? "heading" : "paragraph", attrs: { textAlign: block.align, ...(block.type === "heading" ? { level: block.level ?? 2 } : {}) }, content: runsToEditorNodes(block.runs) };
  return block.type === "quote" ? { type: "blockquote", content: [{ ...paragraph, type: "paragraph" }] } : paragraph;
}

function runsToEditorNodes(runs: DescriptionTextRun[]): JSONContent[] {
  return runs.flatMap((run) => run.text.split("\n").flatMap((text, index) => [...(index ? [{ type: "hardBreak" }] : []), ...(text ? [{ type: "text", text, marks: runMarks(run) }] : [])]));
}

function runMarks(run: DescriptionTextRun): JSONContent["marks"] {
  const marks: JSONContent["marks"] = [];
  if (run.bold) marks.push({ type: "bold" });
  if (run.italic) marks.push({ type: "italic" });
  if (run.underline) marks.push({ type: "underline" });
  if (run.strike) marks.push({ type: "strike" });
  if (run.href) marks.push({ type: "link", attrs: { href: run.href, target: "_blank", rel: "noopener noreferrer" } });
  const color = colorValues[run.color], fontSize = run.sizePx != null ? `${run.sizePx}px` : sizeValues[run.size], fontFamily = fontValues[run.font];
  if (color || fontSize || fontFamily) marks.push({ type: "textStyle", attrs: { ...(color ? { color } : {}), ...(fontSize ? { fontSize } : {}), ...(fontFamily ? { fontFamily } : {}) } });
  return marks;
}

function editorJsonToDocument(value: JSONContent): DescriptionDocument {
  const blocks: DescriptionBlock[] = [];
  (value.content ?? []).forEach((node, index) => {
    const id = `editor-${index}`;
    if (node.type === "horizontalRule") { blocks.push({ id, type: "divider" }); return; }
    if (node.type === "descriptionPoster") {
      blocks.push({ id, type: "poster", assetId: String(node.attrs?.assetId ?? ""), alt: String(node.attrs?.alt ?? "서버 홍보 포스터").slice(0, 160), caption: String(node.attrs?.caption ?? "").slice(0, 200), size: node.attrs?.size === "normal" ? "normal" : "wide" });
      return;
    }
    if (node.type === "bulletList" || node.type === "orderedList") {
      const items = (node.content ?? []).map((item) => editorNodeRuns(item));
      blocks.push({ id, type: node.type as DescriptionListBlock["type"], items: items.length ? items : [[emptyEditorRun()]], align: nodeAlign(node) });
      return;
    }
    if (node.type === "blockquote") {
      const runs = editorNodeRuns(node);
      blocks.push({ id, type: "quote", text: runs.map((run) => run.text).join(""), runs, align: nodeAlign(node.content?.[0] ?? node) });
      return;
    }
    if (node.type === "heading" || node.type === "paragraph") {
      const runs = editorNodeRuns(node);
      blocks.push({ id, type: node.type === "heading" ? "heading" : "paragraph", text: runs.map((run) => run.text).join(""), runs, align: nodeAlign(node), ...(node.type === "heading" ? { level: node.attrs?.level === 3 ? 3 : 2 } : {}) } as DescriptionTextBlock);
    }
  });
  return { version: 1, blocks: blocks.length ? blocks : [{ id: "editor-0", type: "paragraph", text: "", runs: [emptyEditorRun()], align: "left" }] };
}

function editorNodeRuns(node: JSONContent): DescriptionTextRun[] {
  const runs: DescriptionTextRun[] = [];
  const walk = (current: JSONContent) => {
    if (current.type === "hardBreak") { appendRun(runs, { ...emptyEditorRun(), text: "\n" }); return; }
    if (current.type === "text" && current.text) { appendRun(runs, editorTextRun(current)); return; }
    (current.content ?? []).forEach(walk);
  };
  walk(node);
  return runs.length ? runs : [emptyEditorRun()];
}

function editorTextRun(node: JSONContent): DescriptionTextRun {
  const marks = node.marks ?? [];
  const style = marks.find((mark) => mark.type === "textStyle")?.attrs ?? {};
  const link = marks.find((mark) => mark.type === "link")?.attrs?.href;
  const textSize = editorTextSize(String(style.fontSize ?? ""));
  return {
    text: node.text ?? "",
    color: entryKey(colorValues, String(style.color ?? ""), "default"),
    size: textSize.size,
    sizePx: textSize.sizePx,
    font: entryKey(fontValues, String(style.fontFamily ?? ""), "default"),
    bold: marks.some((mark) => mark.type === "bold"), italic: marks.some((mark) => mark.type === "italic"),
    underline: marks.some((mark) => mark.type === "underline"), strike: marks.some((mark) => mark.type === "strike"),
    href: safeHttps(String(link ?? "")),
  };
}

function editorTextSize(value: string): { size: DescriptionTextSize; sizePx: number | null } {
  const preset = entryKey(sizeValues, value, "normal");
  if (Object.values(sizeValues).some((item) => String(item ?? "").toLowerCase() === value.toLowerCase())) return { size: preset, sizePx: null };
  const match = /^(\d{1,3})px$/i.exec(value.trim());
  return { size: "normal", sizePx: normalizeDescriptionTextSizePx(match?.[1]) };
}

function entryKey<T extends string>(record: Record<T, string | null>, value: string, fallback: T): T {
  const normalized = value.toLowerCase();
  return (Object.entries(record).find(([, item]) => String(item ?? "").toLowerCase() === normalized)?.[0] as T | undefined) ?? fallback;
}
function appendRun(runs: DescriptionTextRun[], run: DescriptionTextRun) {
  const previous = runs.at(-1);
  if (previous && previous.color === run.color && previous.size === run.size && previous.sizePx === run.sizePx && previous.font === run.font && previous.bold === run.bold && previous.italic === run.italic && previous.underline === run.underline && previous.strike === run.strike && previous.href === run.href) previous.text += run.text;
  else runs.push(run);
}
function emptyEditorRun(): DescriptionTextRun { return { text: "", color: "default", size: "normal", sizePx: null, font: "default", bold: false, italic: false, underline: false, strike: false, href: "" }; }
function nodeAlign(node: JSONContent): DescriptionAlign { return ["center", "right", "justify"].includes(String(node.attrs?.textAlign)) ? node.attrs?.textAlign as DescriptionAlign : "left"; }
function safeHttps(value: string) { try { const url = new URL(value); return url.protocol === "https:" ? url.toString() : ""; } catch { return ""; } }
function cleanPosterName(value: string) { return value.replace(/\.[^.]+$/, "").trim().slice(0, 160) || "서버 홍보 포스터"; }
function plainTextContent(text: string): JSONContent | JSONContent[] { const lines = text.split("\n"); return lines.length === 1 ? { type: "text", text } : lines.map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : [] })); }

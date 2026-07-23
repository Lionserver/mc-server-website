"use client";

import { type KeyboardEvent, useId, useRef, useState } from "react";
import {
  SERVER_CATEGORY_ENGLISH_LIMIT,
  SERVER_CATEGORY_KOREAN_LIMIT,
  SERVER_CATEGORY_LIMIT,
  normalizeServerCategory,
  serverCategoryError,
} from "@/lib/server-categories";

type Props = {
  value: string[];
  onChange: (categories: string[]) => void;
  disabled?: boolean;
  idPrefix?: string;
};

export function ServerCategoryTags({ value, onChange, disabled = false, idPrefix = "server" }: Props) {
  const generatedId = useId();
  const inputId = `${idPrefix}-categories-${generatedId.replaceAll(":", "")}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const full = value.length >= SERVER_CATEGORY_LIMIT;

  function addCategory(rawValue = draft) {
    const category = normalizeServerCategory(rawValue);
    if (!category) return false;
    const error = serverCategoryError(category);
    if (error) {
      setMessage(error);
      return false;
    }
    if (value.some((item) => item.toLowerCase() === category.toLowerCase())) {
      setMessage("이미 추가한 카테고리입니다.");
      setDraft("");
      return false;
    }
    if (full) {
      setMessage(`카테고리는 최대 ${SERVER_CATEGORY_LIMIT}개까지 등록할 수 있습니다.`);
      return false;
    }
    onChange([...value, category]);
    setDraft("");
    setMessage("");
    return true;
  }

  function onDraftChange(nextValue: string) {
    if (!nextValue.includes(",")) {
      setDraft(nextValue);
      setMessage("");
      return;
    }
    const parts = nextValue.split(",");
    const complete = parts.slice(0, -1).map(normalizeServerCategory).filter(Boolean);
    let next = value;
    let nextMessage = "";
    for (const category of complete) {
      const error = serverCategoryError(category);
      if (error) { nextMessage = error; break; }
      if (next.some((item) => item.toLowerCase() === category.toLowerCase())) { nextMessage = "이미 추가한 카테고리입니다."; continue; }
      if (next.length >= SERVER_CATEGORY_LIMIT) { nextMessage = `카테고리는 최대 ${SERVER_CATEGORY_LIMIT}개까지 등록할 수 있습니다.`; break; }
      next = [...next, category];
    }
    if (next !== value) onChange(next);
    setDraft(parts.at(-1) ?? "");
    setMessage(nextMessage);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.key === "Enter" || event.key === ",") && !event.nativeEvent.isComposing) {
      event.preventDefault();
      addCategory();
      return;
    }
    if (event.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
      setMessage("");
    }
  }

  function removeCategory(index: number) {
    onChange(value.filter((_, itemIndex) => itemIndex !== index));
    setMessage("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  return <div className="server-category-editor">
    <div className="server-category-head">
      <label htmlFor={inputId}>서버 카테고리</label>
      <span className={full ? "full" : ""}>{value.length} / {SERVER_CATEGORY_LIMIT}</span>
    </div>
    <div className={`server-category-control${message ? " invalid" : ""}${full ? " complete" : ""}`} onClick={() => inputRef.current?.focus()}>
      {value.map((category, index) => <span className="server-category-chip" key={`${category}-${index}`}>
        {category}
        <button type="button" disabled={disabled} onClick={(event) => { event.stopPropagation(); removeCategory(index); }} aria-label={`${category} 카테고리 제거`}>×</button>
      </span>)}
      <input
        ref={inputRef}
        id={inputId}
        value={draft}
        disabled={disabled || full}
        maxLength={SERVER_CATEGORY_ENGLISH_LIMIT}
        placeholder={full ? "3개 입력 완료" : value.length === 0 ? "예: 야생" : "카테고리 추가"}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => { if (draft.trim()) addCategory(); }}
        aria-describedby={`${inputId}-guide ${inputId}-message`}
      />
      {!full && <button className="server-category-add" type="button" disabled={disabled || !draft.trim()} onClick={(event) => { event.stopPropagation(); addCategory(); }}>추가</button>}
    </div>
    <div className="server-category-meta">
      <small id={`${inputId}-guide`}>Enter 또는 쉼표로 추가 · 한글 {SERVER_CATEGORY_KOREAN_LIMIT}자 / 영문·숫자 {SERVER_CATEGORY_ENGLISH_LIMIT}자 · 최대 {SERVER_CATEGORY_LIMIT}개</small>
      <em id={`${inputId}-message`} aria-live="polite">{message}</em>
    </div>
  </div>;
}

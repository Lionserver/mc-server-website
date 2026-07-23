"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, KeyRound, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";

export default function OwnerLoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [previewCode, setPreviewCode] = useState("");
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("returnTo") ?? "/operator";
    fetch("/api/auth/session", { cache: "no-store" }).then((response) => {
      if (response.ok) window.location.replace(value.startsWith("/") && !value.startsWith("//") ? value : "/operator");
    }).catch(() => undefined);
  }, []);

  async function requestCode(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/auth/email/request", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
      });
      const body = await response.json() as { error?: string; previewCode?: string };
      if (!response.ok) throw new Error(body.error ?? "인증 코드 발송에 실패했습니다.");
      setPreviewCode(body.previewCode ?? ""); setStep("code");
      setMessage("입력한 이메일로 6자리 인증 코드를 보냈습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "인증 코드 발송 실패"); }
    finally { setBusy(false); }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/auth/email/verify", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "인증에 실패했습니다.");
      const requestedReturn = new URLSearchParams(window.location.search).get("returnTo") ?? "/operator";
      const returnTo = requestedReturn.startsWith("/") && !requestedReturn.startsWith("//") ? requestedReturn : "/operator";
      window.location.assign(returnTo);
    } catch (error) { setMessage(error instanceof Error ? error.message : "인증 실패"); setBusy(false); }
  }

  return <main className="owner-login-page">
    <section className="owner-login-card">
      <Link href="/" className="owner-login-back"><ArrowLeft size={15} /> 서버 목록</Link>
      <div className="owner-login-mark"><ShieldCheck /></div>
      <span>SERVER OWNER ACCOUNT</span><h1>이메일로 로그인</h1>
      <p>비밀번호 없이 이메일 인증 코드로 로그인합니다. 처음 로그인한 이메일은 자동으로 계정이 생성됩니다.</p>
      {step === "email" ? <form onSubmit={requestCode}>
        <label><span>운영자 이메일</span><div><Mail size={16} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="owner@example.com" required /></div></label>
        <button disabled={busy}>{busy ? "발송 중…" : "인증 코드 받기"}</button>
      </form> : <form onSubmit={verifyCode}>
        <label><span>{email}로 보낸 인증 코드</span><div><KeyRound size={16} /><input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" placeholder="000000" required /></div></label>
        {previewCode && <button type="button" className="owner-preview-code" onClick={() => setCode(previewCode)}>로컬 미리보기 코드 {previewCode} 입력</button>}
        <button disabled={busy || code.length !== 6}>{busy ? "확인 중…" : "로그인 완료"}</button>
        <button type="button" className="owner-login-secondary" onClick={() => { setStep("email"); setCode(""); setMessage(""); }}>다른 이메일 사용</button>
      </form>}
      {message && <div className="owner-login-message" role="status">{message}</div>}
      <small>인증 코드는 10분간 유효하고 5회 실패하면 새 코드를 받아야 합니다.</small>
    </section>
  </main>;
}

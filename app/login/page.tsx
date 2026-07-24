"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, KeyRound, LogIn, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { safeInternalReturnTo } from "@/lib/browser-preferences.mjs";

export default function OwnerLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [previewCode, setPreviewCode] = useState("");
  const [capabilities, setCapabilities] = useState({ checked: false, sites: false, email: false });
  useEffect(() => {
    const returnTo = safeInternalReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
    fetch("/api/auth/session", { cache: "no-store" }).then((response) => {
      if (response.ok) router.replace(returnTo);
    }).catch(() => undefined);
    fetch("/api/auth/capabilities", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { sites?: boolean; email?: boolean } : {})
      .then((available) => setCapabilities({ checked: true, sites: available.sites === true, email: available.email === true }))
      .catch(() => setCapabilities({ checked: true, sites: false, email: false }));
  }, [router]);

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
      const returnTo = safeInternalReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
      router.replace(returnTo);
    } catch (error) { setMessage(error instanceof Error ? error.message : "인증 실패"); setBusy(false); }
  }

  function startPlatformLogin() {
    const returnTo = safeInternalReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
    window.location.assign(`/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`);
  }

  return <main className="owner-login-page">
    <section className="owner-login-card">
      <Link href="/" className="owner-login-back"><ArrowLeft size={15} /> 서버 목록</Link>
      <div className="owner-login-mark"><ShieldCheck /></div>
      <span>SERVER OWNER ACCOUNT</span><h1>운영자 로그인</h1>
      <p>배포 플랫폼의 보호된 계정으로 안전하게 로그인할 수 있습니다.</p>
      {!capabilities.checked && <div className="owner-login-message" role="status">사용 가능한 로그인 방법을 확인하고 있습니다…</div>}
      {capabilities.sites && <button className="owner-platform-login" type="button" onClick={startPlatformLogin}><LogIn size={17} aria-hidden="true" /> ChatGPT로 안전하게 로그인</button>}
      {capabilities.sites && capabilities.email && <div className="owner-login-divider"><span>또는 이메일 인증 코드</span></div>}
      {capabilities.email && (step === "email" ? <form onSubmit={requestCode}>
        <label><span>운영자 이메일</span><div><Mail size={16} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="owner@example.com" required /></div></label>
        <button disabled={busy}>{busy ? "발송 중…" : "인증 코드 받기"}</button>
      </form> : <form onSubmit={verifyCode}>
        <label><span>{email}로 보낸 인증 코드</span><div><KeyRound size={16} /><input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" placeholder="000000" required /></div></label>
        {previewCode && <button type="button" className="owner-preview-code" onClick={() => setCode(previewCode)}>로컬 미리보기 코드 {previewCode} 입력</button>}
        <button disabled={busy || code.length !== 6}>{busy ? "확인 중…" : "로그인 완료"}</button>
        <button type="button" className="owner-login-secondary" onClick={() => { setStep("email"); setCode(""); setMessage(""); }}>다른 이메일 사용</button>
      </form>)}
      {capabilities.checked && !capabilities.sites && !capabilities.email
        && <div className="owner-login-message" role="alert">현재 사용할 수 있는 로그인 방법이 없습니다. 관리자에게 문의해 주세요.</div>}
      {message && <div className="owner-login-message" role="status">{message}</div>}
      {capabilities.email && <small>인증 코드는 10분간 유효하고 5회 실패하면 새 코드를 받아야 합니다.</small>}
    </section>
  </main>;
}

"use client";

import Link from "next/link";
import { LogIn, Menu, Moon, ShieldCheck, Sun, X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

export type PublicHeaderTheme = "light" | "dark";
export type PublicDirectoryView = "all" | "small" | "new";

type PublicSiteHeaderProps = {
  active: "broadcasts" | PublicDirectoryView;
  ownerSession: { email: string } | null;
  ownerSessionChecked: boolean;
  theme: PublicHeaderTheme;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  onToggleTheme: () => void;
  onRegister: () => void;
  onDirectoryViewChange?: (view: PublicDirectoryView) => void;
};

type DirectoryLinkProps = {
  active: PublicSiteHeaderProps["active"];
  view: PublicDirectoryView;
  className?: string;
  children: ReactNode;
  onDirectoryViewChange?: (view: PublicDirectoryView) => void;
  onNavigate: () => void;
};

function DirectoryLink({ active, view, className, children, onDirectoryViewChange, onNavigate }: DirectoryLinkProps) {
  const href = view === "all" ? "/#server-list" : `/?view=${view}#server-list`;
  const combinedClass = [active === view ? "active" : "", className].filter(Boolean).join(" ");
  const ariaCurrent = active === view ? "page" : undefined;
  if (!onDirectoryViewChange) return <Link className={combinedClass || undefined} href={href} aria-current={ariaCurrent} onClick={onNavigate}>{children}</Link>;
  return <a className={combinedClass || undefined} href={href} aria-current={ariaCurrent} onClick={(event) => {
    event.preventDefault();
    onDirectoryViewChange(view);
    onNavigate();
  }}>{children}</a>;
}

export function PublicSiteHeader({
  active, ownerSession, ownerSessionChecked, theme, mobileOpen,
  onMobileOpenChange, onToggleTheme, onRegister, onDirectoryViewChange,
}: PublicSiteHeaderProps) {
  const closeMobile = () => onMobileOpenChange(false);
  const mobileButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onMobileOpenChange(false);
      window.requestAnimationFrame(() => mobileButtonRef.current?.focus());
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen, onMobileOpenChange]);

  return <header className="site-header">
    <div className="container header-inner">
      <Link className="brand header-brand" href={active === "broadcasts" ? "/#top" : "#top"} aria-label="MINECRAFT SERVER LIST 홈" onClick={closeMobile}><span>MINECRAFT SERVER LIST</span></Link>
      <nav id="public-primary-navigation" className={mobileOpen ? "main-nav open" : "main-nav"} aria-label="주요 메뉴">
        <DirectoryLink active={active} view="all" onDirectoryViewChange={onDirectoryViewChange} onNavigate={closeMobile}>전체 서버</DirectoryLink>
        <DirectoryLink active={active} view="small" className="small-directory-link" onDirectoryViewChange={onDirectoryViewChange} onNavigate={closeMobile}>소규모 서버 <span>20↓</span></DirectoryLink>
        <DirectoryLink active={active} view="new" className="new-directory-link" onDirectoryViewChange={onDirectoryViewChange} onNavigate={closeMobile}>신규 서버 <span>7D</span></DirectoryLink>
        <Link className={`${active === "broadcasts" ? "active " : ""}broadcast-directory-link`} href="/broadcasts" aria-current={active === "broadcasts" ? "page" : undefined} onClick={closeMobile}>마크 방송 <span>LIVE</span></Link>
        <Link href="/operator" onClick={closeMobile}>운영자 센터</Link>
        <button className="nav-register" type="button" onClick={() => { onRegister(); closeMobile(); }}>서버 등록</button>
      </nav>
      <div className="header-actions">
        <div className="account-slot">
          {!ownerSessionChecked
            ? <span className="account-status checking"><ShieldCheck size={14} /><span>계정 확인</span></span>
            : ownerSession
              ? <Link className="account-status signed-in" href="/operator" aria-label={`${ownerSession.email} 로그인됨 · 내 서버 관리 열기`}><span className="account-live-dot" /><span><small>내 서버 관리 · 로그인됨</small><b>{ownerSession.email}</b></span></Link>
              : <Link className="account-login" href="/login"><LogIn size={15} /><span>로그인</span></Link>}
        </div>
        <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label={theme === "light" ? "다크 모드로 전환" : "라이트 모드로 전환"} aria-pressed={theme === "dark"}>
          {theme === "light" ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
          <span>{theme === "light" ? "DARK" : "LIGHT"}</span>
        </button>
        <button ref={mobileButtonRef} className="mobile-menu-button" type="button" aria-label={mobileOpen ? "메뉴 닫기" : "메뉴 열기"} aria-controls="public-primary-navigation" aria-expanded={mobileOpen} onClick={() => onMobileOpenChange(!mobileOpen)}>
          {mobileOpen ? <X size={19} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
      </div>
    </div>
  </header>;
}

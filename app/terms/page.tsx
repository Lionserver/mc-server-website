import type { Metadata } from "next";
import Link from "next/link";
import { DiscordContactWidget } from "@/components/discord-contact-widget";

export const metadata: Metadata = {
  title: "이용약관 — Minecraft.kr",
  description: "Minecraft.kr 서버 디렉터리 이용약관",
};

export default function TermsPage() {
  return <main className="policy-page"><article><Link className="policy-brand" href="/">Minecraft.kr</Link><span>TERMS OF SERVICE</span><h1>이용약관</h1><p className="policy-lead">시행일: 2026년 7월 14일</p>
    <section><h2>1. 서비스</h2><p>Minecraft.kr은 Minecraft 서버 정보, 실시간 상태, 추천 기록과 광고 노출을 제공하는 독립 서버 디렉터리입니다. Mojang 또는 Microsoft의 공식 서비스가 아닙니다.</p></section>
    <section><h2>2. 계정과 서버 관리</h2><p>운영자는 실제로 통제하는 서버만 등록해야 하며 이메일, MOTD, DNS 또는 브리지 인증 결과를 정확하게 유지해야 합니다. 계정과 인증 수단을 타인에게 대여할 수 없습니다.</p></section>
    <section><h2>3. 등록 정보와 금지 행위</h2><p>허위 정보, 타인의 권리를 침해하는 이미지, 악성 주소, 조작 추천, 자동화된 대량 요청, 서비스 보안 우회는 금지됩니다. 위반 서버는 사전 통지 없이 숨김·차단될 수 있으며 필요한 경우 소명 절차를 제공합니다.</p></section>
    <section><h2>4. 추천과 프리미엄 광고</h2><p>추천은 닉네임과 접속 환경을 기준으로 중복을 제한합니다. 프리미엄 광고는 공지된 주간 경매 규칙, 본인·서버 소유권 인증과 결제 확인을 모두 통과해야 확정됩니다. 입찰 전에 화면에 표시된 기간·슬롯·최소 인상액을 확인해야 합니다.</p></section>
    <section><h2>5. 서버 소유권 이전</h2><p>이메일 이전 신청 또는 서버 주장 기능은 실제 서버 통제권을 확인하기 위한 절차입니다. 분쟁이 발생하면 서버 수정과 광고 참여가 일시 제한되며 총관리자 심사와 감사 기록을 거쳐 처리합니다.</p></section>
    <section><h2>6. 서비스 변경과 책임</h2><p>점검, 네트워크 또는 외부 서비스 장애로 일부 기능이 중단될 수 있습니다. Minecraft.kr은 운영자가 등록한 서버의 콘텐츠·게임 플레이·거래를 보증하지 않으며, 법령이 허용하는 범위에서 직접 관리할 수 없는 손해에 대한 책임을 제한합니다.</p></section>
    <section><h2>7. 문의</h2><p>약관, 신고 또는 이의 제기는 <a href="mailto:zehelper@gmail.com">zehelper@gmail.com</a> 또는 우측 하단 Discord 문의 채널로 접수할 수 있습니다.</p></section>
    <nav><Link href="/">서버 목록으로 돌아가기</Link><Link href="/privacy">개인정보 처리방침</Link></nav>
  </article><DiscordContactWidget /></main>;
}

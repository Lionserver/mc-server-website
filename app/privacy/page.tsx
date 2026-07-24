import type { Metadata } from "next";
import Link from "next/link";
import { DiscordContactWidget } from "@/components/discord-contact-widget";

export const metadata: Metadata = {
  title: "개인정보 처리방침",
  description: "Minecraft.kr이 처리하는 개인정보, 보유기간, 파기, 처리위탁과 국외 이전에 관한 안내",
  alternates: {
    canonical: "/privacy",
  },
};

export default function PrivacyPage() {
  return <main className="policy-page"><article><Link className="policy-brand" href="/">Minecraft.kr</Link><span>PRIVACY POLICY</span><h1>개인정보 처리방침</h1>
    <p className="policy-lead">공고일·시행일: 2026년 7월 16일 · 베타 서비스 시작 전 적용</p>
    <p className="policy-intro">Minecraft.kr(이하 “서비스”)은 한국 마인크래프트 서버 목록, 서버 운영자 인증, 추천, 프리미엄 광고 경매와 운영자 문의 기능을 제공하며 필요한 범위에서만 개인정보를 처리합니다. 원문 접속 IP, 주민등록번호와 신분증 이미지는 서비스 데이터베이스에 저장하지 않습니다.</p>

    <section><h2>1. 개인정보 처리 항목·목적·보유기간</h2><div className="policy-table-wrap"><table><thead><tr><th>구분</th><th>처리 항목</th><th>이용 목적</th><th>보유기간</th></tr></thead><tbody>
      <tr><td>이메일 계정</td><td>이메일, 계정 식별자, 이메일 확인·최근 로그인 시각</td><td>로그인, 계정 보호, 서버 소유자 식별</td><td>회원 탈퇴 또는 삭제 요청 처리 시까지</td></tr>
      <tr><td>로그인 보안</td><td>인증코드 해시, 요청 환경·IP의 복구 불가능한 해시, 시도 횟수, 세션 토큰 해시</td><td>인증코드 검증, 요청 제한, 세션 유지</td><td>인증코드 기록은 사용·만료 후 최대 24시간, 로그인 세션은 최대 30일</td></tr>
      <tr><td>서버 등록·운영</td><td>운영자 이메일, 서버 주소·포트, 소개·연락처, 운영진 닉네임·공개 Minecraft UUID, 업로드 이미지, 소유권·브리지 인증 기록</td><td>서버 게시, 수정·양도, 소유권 확인, 상태·접속자 통계 제공</td><td>서버 운영 또는 계정 유지 기간. 삭제·양도 종료 후 분쟁 대응에 필요한 최소 기록은 최대 3년</td></tr>
      <tr><td>서버 추천</td><td>추천 닉네임, 공개 Minecraft UUID, 추천일, 보상 상태, 마스킹 IP, 복구 불가능한 IP 대조 해시, 접속환경 지문</td><td>추천 표시, 일일 중복·어뷰징 방지, 보상 처리</td><td>추천 기록은 서비스 운영 기간, 마스킹 IP와 IP 대조 해시는 90일 후 자동 삭제</td></tr>
      <tr><td>문의·운영자 채널</td><td>운영자 이메일, 서버명, 메시지 내용·작성 시각</td><td>고객 문의, 분쟁·운영 지원, 실시간 대화</td><td>문의 종료 후 3년 또는 계정 삭제 요청 시까지 중 먼저 도래하는 때</td></tr>
      <tr><td>광고·소유권 심사</td><td>운영자 이메일, 입찰금액·낙찰·결제상태, 인증 제공자명·인증 참조번호, 소유권 신청·심사 기록</td><td>본인확인 상태 관리, 경매·광고 운영, 소유권 이전·분쟁 처리</td><td>계약·결제 기록 5년, 소비자 불만·분쟁 기록 3년. 원본 신분증과 주민등록번호는 저장하지 않음</td></tr>
      <tr><td>자동 생성 정보</td><td>서비스 접속 시각, 브라우저·기기 정보, 보안 로그, 쿠키. 네트워크 제공자는 원문 IP를 일시 처리할 수 있음</td><td>보안, 장애 대응, 부정 이용 방지, 서비스 품질 유지</td><td>목적 달성 또는 제공자 보관기간 종료 시까지. 서비스가 직접 보관하는 추천 IP 대조정보는 90일</td></tr>
    </tbody></table></div><p className="policy-note">법령에 별도 보존의무가 있거나 분쟁·수사 대응을 위해 필요한 경우에는 해당 항목을 다른 정보와 분리해 법정기간 동안만 보관합니다. 법정기간이 더 긴 경우에는 그 기간을 따릅니다.</p></section>

    <section><h2>2. 개인정보의 공개와 제3자 제공</h2><ul><li>서비스는 개인정보를 판매하지 않으며, 이용자의 별도 동의 또는 법률상 근거 없이 제3자에게 제공하지 않습니다.</li><li>서버명·주소·소개·운영진 닉네임·운영자가 켠 Discord·카카오톡·웹사이트 연락처와 추천 닉네임은 서버 목록의 성격상 공개됩니다. 운영자는 공개 전 입력내용을 확인하고 언제든 수정하거나 비공개 토글을 끌 수 있습니다.</li><li>수사기관 등이 적법한 절차에 따라 요구하는 경우에는 법률이 허용하는 최소 범위에서 제공할 수 있습니다.</li></ul></section>

    <section><h2>3. 개인정보 처리업무 위탁</h2><p>서비스 제공에 필요한 업무를 아래 업체에 위탁합니다. 수탁자와 계약·약관을 통해 목적 외 처리금지, 안전조치, 재위탁 관리와 종료 시 삭제 의무를 확인합니다.</p><div className="policy-table-wrap"><table><thead><tr><th>수탁자</th><th>위탁 업무</th><th>처리 정보</th><th>보유 기준</th></tr></thead><tbody>
      <tr><td>Cloudflare, Inc.</td><td>웹 호스팅·전송, 보안, D1 데이터베이스, R2 이미지 저장, 실시간 통신</td><td>서비스에 저장되는 계정·서버·문의·업로드 정보와 접속 로그</td><td>서비스 계약 또는 처리 목적 종료 시까지. 이후 법령상 보존분을 제외하고 반환·삭제</td></tr>
      <tr><td>Plus Five Five, Inc. (Resend)</td><td>로그인 인증코드와 소유권 관련 이메일 발송</td><td>수신 이메일, 제목·본문과 발송 메타데이터</td><td>서비스 이용계약 동안 처리하며 Resend 계약 종료 후 90일 이내 삭제</td></tr>
    </tbody></table></div></section>

    <section><h2>4. 개인정보의 국외 처리·이전</h2><p>호스팅과 이메일 발송은 서비스 계약의 체결·이행에 필요하며, 개인정보 보호법 제28조의8 제1항 제3호에 따라 아래 내용을 공개하고 국외 처리합니다.</p><div className="policy-table-wrap policy-wide-table"><table><thead><tr><th>이전받는 자·연락처</th><th>국가</th><th>항목·목적</th><th>시기·방법</th><th>보유 기준</th></tr></thead><tbody>
      <tr><td>Cloudflare, Inc.<br/><a href="mailto:legal@cloudflare.com">legal@cloudflare.com</a></td><td>미국 및 서비스 제공을 위한 글로벌 데이터센터 소재국</td><td>제1항의 서비스 정보와 접속 로그 · 호스팅, 저장, 전송, 보안</td><td>서비스 이용 시 암호화된 네트워크를 통한 지속 전송·처리</td><td>서비스 계약 또는 처리 목적 종료 시까지</td></tr>
      <tr><td>Plus Five Five, Inc. (Resend)<br/><a href="mailto:privacy@resend.com">privacy@resend.com</a></td><td>미국</td><td>이메일 주소, 인증·안내 메일 내용과 발송 메타데이터 · 이메일 발송</td><td>인증코드·안내 메일 요청 시 암호화된 네트워크로 전송</td><td>계약 중 처리, 계약 종료 후 90일 이내 삭제</td></tr>
    </tbody></table></div><p className="policy-note">국외 처리를 원하지 않으면 개인정보 담당 창구로 계정 삭제와 처리정지를 요청할 수 있습니다. 다만 Cloudflare 처리를 거부하면 웹서비스 이용이, Resend 처리를 거부하면 이메일 로그인과 소유권 알림 이용이 어렵습니다.</p></section>

    <section><h2>5. Minecraft 공개 프로필·외부 콘텐츠</h2><ul><li>추천 또는 운영진 등록 시 입력한 Minecraft 닉네임은 Microsoft의 공개 Minecraft 프로필 조회 API로 전송되어 정식 닉네임과 공개 UUID를 확인합니다.</li><li>머리 아이콘을 표시할 때 공개 UUID와 이용자의 네트워크 요청 정보가 해외 서비스인 <a href="https://mc-heads.net/privacy" target="_blank" rel="noreferrer">mc-heads.net</a>에 전달될 수 있습니다. 해당 서비스는 스킨을 24시간, CDN 이미지를 6시간 캐시한다고 안내합니다.</li><li>마크 방송 목록은 치지직·SOOP의 공개 방송 정보를 서버에서 불러와 임시 캐시합니다. 이용자가 방송 시청 링크를 누르면 각 플랫폼으로 이동하며 이후 처리는 해당 플랫폼 정책을 따릅니다.</li></ul></section>

    <section><h2>6. 개인정보 파기 절차와 방법</h2><ol><li>보유기간 만료, 회원·서버 삭제 요청 또는 처리 목적 달성 여부를 확인해 파기 대상을 정합니다.</li><li>법정 보존이 필요한 정보는 활성 서비스 정보와 분리하고 접근 권한을 제한합니다.</li><li>D1의 전자 기록은 삭제 또는 식별정보 제거 방식으로, R2의 업로드 파일과 방송 캐시는 객체 삭제 방식으로 파기합니다. 종료된 방송 이미지는 5분 주기의 정리 작업으로 삭제합니다.</li><li>백업에 남은 정보는 백업 순환주기가 끝날 때 복구할 수 없도록 덮어쓰거나 삭제하며, 보존기간 동안 서비스 목적으로 다시 사용하지 않습니다.</li><li>종이 문서를 예외적으로 보유한 경우에는 분쇄 또는 소각합니다.</li></ol></section>

    <section><h2>7. 쿠키와 기기 저장정보</h2><div className="policy-table-wrap"><table><thead><tr><th>이름</th><th>목적</th><th>기간·거부방법</th></tr></thead><tbody><tr><td><code>mkr_owner_session</code></td><td>서버 운영자 로그인 유지</td><td>최대 30일 · 로그아웃 또는 브라우저 쿠키 삭제</td></tr><tr><td><code>minecraft-kr-theme</code></td><td>라이트·다크 화면 설정 저장</td><td>브라우저 로컬 저장소에 보관 · 사이트 데이터 삭제로 제거</td></tr></tbody></table></div><p className="policy-note">필수 세션 쿠키를 차단하면 로그인과 운영자 기능을 사용할 수 없습니다. 광고 추적용 쿠키는 직접 설치하지 않습니다.</p></section>

    <section><h2>8. 안전성 확보조치</h2><ul><li>인증코드·세션·IP 대조값을 원문 대신 해시로 저장하고, 원문 IP는 추천 데이터베이스에 저장하지 않습니다.</li><li>HttpOnly·SameSite 쿠키, 동일 출처 검사, 요청 횟수 제한, 관리자 OTP, 일회용 실시간 접속권과 감사 로그를 적용합니다.</li><li>개인정보 접근 권한을 운영상 필요한 인원으로 제한하고, 전송구간 암호화와 저장소 접근 통제를 적용합니다.</li><li>HTML 직접 입력을 차단하고 업로드 파일 형식·크기 검증과 악성 입력 방어를 적용합니다.</li></ul></section>

    <section><h2>9. 정보주체와 법정대리인의 권리</h2><p>이용자는 자신의 개인정보에 대해 열람, 정정, 삭제, 처리정지, 동의 철회와 계정 탈퇴를 요청할 수 있습니다. 이메일로 요청하면 본인 확인 후 지체 없이 처리하고, 법령상 제한이 있으면 사유와 이의제기 방법을 안내합니다. 만 14세 미만 이용자의 권리는 법정대리인이 행사할 수 있습니다.</p><div className="policy-contact-inline"><a href="mailto:zehelper@gmail.com?subject=Minecraft.kr 개인정보 권리행사 요청">개인정보 권리행사 요청</a><span>zehelper@gmail.com</span></div></section>

    <section><h2>10. 개인정보 보호 담당자와 고충처리</h2><dl className="policy-contact"><div><dt>개인정보 보호책임 역할</dt><dd>Minecraft.kr 운영 책임자</dd></div><div><dt>담당부서</dt><dd>Minecraft.kr 운영팀</dd></div><div><dt>연락처</dt><dd><a href="mailto:zehelper@gmail.com">zehelper@gmail.com</a></dd></div><div><dt>처리업무</dt><dd>열람·정정·삭제·처리정지 요청, 개인정보 침해신고와 고충처리</dd></div></dl><p className="policy-note">전화 상담은 운영하지 않으며 이메일로 접수합니다. 접수 사실과 처리 경과를 회신하고, 본인 확인에 필요한 최소 정보만 추가로 요청할 수 있습니다.</p></section>

    <section><h2>11. 권익침해 구제기관</h2><p>서비스의 자체 처리 결과에 이의가 있거나 상담이 필요한 경우 아래 기관에 문의할 수 있습니다.</p><ul><li>개인정보침해 신고센터: 국번 없이 118 · <a href="https://privacy.kisa.or.kr" target="_blank" rel="noreferrer">privacy.kisa.or.kr</a></li><li>개인정보 분쟁조정위원회: 1833-6972 · <a href="https://www.kopico.go.kr" target="_blank" rel="noreferrer">kopico.go.kr</a></li><li>개인정보 포털: <a href="https://www.privacy.go.kr" target="_blank" rel="noreferrer">privacy.go.kr</a></li></ul></section>

    <section><h2>12. 처리방침 변경</h2><p>법령, 서비스 기능, 수탁자 또는 보유기간이 변경되면 시행 전에 이 페이지에서 변경 이유와 적용일을 알립니다. 이용자 권리에 중대한 변경이 있는 경우에는 이메일 등 합리적인 방법으로 별도 안내합니다.</p></section>
    <nav><Link href="/">서버 목록으로 돌아가기</Link><Link href="/terms">이용약관</Link><a href="mailto:zehelper@gmail.com">개인정보 문의</a></nav>
  </article><DiscordContactWidget /></main>;
}

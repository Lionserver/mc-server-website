# Minecraft.kr 운영 런북

## 출시 게이트

공개 전환은 아래 항목이 모두 충족된 배포만 대상으로 한다.

- `/api/health`가 `200`과 `status: "ready"`를 반환한다.
- `/api/bridge/health`가 `200`과 `ready: true`를 반환한다.
- GitHub `Quality gate`의 lint, typecheck, build, unit test, production audit가 모두 통과한다.
- `drizzle/`의 전체 migration이 운영 D1에 적용되었고 새 빈 데이터베이스에서도 smoke test가 통과한다.
- 관리자 로그인, Sites 로그인, 서버 등록·수정·삭제, 소유권 확인, 이미지 업로드를 운영 환경에서 각각 한 번 검증한다.
- `robots.txt`, `sitemap.xml`, 대표 서버 상세 URL이 `200`을 반환한다.

## 필수 운영 설정

비밀값은 Sites 환경 변수에만 저장하고 소스, `.openai/hosting.json`, Git 기록에 넣지 않는다.

- Sites 사용자 로그인: `SITES_AUTH_ENABLED=true`
- 이메일 대체 로그인: `AUTH_CODE_SECRET`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`
- 총관리자: `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET`
- 총관리자 자격증명 교체 시각: `ADMIN_CREDENTIALS_ROTATED_AT` (Unix 초). 이 시각보다 오래된 로그인 실패 잠금과 관리자 세션은 자동으로 무효화된다.
- Bridge: `BRIDGE_ADMIN_TOKEN`, `BRIDGE_MASTER_SECRET`
- 추천 개인정보 보호: `VOTE_IP_HASH_SECRET`
- 공개 기준 주소: `NEXT_PUBLIC_SITE_URL`
- 운영에서는 `ADMIN_LOCAL_PREVIEW`, `AUTH_LOCAL_PREVIEW`, `ALLOW_PRIVATE_BRIDGE_VERIFY`를 `false`로 유지한다.
- `ADMIN_TEMP_BYPASS_EMAIL`, `ADMIN_TEMP_BYPASS_UNTIL`은 운영 환경에 두지 않는다.

## 상태 확인과 알림

- 외부 가용성 검사는 1분마다 `/api/health`를 호출한다.
- `5xx`, `/api/realtime/*` 실패, D1 오류, R2 오류가 5분 동안 반복되면 운영자에게 알린다.
- 공개 목록 응답시간의 경고 기준은 2초, 장애 기준은 5초다.
- WebSocket 바인딩이 없는 배포는 `/api/realtime/capabilities`가 polling fallback을 알리며 브라우저가 반복 재접속하지 않아야 한다.

## 데이터 보존과 정리

Worker의 예약 작업과 공개 목록의 제한된 백그라운드 유지보수가 다음을 수행한다.

- 만료 로그인 코드·세션·실시간 ticket·nonce 삭제
- 추천 IP 대조정보 90일 후 비식별화
- 종료된 문의·운영자 메시지와 감사 로그의 장기 보존기간 적용
- 상태 표본과 방송 이미지 캐시 정리

정리 작업 실패는 사용자 요청을 실패시키지 않고 Worker 오류 로그에 기록한다.

## 백업·복구

- 운영 D1은 매일 snapshot 또는 export를 생성하고 30일 보관한다.
- R2는 삭제 보호 또는 별도 수명주기 정책을 적용한다.
- 월 1회 별도 복구 데이터베이스에 최신 백업을 복원해 테이블 수, 공개 서버 수, 최근 감사 로그를 대조한다.
- 복구 훈련 결과에는 백업 시각, 복구 완료 시각, 누락 데이터, 담당자를 기록한다.

## 장애 대응

1. 새 배포 직후 오류면 직전 정상 Sites 버전으로 되돌린다.
2. `/api/health`의 실패 항목과 Worker 오류 로그의 최초 시각·경로를 확인한다.
3. 데이터 변경 API를 임시 중단해야 하면 사이트 전체를 공개 해제하거나 이전 비공개 버전으로 되돌린다.
4. D1 손상이 의심되면 쓰기 요청을 중단하고 최신 백업을 별도 DB에 복구해 대조한 뒤 전환한다.
5. 개인정보 또는 관리자 권한 사고면 관련 세션·Bridge 비밀·관리자 자격증명을 즉시 폐기하고 감사 로그를 보존한다.

## 배포 후 확인

- 홈, 소규모, 신규, 방송, 로그인, 운영자, 관리자, 정책 페이지 응답 확인
- 320px, 375px, 900px, 1100px, 4K 폭에서 가로 넘침과 키보드 초점 확인
- 등록→소유권 확인→관리자 승인→공개 목록·상세·sitemap 반영 확인
- 공지 시작·종료 시각과 모든 페이지 상단 노출 확인

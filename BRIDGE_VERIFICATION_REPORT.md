# Minecraft.kr 브리지 실기동 검증 보고서

검증일: 2026-07-13 (Asia/Seoul)

## 결론

Paper/Bukkit 및 Velocity 플러그인 두 종을 빌드하고 실제 공식 서버 배포본에서 기동했습니다. 홈페이지 API의 발급, HMAC 인증, 실제 Minecraft 상태 핑 기반 소유권 검증, 검증 전 차단, 검증 후 텔레메트리 저장, Velocity 다중 백엔드 집계와 주요 보안 거부 조건까지 모두 통과했습니다.

## 검증 환경

- Amazon Corretto 25.0.3 LTS (macOS arm64, 프로젝트 내부 격리)
- Gradle 9.6.0 Wrapper
- Paper 26.1.2 build 74, SHA-256 검증 완료
- Velocity 3.5.1 build 615, SHA-256 검증 완료
- 플러그인 두 종 모두 Java class major version 65(Java 21)
- Vinext 개발 Worker + 로컬 Cloudflare D1

## Paper/Bukkit 결과

- `MinecraftKrBridge 1.0.0` 검색 및 로드: 통과
- 플러그인 활성화 및 발급 설정 인식: 통과
- 검증 전 텔레메트리: HTTP 403으로 거부
- 실제 `127.0.0.1:25575` 상태 핑에서 MOTD 검증 표식 확인: 통과
- `mkrbridge verify`: HTTP 200
- 검증 후 주기 텔레메트리: HTTP 200 지속 확인
- D1 저장값: Paper, 0/32명, 백엔드 1개, Paper/Minecraft 버전과 플러그인 버전 저장
- Bukkit 표준 MOTD API와 Java 21로 다시 빌드한 최종 JAR을 Paper 26.1.2에서 재기동: 통과

## Velocity 결과

- `minecraftkrbridge 1.0.0` 로드: 통과
- 프록시 `127.0.0.1:25576` 기동: 통과
- 검증 전 텔레메트리: HTTP 403으로 거부
- 프록시 MOTD의 검증 표식 실핑 확인: 통과
- `mkrbridge verify`: HTTP 200
- 검증 후 주기 텔레메트리: HTTP 200 지속 확인
- D1 저장값: Velocity 3.5.1, 전체 0명, 총 최대 32명, 백엔드 3개
- 백엔드 세부값: `lobby` Paper 온라인(0/32), `factions` 오프라인, `minigames` 오프라인
- 백엔드 Paper 재시작 동안 상태 변화 감지 후 복구: 통과

## 보안 및 회귀 결과

- 정상 HMAC 요청: HTTP 200
- 동일 nonce 재전송: HTTP 409
- 잘못된 서명: HTTP 401
- 관리자 토큰 없는 발급 요청: HTTP 401
- 공용 API 본문 크기, 숫자 범위, 문자열 길이, 백엔드 최대 100개 제한 구현
- 운영 검증에서 사설/루프백 주소 차단 구현 (`ALLOW_PRIVATE_BRIDGE_VERIFY=false`)
- Gradle 공통 모듈 단위 테스트: 통과
- 홈페이지 ESLint: 통과
- 홈페이지 프로덕션 빌드: 통과
- 홈페이지 SSR/접근성/이미지 규격 테스트: 2/2 통과
- D1 Drizzle 마이그레이션 생성 및 SQL 검토: 통과

## 운영 전 필수 설정

로컬 검증용 `.dev.vars` 값은 운영에 사용하면 안 됩니다. 배포 비밀 저장소에 강한 `BRIDGE_ADMIN_TOKEN`, 별도의 강한 `BRIDGE_MASTER_SECRET`을 설정하고 `ALLOW_PRIVATE_BRIDGE_VERIFY=false`를 유지해야 합니다. `provision` 호출은 현재 관리자 토큰 방식이므로 실제 회원/서버 등록 화면의 로그인 세션과 권한 검사에 묶는 것이 다음 운영 통합 단계입니다.

Cloudflare Workers는 공개 인터넷 대상 TCP 상태 핑에 적합하지만 사설망/localhost 대상은 운영 런타임에서 허용하지 않습니다. 이번 localhost 검증은 로컬 Worker에서만 명시적으로 허용했습니다.

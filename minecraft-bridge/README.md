# Minecraft.kr 서버 브리지

Minecraft.kr 웹 API와 Minecraft 서버를 연결하는 두 개의 독립 플러그인입니다.

- `minecraft-kr-paper-bridge-1.0.1.jar`: Bukkit API 기반 단일 서버 어댑터. Paper와 Folia 스케줄러를 구분하며 Java 21 이상이 필요합니다.
- `minecraft-kr-velocity-bridge-1.0.1.jar`: 전체 프록시 접속자와 등록된 모든 백엔드의 상태를 집계하는 Velocity 어댑터. Java 21 이상이 필요합니다.

## 프로토콜

플러그인은 `/api/bridge/telemetry`와 `/api/bridge/verify`에 JSON을 전송합니다. 모든 요청은 다음 헤더를 포함합니다.

- `X-MKR-Server-Id`
- `X-MKR-Timestamp`
- `X-MKR-Nonce`
- `X-MKR-Signature`

서명 원문은 `timestamp + nonce + method + pathname + SHA-256(body)`이며 HMAC-SHA256을 사용합니다. API는 5분 시각 오차, nonce 중복, 잘못된 서명을 거부합니다. 공유 비밀은 D1에 저장하지 않고 `BRIDGE_MASTER_SECRET`에서 서버 ID별로 파생합니다.

소유권 검증 시 플러그인은 서버 목록 MOTD에 `[MKR-VERIFY:<token>]`을 임시로 표시합니다. 웹 API가 공개 호스트와 포트에 Minecraft 상태 핑을 직접 보내 토큰을 확인해야만 텔레메트리를 허용합니다.

## 빌드

```bash
export JAVA_HOME=/path/to/jdk-25
./gradlew clean test build
```

산출물은 다음 위치에 생성됩니다.

```text
paper/build/libs/minecraft-kr-paper-bridge-1.0.1.jar
velocity/build/libs/minecraft-kr-velocity-bridge-1.0.1.jar
```

## 설치

1. 홈페이지의 운영자 등록 흐름에서 `/api/bridge/provision`을 호출해 서버 ID, 브리지 비밀, 검증 토큰을 발급합니다.
2. 대상 서버의 `plugins/`에 해당 JAR을 넣고 한 번 실행합니다.
3. 생성된 `plugins/MinecraftKrBridge/config.properties` 또는 `plugins/minecraftkrbridge/config.properties`에 발급값을 입력합니다.
4. 서버를 재시작하고 콘솔에서 `mkrbridge verify`를 실행합니다.
5. `mkrbridge status`로 최근 전송 결과를 확인합니다.

예시 설정:

```properties
apiBaseUrl=https://minecraft.kr/api/bridge
serverId=provision-api에서-발급
sharedSecret=provision-api에서-발급
verificationToken=provision-api에서-발급
telemetryIntervalSeconds=30
exposeVerificationToken=true
publicHost=play.example.com
publicPort=25565
```

운영 환경에서는 `BRIDGE_ADMIN_TOKEN`과 `BRIDGE_MASTER_SECRET`을 각각 긴 무작위 값으로 비밀 저장소에 설정하고 `ALLOW_PRIVATE_BRIDGE_VERIFY=false`를 유지해야 합니다. 검증 완료 후에는 `exposeVerificationToken=false`로 바꿔도 됩니다.

## 전송 데이터

Paper/Bukkit 어댑터는 현재/최대 접속자, 서버 구현체, Minecraft 버전, 플러그인 버전과 단일 `primary` 백엔드를 전송합니다.

Velocity 어댑터는 프록시 전체 접속자, 전체 유저 평균 핑, 프록시 버전, 등록된 모든 백엔드 이름, 각 백엔드 연결 가능 여부, 해당 백엔드 접속자/최대 인원과 프로토콜 버전을 전송합니다. 한 번의 요청에서 백엔드는 최대 100개까지 허용됩니다.

## 웹 API

- `POST /api/bridge/provision`: 관리자 전용 발급
- `POST /api/bridge/verify`: 서명된 실제 MOTD 소유권 확인
- `POST /api/bridge/telemetry`: 검증된 서버의 서명된 상태 수집
- `GET /api/bridge/status?serverId=...`: 로그인한 해당 서버 소유자만 상태 조회
- `GET /api/bridge/health`: 상태 확인

D1 스키마와 배포 마이그레이션은 프로젝트의 `db/schema.ts`와 `drizzle/`에 있습니다.

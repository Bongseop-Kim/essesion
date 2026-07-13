# 전체 리팩터링 검토 — 2026-07

## 결론

현재 모노레포의 도메인 분리와 API/worker 책임 경계는 유지할 가치가 있다. 전면적인
재작성이나 새 추상화 계층을 추가하기보다, 실제 장애·보안·경합으로 이어질 수 있는
경계를 좁게 보강했다. 기능 의미는 유지했고 API 스펙 변경은 OpenAPI와
`packages/api-client`를 함께 재생성했다.

## 검토 범위

- API·PostgreSQL: 인증, 결제/Toss 대사, 토큰 원장, 주문·장바구니·견적 입력,
  이미지 정리, 디자인 과금·비동기 작업
- worker: generate/finalize 서비스 표면, lease·재시도, 렌더 리소스 상한,
  외부 어댑터, 결정론 경로
- store/admin/shared: 인증 토큰 회전, 계정 전환, 장바구니·디자인 비동기 경합,
  상품 이미지 참조, 공용 이미지·스크롤 컴포넌트
- 배포·인프라: GitHub Actions 권한, GitHub OIDC/WIF, Cloud Run IAM,
  Cloud Tasks, Cloudflare→Cloud Run 신뢰 경계, 공급망 검사

## 적용한 개선

### 인증·공개 경계

- OAuth 이메일 연결은 provider가 검증한 이메일에만 허용하고 unique 경합을 복구한다.
- 휴대폰 인증번호는 실제 PostgreSQL row lock 아래 5회 실패 후 잠그며 Alembic으로
  상태 필드를 추가했다. 새 인증번호는 세션 secret 기반 HMAC만 저장한다. 인증된 모든
  변경 요청은 라우트 진입 전 탈퇴와 같은 사용자 advisory lock을 잡고 활성 상태를 다시
  확인해, stale 세션이 삭제 뒤 개인정보·주문·디자인 데이터를 만들지 못하게 했다.
- OAuth 초기 무료 토큰만 가진 사용자의 hard-delete FK 오류를 막았다. 초기 지급은
  사용자와 함께 삭제하고, 그 외 토큰·디자인 세션·잡은 보존 이력으로 분류해 soft-delete
  한다. soft-delete 시각은 별도 `users.deleted_at`으로 기록해 향후 purge의 안정적인
  retention anchor를 만들었다.
- 비로컬 일반 API는 Cloudflare가 덮어쓰는 exact edge secret 한 개를 요구한다.
  `/healthz`와 Google OIDC `/batch/*`만 예외며, readiness는 공개 Cloudflare 경로로 확인한다.
- 비로컬 batch는 OIDC audience와 호출 서비스 계정이 모두 있어야 하며, 하나라도
  빠지면 공개된 로컬 개발 토큰으로 폴백하지 않고 readiness와 요청을 닫는다.
- store 로그인·휴대폰 검증·Toss 웹훅에 bounded 보조 rate limit을 두고, 원본 IP는
  인증된 Cloudflare 헤더에서만 읽는다.
- refresh/OAuth 세션 쿠키는 비로컬 환경에서 Secure로 발급한다.
- `/readyz`는 실제 DB `SELECT 1`과 Toss·GCS·worker·Cloud Tasks·batch OIDC·OAuth·
  인증 secret·edge 설정을 함께 검사한다. 공개 Cloudflare 경로만 probe하고 run.app
  직통 readiness는 edge secret 없이는 403으로 닫는다.

### 결제·토큰·데이터 경합

- Toss 취소 대사는 조회 응답과 저장된 payment key·총액을 모두 대조한다. 불일치는
  자동 변경하지 않고 멱등 incident로 남긴다.
- Toss 웹훅 조회의 인증·권한·rate-limit·모호한 4xx는 성공으로 캐시하지 않고 5xx로
  재시도를 유도한다. DONE 혼합 상태·금액 불일치·부분취소는 ACK 전에 관리자 사고로
  남기며, 이미 결제후 상태인 주문도 provider/stored payment key와 금액을 다시 검증한다.
  부분취소 누적 관측값이 달라지면 후속 사고를 별도로 만든다.
- 사고 당시 정확한 provider lookup key는 내부 JSON에 보존하되 관리자 API에서는
  redaction한다. 재대사는 provider paymentKey/orderId/group/status/amount를 모두 대조한다.
- `amount_mismatch`는 동일 payment/group의 provider 상태가 `CANCELED`일 때만 내부 주문을
  원자적으로 취소하고 쿠폰·토큰을 복구한다. 과거 key가 현재 주문 key와 다르면 open으로
  남긴다. `mixed_state`는 메모만으로 닫을 수 없고 내부 상태가 provider와 이미 일치한 뒤
  재대사해야 한다. `partial_cancel`만 최신 증거·금액 검증·메모를 갖춘 수동 해결 대상이다.
- 취소 토큰 회수와 일반 토큰 사용을 동일한 `USER_LOCK → order row` 순서로
  직렬화했다. 실제 PostgreSQL 동시성 테스트로 회수 중 사용이 대기한 뒤 거부됨을
  고정했다. 승인 반영 전 전액취소는 `reserved` 쿠폰만 `active`로 복원하고, 이미
  사용 확정된 쿠폰은 자동 복원하지 않는다.
- 생성 실패 환불은 임의의 paid 토큰을 더하지 않고 실제 차감 행의 class,
  원천 주문, 만료를 그대로 반전한다.
- 장바구니·주문·견적·결제·디자인 JSON에 개수·문자열·수량·바이트·signed-int64
  상한을 두고 NaN/Infinity 및 중복 식별자를 거부한다.
- 주문 자동확정·stale 취소는 정렬된 bounded batch로 처리한다. 이미지 GCS 삭제
  실패는 짧은 claim lease와 retry cursor로 회전시켜 한 객체가 뒤 행을 굶기지 않는다.

### 비동기 이미지 작업과 worker

- finalize task 이름을 job UUID로 결정해 create 응답 유실 후 같은 요청이 409로
  성공 수렴한다. OIDC audience와 910초 dispatch deadline을 worker lease에 맞추고,
  실패 전달은 `max_retry_duration` 없이 최초를 포함해 최대 4회로 고정했다.
- worker가 이미 job을 claim한 ambiguous enqueue는 환불·502로 되돌리지 않는다.
  반대로 API가 전달 실패와 환불을 확정한 job은 늦게 도착한 task가 실행하지 못한다.
- finalize는 960초 lease와 attempt 조건부 terminal write를 사용하며, 명시적인
  temporary marker만 재시도한다. invalid·unknown 실패는 terminal이다.
- Cloud Tasks 전달 창을 넘긴 queued/processing/일시 실패 job은 bounded 배치로
  terminal 처리하고 finalize 예산을 한 번만 복구한다. 결정적인 raster 상한 초과는
  재시도하지 않으며, DB에서 이미 terminal인 task 전달은 2xx로 ACK한다.
- generate/finalize 라우터와 Cloud Run audience를 분리했다. 렌더 픽셀·placement
  반복량·Poisson 탐색·SVG/래스터 timeout·preview 동시성에 상한을 추가했다.
- Recraft는 크기 제한된 `b64_json`만 허용해 외부 URL 재요청 경로를 제거했다.
  motif resolver의 선택 조회 실패는 savepoint 안에서만 롤백한다.
- preview는 caller-controlled request ID뿐 아니라 candidate ID와 PNG content hash를
  키에 포함하고 create-only로 업로드한다. 같은 바이트의 412만 멱등 성공으로 처리하며,
  preview 업로드 장애는 응답 key를 비우고 경고하되 렌더 결과 자체는 반환한다.

### 프런트·관리자

- access token revision과 `getMe` 결과를 묶었다. 같은 계정의 토큰 회전은 캐시를
  보존하고, 다른 계정 전환은 loading 경계에서 기존 사용자 캐시를 제거한다.
- 장바구니 replace와 guest merge를 같은 직렬 큐에 넣고 user/token/revision별
  명시 Bearer 요청으로 고정해 A 계정 작업이 B 계정 캐시를 덮지 못하게 했다.
- 디자인 생성·선택에 operation epoch와 pending marker 소유권을 추가했다. 새 세션
  응답이 stale이면 과금 가능한 generate 호출 자체를 하지 않는다.
- 상품 상세 이미지는 위치별 `{upload_id}` 또는 `{legacy_url}`을 보내고 응답은
  `{url, upload_id}`로 반환한다. 신규·legacy 혼합 순서와 삭제를 명시적으로 보존한다.
- custom quote는 debounce가 끝난 payload의 유효성으로만 호출한다. `ImageFrame`은
  source별 실패를, `ScrollFog`는 직접 자식 resize·mutation을 추적한다.
- 맞춤주문 draft와 결제 pending은 사용자 ID·결제 그룹 소유권으로 격리한다. 결제 중
  계정이 바뀌어도 새 사용자의 장바구니·draft·토큰 캐시를 지우지 않고, owner 없는
  legacy draft는 개인정보 보호를 위해 폐기한다.
- 결제 callback은 세션 `loading`이 끝날 때까지 후처리를 보류한다. 같은 계정으로
  확정되면 후처리를 재개하고 다른 계정이면 원 소유자 namespace만 정리한다. 맞춤주문도
  인증 완료 전 stale 사용자 ID로 draft를 읽거나 저장하지 않는다.
- 공용 로딩 버튼은 기존 accessible name을 유지하고 spinner는 보조기술에서 숨긴다.
  모바일 Header 푸터 액션은 이동 전에 메뉴를 닫아 focus·overlay 상태를 정리한다.

### CI·배포·공급망

- 외부 GitHub Action을 full commit SHA로 고정하고 OSV Scanner 바이너리 버전과
  공식 checksum을 고정했다.
- PR preview는 자격증명 없는 build 검증으로 제한했다. 배포는 same-repository의
  성공한 `push/main` CI가 발생시킨 `workflow_run`만 허용하며 수동 우회 경로를
  제거했다. 이미지 push와 migration 직전에 main tip SHA를 확인하고, migration을
  point-of-no-return으로 삼아 이후에는 main이 전진해도 같은 SHA의 Cloud Run·Cloudflare
  배포를 끝낸다. 배포 단일 큐는 진행 중 배포를 취소하지 않는다.
- Docker 이미지는 Google 인증 파일이 생기기 전에 build하며 GHA credential 파일도
  build context에서 제외한다.
- WIF는 재사용되지 않는 numeric repository ID, repository 이름, main ref,
  정확한 deploy workflow ref와 event를 GCP provider에서 함께 검증한다.
- API DB pool과 Cloud Run concurrency를 함께 제한하고 worker pool을 서비스 특성에
  맞게 축소했다. worker-generate/finalize 서비스 계정을 분리하고 프로젝트 전체
  Secret Manager 접근을 실제 secret별 IAM으로 좁혔다. worker의 공개 asset 권한은
  create-only 조건부 업로드와 bucket-level `objectCreator`로, deployer의 Cloud Run 권한은
  세 서비스·migration job의 resource-level developer/invoker로 제한했다.
- 공개 `/readyz` uptime, 예산 이메일 채널, 프록시/직통 200·403 배포 smoke를 IaC와
  workflow에 연결했다. store/admin 정적 응답에는 Toss·Daum·GCS·Sentry 허용 범위를
  명시한 CSP와 기본 보안 헤더를 배포 산출물로 포함한다.
- 세 Cloud Run 서비스에 `/healthz` startup/liveness probe를 두고, 배포 smoke는 공개
  `/readyz` 200을 먼저 확인한 뒤 상품 경로 200·직통 origin 403을 대조한다. 프로세스
  probe와 외부 의존성 readiness를 분리해 DB 장애 때 재시작 폭풍을 피한다.

## 의도적으로 이연한 항목

- 후보 생성의 eager expansion 변경은 byte-identical 결정론과 프로파일 근거 없이
  적용하지 않았다.
- librsvg/OS 이미지 계층 pin 변경은 raster golden을 함께 재기준화해야 하므로 별도
  배포 작업으로 남겼다.
- 실제 PR 배포는 운영 자격증명과 분리된 preview GCP/Cloudflare 프로젝트 및 서비스
  계정을 만든 뒤 다시 켠다.
- api·worker가 현재 같은 `database-url`과 DB 사용자 역할을 공유한다. 서비스별
  최소권한 DB role·secret·grant는 bootstrap/Alembic과 함께 별도 이관한다.
- stale generation 배치의 backlog/failure 알림과 데이터 증가 시 조회 인덱스,
  readiness의 실제 GCS 버킷 read/write probe는 스테이징 지표를 보고 추가한다.
- worker `/export`의 결정적 크기 상한 오류는 현재 502이므로 공개 계약을 정한 뒤
  400/422로 분리한다.
- 회원 탈퇴는 현재 직접 계정 필드만 익명화하며 주문 배송지 snapshot, 주문/클레임/견적/
  문의 자유 JSON, 수선 배송·사진, 결제 사고·관리자 로그, 디자인 prompt/job에 역사성
  개인정보가 남는다. 특히 seamless 생성 로그·전역 motif·공개 preview는 subject linkage와
  lifecycle이 없어 사용자별 purge가 불가능하다. 필드별 보존 목적·TTL·분리 저장·익명화,
  DB/GCS/로그/백업 purge를 개인정보 책임자·법률 검토자가 승인하고 staging에서 검증하기
  전에는 production cutover를 금지한다.
- 실제 Toss, Cloud Tasks OIDC, Cloudflare WAF, OAuth redirect와 legacy 상품 이미지
  분포는 스테이징 개통 체크리스트에서 리허설한다.

## 검증 기준

완료 판정은 다음을 모두 만족해야 한다.

- `pnpm codegen` 재실행 후 생성물 drift 없음
- `pnpm lint`
- production Vite 환경값을 둔 `pnpm turbo build typecheck test`
- `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyright`
- 실제 testcontainers PostgreSQL을 포함한 `uv run pytest`
- OpenTofu format/validate, workflow YAML parse, Alembic 단일 head
- `pnpm audit --audit-level high`, OSV source scan, `git diff --check`

## 최종 검증 결과

- Python: `uv run pytest` 651건 + 147 subtests 통과(Starlette의 upstream deprecation
  warning 1건), Ruff check/format 222개 파일 통과, Pyright 오류·경고 0건
- JS: production Vite 환경값을 둔 Turbo build/typecheck/test 10개 task 통과
  (store 162건, shared 49건, admin 100건), Biome lint 427개 파일 통과
- 계약·DB: OpenAPI 128 paths 재생성 후 두 번째 codegen drift 0, Alembic head
  `d4e7f1a2b3c6` 하나와 autogenerate drift 0
- 배포·IaC: workflow YAML parse와 Action full-SHA 검사 통과, OpenTofu 1.10.6
  `fmt -check`와 격리 초기화 후 `validate` 통과, CI와 동일한 `APP=api`·
  `APP=worker` production Docker image build, store/admin/api-proxy Wrangler dry-run 통과
- 공급망·정합성: pnpm high audit와 OSV Scanner 2.3.8 source scan 취약점 0건,
  runtime Supabase 참조 0건, `git diff --check` 통과

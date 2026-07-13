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
  상태 필드를 추가했다.
- 비로컬 일반 API는 Cloudflare가 덮어쓰는 exact edge secret 한 개를 요구한다.
  health/readiness와 Google OIDC `/batch/*`만 예외다.
- 비로컬 batch는 OIDC audience와 호출 서비스 계정이 모두 있어야 하며, 하나라도
  빠지면 공개된 로컬 개발 토큰으로 폴백하지 않고 readiness와 요청을 닫는다.
- store 로그인·휴대폰 검증·Toss 웹훅에 bounded 보조 rate limit을 두고, 원본 IP는
  인증된 Cloudflare 헤더에서만 읽는다.
- refresh/OAuth 세션 쿠키는 비로컬 환경에서 Secure로 발급한다.

### 결제·토큰·데이터 경합

- Toss 취소 대사는 조회 응답과 저장된 payment key·총액을 모두 대조한다. 불일치는
  자동 변경하지 않고 멱등 incident로 남긴다.
- 취소 토큰 회수와 일반 토큰 사용을 동일한 `USER_LOCK → order row` 순서로
  직렬화했다. 실제 PostgreSQL 동시성 테스트로 회수 중 사용이 대기한 뒤 거부됨을
  고정했다.
- 생성 실패 환불은 임의의 paid 토큰을 더하지 않고 실제 차감 행의 class,
  원천 주문, 만료를 그대로 반전한다.
- 장바구니·주문·견적·결제·디자인 JSON에 개수·문자열·수량·바이트·signed-int64
  상한을 두고 NaN/Infinity 및 중복 식별자를 거부한다.
- 주문 자동확정·stale 취소는 정렬된 bounded batch로 처리한다. 이미지 GCS 삭제
  실패는 짧은 claim lease와 retry cursor로 회전시켜 한 객체가 뒤 행을 굶기지 않는다.

### 비동기 이미지 작업과 worker

- finalize task 이름을 job UUID로 결정해 create 응답 유실 후 같은 요청이 409로
  성공 수렴한다. OIDC audience, 910초 dispatch deadline, queue retry 기간을
  worker lease와 맞췄다.
- worker가 이미 job을 claim한 ambiguous enqueue는 환불·502로 되돌리지 않는다.
  반대로 API가 전달 실패와 환불을 확정한 job은 늦게 도착한 task가 실행하지 못한다.
- finalize는 960초 lease와 attempt 조건부 terminal write를 사용하며, 명시적인
  temporary marker만 재시도한다. invalid·unknown 실패는 terminal이다.
- generate/finalize 라우터와 Cloud Run audience를 분리했다. 렌더 픽셀·placement
  반복량·Poisson 탐색·SVG/래스터 timeout·preview 동시성에 상한을 추가했다.
- Recraft는 크기 제한된 `b64_json`만 허용해 외부 URL 재요청 경로를 제거했다.
  motif resolver의 선택 조회 실패는 savepoint 안에서만 롤백한다.

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

### CI·배포·공급망

- 외부 GitHub Action을 full commit SHA로 고정하고 OSV Scanner 바이너리 버전과
  공식 checksum을 고정했다.
- PR preview는 자격증명 없는 build 검증으로 제한했다. 배포는 same-repository의
  성공한 `push/main` CI 또는 main 수동 실행만 허용한다.
- Docker 이미지는 Google 인증 파일이 생기기 전에 build하며 GHA credential 파일도
  build context에서 제외한다.
- WIF는 재사용되지 않는 numeric repository ID, repository 이름, main ref,
  정확한 deploy workflow ref와 event를 GCP provider에서 함께 검증한다.
- API 서비스 계정에 finalize 전용 Cloud Run invoker 권한을 부여하고 readiness에
  Cloud Tasks·edge capability를 포함했다.

## 의도적으로 이연한 항목

- 후보 생성의 eager expansion 변경은 byte-identical 결정론과 프로파일 근거 없이
  적용하지 않았다.
- librsvg/OS 이미지 계층 pin 변경은 raster golden을 함께 재기준화해야 하므로 별도
  배포 작업으로 남겼다.
- 실제 PR 배포는 운영 자격증명과 분리된 preview GCP/Cloudflare 프로젝트 및 서비스
  계정을 만든 뒤 다시 켠다.
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

- Python: `uv run pytest` 613건 통과(Starlette의 upstream deprecation warning 1건),
  Ruff check/format 219개 파일 통과, Pyright 오류·경고 0건
- JS: production Vite 환경값을 둔 Turbo build/typecheck/test 10개 task 통과
  (store 138건, shared 47건, admin 100건), Biome lint 420개 파일 통과
- 계약·DB: OpenAPI 127 paths 재생성 후 두 번째 codegen drift 0, Alembic head
  `9b7e5d3c1a20` 하나
- 배포·IaC: workflow YAML parse와 Action full-SHA 검사 통과, OpenTofu 1.10.6
  `fmt -check`와 격리 초기화 후 `validate` 통과, CI와 동일한 `APP=api`·
  `APP=worker` production Docker image build 통과
- 공급망·정합성: pnpm high audit와 OSV Scanner 2.3.8 source scan 취약점 0건,
  runtime Supabase 참조 0건, `git diff --check` 통과

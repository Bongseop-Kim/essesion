# 성능·비용 절감 플랜 1차 실행 기록 (2026-08-19)

`docs/plans/perf-cost-reduction.md`의 1순위(1~5번)와 2순위 중 코드로 완결되는 항목
(8·9번), 6번의 tf 선언까지 실행했다. 6번 apply와 7번(Cloudflare 프록시 본체),
3·4순위는 플랜에 남겼다.

## 실행한 것

1. **`GET /products` limit 기본값 None → 20** — `products/router.py`. 타입도
   `int | None` → `int`로 정리(무제한 반환 경로 자체를 제거). OpenAPI 기본값 변경이라
   `pnpm codegen` 실행, `types.gen.ts`의 `limit?: number | null` → `number` 반영.
   점검 때 관찰된 "홈이 무파라미터 호출"은 현 코드에 없음 — store 호출부 3곳 모두
   이미 limit 명시(홈 4, 문의 모달 20, 샵 무한스크롤 PAGE_SIZE+1)라 프론트 수정 불필요.
2. **전역 `refetchOnWindowFocus: "always"` → `true`** — store `query-client.ts`,
   admin `app-providers.tsx`. store의 e2e-02 경로는 `FOCUS_REFETCH`(staleTime 0 +
   true)가 opt-in으로 유지. admin은 staleTime 30초라 탭 복귀 시 30초 지난 데이터만
   재요청되므로 별도 opt-in 불필요로 판단. 구 정책을 고정하던 가드 테스트 2건을
   새 정책(전역은 staleTime 존중 + opt-in 계약)으로 갱신, `FOCUS_REFETCH` export.
3. **admin seamless-list 폴링 게이팅** — seamless 로그는 종결 상태
   (success/partial/error)뿐이라 jobs-list의 queued/processing 게이트를 그대로 못 씀.
   "최신 로그가 5분 이내"를 활동 신호로 하는 `hasRecentSeamlessActivity` 게이트를
   list·stats 쿼리 양쪽에 적용(목록은 created_at desc라 첫 행이 최신).
4. **`signed_read_url` 프로세스 로컬 캐시** — `integrations/gcs.py`. 키=객체 키,
   TTL 600초(URL TTL 15분보다 짧게), 상한 2048건 도달 시 통삭제(content-hash 키라
   무한 성장 방지). 캐시 적중 시 IAM signBlob 네트워크 호출 생략.
5. **`address-select-modal`에 `enabled: open`** — 닫힌 모달(비로그인 포함)이
   `GET /addresses`를 쏘지 않는다.
6. **GCS 버킷 소프트 삭제 off (apply 완료)** — `infra/main.tf` 두 버킷에
   `soft_delete_policy { retention_duration_seconds = 0 }`. 나이 기준 자동 삭제는
   넣지 않음 — 만료·클레임 정리는 도메인 규칙을 아는 cleanup-images 배치가 담당.
   `main.tf:28`의 "Cloudflare 프록시 경유" 주석 드리프트도 사실대로 수정(7번의 문서
   드리프트 하위 작업). 같은 날 apply 완료 — 아래 "인프라 apply 기록" 참조.
7. **worker 저작 LLM 호출 예산** — `adapters/llm.py`에 `LLMCallBudget`(이미지 경로
   `MotifGenerationBudget`과 같은 패턴) 도입. `author_design` 요청 1건당 유료 chat
   호출 상한 6회(정상 자기수정 4회는 통과, 최악 4×4=16회 차단) + 마감 170초(api
   `worker_timeout_seconds` 180초보다 짧게 — api가 끊은 뒤 과금 지속 방지).
   `_chat`의 HTTP 시도 단위로 차감, 소진 시 `authoring_budget_exhausted` /
   `authoring_deadline_exceeded` reason_code로 중단.
8. **주문 트랜잭션 내 원단 단가 중복 조회 제거** — `calculate_custom_amounts`가
   기본 키 + 원단 키를 `find_pricing_constants`(신규, 비검증 조회) 한 방으로 조회.
   원단 키 누락=invalid_options / 기본 키 누락=pricing_not_configured 구분은 유지.
   플랜 원안의 pricing TTL 캐시는 기각(플랜 "기각한 대안" 참조).

## 검증

- api: `test_products` `test_orders_create` `test_gcs`(캐시 테스트 신규 포함)
  `test_gcs_emulator` `test_quotes` 전부 통과, `ruff` `pyright` 클린.
- worker: `test_adapters.py` 82건 통과 — 예산 테스트 신규
  (`test_author_design_stops_paid_calls_at_the_request_budget`: 재시도 가능 실패
  연속 주입 시 정확히 6번째 호출에서 중단).
- JS: `pnpm lint`/`typecheck`/`test`(store 222·admin 235) /`build` 통과
  (build는 `VITE_API_BASE_URL` 더미로).
- 브라우저 실측(Aside, localhost): store 홈 비로그인 — `GET /addresses` 없음,
  `/products?sort=popular&limit=4`만 호출. 탭 포커스 시뮬레이션(visibilitychange+focus)
  후 재요청 0건(store·admin 모두, 수정 전 "always"는 전체 재요청). admin
  `/seamless-logs` 유휴 상태 40초 관찰 폴링 0건(수정 전 분당 4요청).
- `curl localhost:8000/products?limit=1 | jq length` = 1, OpenAPI `limit.default` = 20.
- `pnpm architecture:check` 통과.

## 되돌리는 법

- 서명 URL 캐시: `signed_read_url`의 캐시 분기만 제거하면 원상복구.
- focus 정책: 갱신 누락 리포트가 오면 해당 쿼리에 `FOCUS_REFETCH` 추가가 정답
  (전역값 원복 아님 — 플랜의 상향 신호 문단).
- LLM 예산: `_AUTHORING_CALL_LIMIT`/`_AUTHORING_DEADLINE_S` 상수 조정.
- 소프트 삭제(apply 후): retention을 604800(7일)으로 되돌려 apply.

## 인프라 apply 기록 (2026-08-19)

첫 `tofu plan`에서 예상 밖 변경 2건이 발견돼 apply 전에 수정했다. 원인은 **로컬
`production.tfvars` 드리프트** — 이 파일이 gitignore라 컴퓨터 2대의 사본이 어긋나
있었고, 이 컴퓨터 사본에 이전 apply의 값이 빠져 있었다:

- `db_tier` 부재 → 변수 기본값 `db-g1-small`로 **DB 역상향 + 재시작**이 plan에 떴다.
  2026-08-17 다운그레이드 유지를 위해 `db_tier = "db-f1-micro"` 복원.
- 루트 도메인(`https://essesion.shop`) 부재 → FRONTEND_ORIGIN·CORS_ORIGINS·
  `upload_cors_origins`에서 빠져 **루트 도메인 store의 API 호출이 CORS로 깨질** plan.
  store는 루트와 app 서브도메인 양쪽 서빙(`apps/store/wrangler.jsonc`)이라 복원.

수정 후 plan은 `0 add, 4 change, 7 destroy` — 버킷 2개 soft_delete(이번 목적) +
finalize 동기 전환 잔재 정리(api의 CLOUD_TASKS·GCP env 제거, worker-finalize
timeout 900→240, Cloud Tasks 큐·tasks-invoker SA·IAM·cloudtasks API·reconcile
스케줄러 destroy 7건 — `finalize-sync-token-pricing-2026-08-19.md`의 커밋분이
미적용 상태였던 것)만 남아 apply. 사후 확인: `/readyz` 200, 루트 Origin으로
`/products?limit=1` 200 + `access-control-allow-origin: https://essesion.shop`.

## 2차 실행 (2026-08-19, 같은 날) — 7번 + 3순위 전체

### 7. Cloudflare assets 캐시 프록시 (코드 완료, 개통 절차 남음)

- `infra/cloudflare/assets-proxy` 신설 — api-proxy 패턴 미러(wrangler custom domain
  `assets.essesion.shop`, vitest 3건). `BUCKET`은 wrangler.jsonc `vars`의 고정
  리터럴이라 api-proxy의 `ORIGIN`(배포 시 주입)과 달리 설정 검증을 두지 않는다.
  GET/HEAD만 받아
  `storage.googleapis.com/<BUCKET>`으로 프록시, 200은 1년 immutable 캐시
  (content-hash 키 전제), 404는 60초. 쿼리 스트링은 캐시 키 분열 방지로 버림.
- api: `public_assets_origin` 설정 신설 — 설정 시 `public_asset_url`이 프록시
  origin으로 URL 생성, 미설정이면 종전 직통(동작 보존, 테스트 추가).
- store·admin CSP(`public/_headers`) img-src·connect-src에 `assets.essesion.shop` 추가.
- deploy.yml에 assets-proxy wrangler deploy 추가, `pnpm-workspace.yaml` 등록.
- **개통 순서**(`infra/cloudflare/README.md`): ① main 머지 → 배포로 워커·custom
  domain 생성 확인(`curl -I https://assets.essesion.shop/<키>` → 200 +
  `cf-cache-status`) → ② `production.tfvars`의 `PUBLIC_ASSETS_ORIGIN` 주석 해제 +
  tofu apply. 순서를 어기면 api가 죽은 호스트로 URL을 발급한다.
- 프록시 도입 전 DB에 저장된 직통 URL(상품 이미지 — 저장 시점 URL 영속)은 버킷 공개
  읽기가 유지되므로 계속 동작한다. 캐시 혜택을 받으려면 상품 재저장으로 갱신 가능.

### 3순위 (10~16번)

10. **admin few-shot 프리뷰 N+1 → 배치** — 행당 프리뷰 엔드포인트를
    `GET /admin/authoring/examples/preview-batch?ids=…`로 교체(api-client 재생성).
    렌더 동시성 8 제한(워커 Cloud Run 동시성 2 스파이크 방지). 없는 id·렌더 실패는
    svg null(실루엣 폴백), 순서 보존. 재렌더 방지는 클라이언트 쿼리 키
    `(id, updated_at)` + staleTime 무한이 담당한다 — api 프로세스 캐시는 그 위에
    얹을 이득이 작아 두지 않았다(하드 리로드 폭주가 관측되면 재론).
    라우트 선언은 `/examples/{example_id}`보다 위 — 아래면 리터럴 경로가 먹힌다.
    실측: 20행 페이지 진입 = preview 요청 1건, 썸네일 20개 전부 렌더.
11. **sticky-section-nav 지연 마운트** — 아래쪽 섹션 content를 근접(IO rootMargin
    25%) 전까지 마운트하지 않음(공개는 뷰포트 아래라 시프트 비가시). 탭 클릭은
    `flushSync`로 전부 공개를 DOM에 먼저 반영하고 스크롤·해시는 앵커 기본 동작에
    맡긴다(자리표시자 높이로 앵커가 어긋나지 않게), 해시 딥링크는 전부 공개로 시작. `[sections]` 인라인 배열 의존으로 렌더마다 IO를 재생성하던
    것도 id 키로 안정화. 실측: 상품상세 진입 시 `/products/1`만, 스크롤 시에만
    reviews·inquiries 발사. 유의: 폼 화면(custom-order)에서 미공개 섹션의 필드는
    마운트 전 — 제출 버튼이 최하단이라 도달 시점엔 전부 공개되므로 무해로 판단.
12. **api N+1 두 곳** — `list_refundable_orders` 3N+1 → 사용자 단위 3쿼리 배치
    (부여 토큰 전체 조회 후 매핑, 클레임 in_(), 사용 여부는 max(created_at) 1회).
    `_resolve_user_motifs` id별 SELECT → in_() 한 방(에러 시맨틱 보존).
13. **결제 알림톡 배경 발송** — 결제 confirm의 알림톡을 BackgroundTasks로
    (quotes 패턴) — 사용자 confirm 경로만, 웹훅·관리자 대사는 인라인 유지.
    Solapi 공유 커넥션 풀은 두지 않았다 — 발송은 드물고 이미 응답 경로 밖이라
    TLS 핸드셰이크 1회를 아끼는 값이 풀 수명 관리(+lifespan aclose 분기)보다 작다.
14. **worker 임베딩 중복 제거·배치화** — retrieval 쿼리의 슬롯 수 접미사 제거
    (적합성은 `_compatible`이 담당, 접미사가 요청 스코프 메모를 갈라 요청당 2회
    임베딩 유발) + 메모 키 공백 정규화. 프로세스 질의 캐시는 두지 않았다 —
    요청 내 중복은 `RequestScopedEmbedding` 메모가 이미 잡고, 위 접미사 제거로
    실제 이중 과금 경로가 사라졌다(플랜의 "영속 캐시"는 필요해지면 재론).
    인덱싱은 `/embeddings` 배열 입력 64건 배치(`embed_batch`), 배치 단위 커밋 멱등.
    단건 `embed`는 `embed_batch([text])` 위임 — 파싱·차원 검증 경로가 하나다.
15. **래스터 재인코딩 제거** — `rasterize_svg(stamp_dpi=False)` 신설, 내부 소비자
    5곳(fabric compose·segment·motif mask·정규화 게이트·비전 태깅 입력)은 Pillow
    디코딩→재인코딩 생략. 최종 산출물(export·프리뷰 업로드)은 DPI 스탬프 유지.
16. **store 서명 URL 쿼리 키 통일** — `signedReadUrlQueryOptions` 공유 헬퍼
    (`["signed-read-url", objectKey]`, staleTime 10분) 로 reform-image 2갈래·
    repair-shipping-photo·quote-reference-image(staleTime 없던 곳) 4곳 통일 —
    같은 자산은 화면이 달라도 캐시 공유, 포커스마다 재발급 제거.

### 2차 검증

- Python: 대상 테스트 전부 통과(authoring 배치 계약 테스트 갱신, 임베딩 fake
  embed_batch 전환 포함), ruff·pyright 클린.
- JS: lint/typecheck/test(store 223·admin 235·assets-proxy 3) /build 통과,
  architecture:check 통과. sticky-section-nav에 지연 마운트 가드 테스트 추가.
- 브라우저 실측(Aside): 위 10·11번 항목에 기재.
- 7번의 캐시 적중(`cf-cache-status: HIT`)·DATA_READ 감소 확인은 개통 후 —
  청구 BigQuery export는 2026-08-17에 활성화됨(첫 데이터 유입 대기 중).

## 3차 실행 (2026-08-19, 같은 날) — 4순위 종결, 플랜 문서 삭제

방향 결정(운영자): **성능보다 비용 우선, DB 티어 상향 금지.** 이로써 남은 항목이
전부 소진돼 플랜 문서(`docs/plans/perf-cost-reduction.md`)를 삭제했다.

### 17. admin 쿼리 2회 호출 — 원인 확정, 이미 해소

프로덕션 번들(vite preview) 실측 1회 + dev 재실측 1회 모두 전 쿼리 1회씩.
원인: StrictMode 이중 마운트 × 구 전역 정책 `refetchOnWindowFocus: "always"`
(fresh여도 재마운트 시 재요청)의 조합 — 1차 실행의 2번(→ `true`)이 dev 중복까지
함께 없앴다. 수정 불필요로 종결.

### 18. DB 커넥션 상한 — 인스턴스·풀 축소로 확정 (apply 필요)

f1-micro `max_connections` 25 예산에 맞춰 `infra/cloudrun.tf` 조정:
api max_instances 10→3 + `DB_POOL_SIZE=4`(env), worker-generate 10→2,
worker-finalize 5→1. 최악 커넥션 3×4+2×4+1×4=24 ≤ 25. 동시 처리력은
api 20×3=60 요청·생성 2×2=4건으로 현 트래픽(MAU<100) 대비 충분하고,
인스턴스 상한 축소는 비용 상한도 같이 내린다. 상향 신호: 커넥션 에러 로그.

### 19. 비전 태깅 모델 하향 — 운영자 결정으로 플랜에서 제외

품질 회귀 검증 비용 대비 우선순위 낮음. `provider_usage` 실측이 쌓인 뒤
`token-pricing-recalibration.md` 쪽에서 필요하면 재론.

### 20. 잡동사니 — 전부 처리

- **Artifact Registry cleanup policy** — 최근 5개 유지 + 30일 초과 삭제
  (`main.tf`, apply 필요). 롤백은 최근 리비전으로만 하므로 5개면 충분.
- **Docker 이미지 슬림화** — `COPY . .`을 워크스페이스 멤버 선별 복사로 교체:
  반대쪽 앱은 pyproject만 복사(uv 워크스페이스 해석용). api 이미지 내 worker
  소스 32MB → 8KB. `.dockerignore`에 `apps/*/tests` 추가. 양쪽 이미지 로컬
  빌드 + `import api.main`/`import worker.main` 기동 검증.
- **cancel-stale-orders 15분 → 30분** (`scheduler.tf`, apply 필요) — 30분 SLA의
  최악 정리 지연 45→60분, 배치 호출 절반.
- **preview.yml 삭제** — 프론트 빌드는 ci.yml이, 배포 가능 엔드포인트 검사는
  deploy.yml이 이미 수행하고, docker build는 이미지를 버렸다. Dockerfile 파손은
  merge 후 deploy 게이트에서 잡히는 것으로 수용(공개 레포라 CI 비용은 원래 0 —
  이 항목의 이득은 PR 피드백 소음·대기시간 제거).
- **sentry lazy import** — store `@sentry/react`를 동적 import로 전환 — DSN 없으면
  아예 로드 안 됨, init 전 capture는 SDK 버퍼링으로 안전.
  recharts는 분리하지 않는다 — 라우트 단위 코드 스플리팅이 이미 recharts를
  dashboard 청크(376K)에 격리해 엔트리(212K)에서 빠져 있고, dashboard는 진입하면
  항상 차트 4개를 그리므로 route 안에서 한 겹 더 나눌 이득이 없다.
- **admin 대시보드 3쿼리 → overview 1개** — `/admin/dashboard/{summary,timeseries,
  top-products}`를 `GET /admin/dashboard/overview`로 통합(api-client 재생성,
  무효화 의존 지점 없음 확인). incident 폴링 게이트는 overview.summary 기준 유지.
- **`/products` 찜 수 상관 서브쿼리** — 행당 실행되던 스칼라 서브쿼리를 집계
  서브쿼리 outer join으로 교체(popular 정렬 동일 표현식 재사용).
- **세션·턴 목록 SVG payload — 기각**: 조사 결과 낭비가 아니라 소비 중인 데이터다.
  세션 목록 preview_svg는 목록 썸네일이, 턴 response.design.svg는 이력 셀·현재
  디자인 렌더(TieCanvas)가 직접 사용하고 DesignOut은 이미 최소형. PNG 전환은
  시각 계약 변경이 필요한 별도 제안 — 세션 수십 개 규모가 되면 재론(코드의
  ponytail 주석에 업그레이드 경로 기록됨).

### 3차 검증

- `tofu validate` 통과 (apply는 사람 — 아래 남긴 과제).
- Docker: api·worker 이미지 빌드 + 기동 import 검증(위).
- api: products·admin_orders(대시보드 테스트를 overview로 이관)·admin_authoring
  통과, ruff·pyright 클린.
- JS: lint/typecheck/test(store 223·admin 235)/build/architecture:check 통과,
  dashboard 테스트 mock을 overview로 이관.

## 남긴 과제

- **tofu apply 1회** (3차 변경 반영): cloudrun 인스턴스·풀 축소(18번), Artifact
  Registry cleanup policy, cancel-stale-orders 30분. plan에서 이 세 묶음만
  뜨는지 확인 후 apply — plan 전 tfvars를 버킷에서 내려받을 것(infra/README.md).
- 7번 개통: main 머지 → assets.essesion.shop 200 확인 → `PUBLIC_ASSETS_ORIGIN`
  주석 해제 + tofu apply → `cf-cache-status: HIT`·DATA_READ 볼륨 감소 확인.
- 만료 발생량이 100건/일(cleanup-images LIMIT)을 넘는지 운영에서 관찰.
- ~~`production.tfvars` 드리프트 재발 방지~~ — 해결(2026-08-19): 정본을 사설 상태
  버킷 `gs://essesion-tfstate/production.tfvars`에 업로드. plan 전 내려받고 변경 시
  올리는 절차를 `infra/README.md`에 기록(공개 레포라 저장소 커밋은 부적합 — tfstate가
  같은 값을 이미 담고 있어 버킷 민감도는 동일).
- 4순위(17~19번)와 20번 잡동사니는 플랜 문서에 유지.

# 성능·비용 절감 플랜

**전제**: 2026-08-19 점검(코드 스캔 4방향 + 로컬 브라우저 네트워크 실측) 결과로 만든
순위표다. 2026-08-19 코드 대조 재검증에서 항목별 `파일:라인`·산식이 전부 일치함을
확인했다. 항목은 효과 ÷ 난이도 순 — 위에서부터 실행하고, 항목 단위로 실행·검증할 수
있다. 끝난 항목은 `docs/reviews/`에 기록하고 이 문서에서 지운다.

**실패 모드**: 절감 효과를 측정 없이 단정하는 것. 청구 BigQuery export가 아직 없어
(`docs/reviews/gcp-cost-reduction-2026-08-17.md`의 남긴 과제) SKU 단위 전후 비교가
불가능하다 — 비용 항목(6·7번)을 실행하기 전에 export부터 켜는 것을 권장.

## 왜 필요한가

- 브라우저 실측: store는 건전(소프트 내비 시 필요한 요청만, 재방문 캐시 적중, 유휴
  폴링 없음). admin은 클라이언트 캐시가 사실상 없고(재방문 시 대시보드 12건 전부
  재요청) 모든 쿼리가 정확히 2회씩 나감(17번, 원인 미확인).
- 코드 스캔: 공개 엔드포인트의 전체 테이블 반환, 게이트가 무력화된 폴링, 상한 없는
  유료 LLM 재시도, 수명주기 없는 GCS 버킷 등이 확인됨. 상세는 아래 각 항목.
- 외부 사실은 공식 문서로 확인함: IAM signBlob 호출은 무료(지연·쿼터만 문제),
  GCS 소프트 삭제는 기본 7일 활성이고 삭제분도 원 클래스 단가로 과금,
  TanStack Query `refetchOnWindowFocus: "always"`는 staleTime을 무시,
  Cloud SQL `db-f1-micro`의 `max_connections` 기본값은 25,
  Cloud Logging은 월 50GiB 무료 후 $0.50/GiB.

## 범위 밖

- Cloud SQL 티어·컨테이너 스캔 — `docs/reviews/gcp-cost-reduction-2026-08-17.md`에서
  이미 실행 완료라 제외했다.
- 토큰 단가 재조정 — `docs/plans/token-pricing-recalibration.md`가 소유. 여기서는
  원가(호출 수)만 줄이고 가격은 건드리지 않는다.
- 기능·UX 변경 없음 — **예외는 1번 하나**: 공개 API의 무limit 응답이 전체 → 20건으로
  바뀌는 외부 관찰 가능한 동작 변경이다. 자사 프론트는 호출부를 함께 고쳐 무영향이고,
  서드파티 소비자는 없다(공개 회원가입 없는 서비스). 이 예외 외에 사용자가 보는 동작이
  달라지는 항목은 없다.

## 실행 조건

- 1순위 2번(전역 focus 정책)은 `apps/store/src/shared/lib/live-queries.ts`의 e2e-02
  회귀 주석을 먼저 읽고, admin에 동일 opt-in이 필요한 화면을 정한 뒤에 실행한다.
  전제는 검증됨: `FOCUS_REFETCH`가 `staleTime: 0 + refetchOnWindowFocus: true`라
  전역값을 `true`로 내려도 opt-in 경로는 동작이 유지된다.
- 4순위(17~19번)는 확인 결과가 나오기 전에는 수정하지 않는다.
- 6·7번(비용)은 청구 export 활성화 후 실행하면 전후 비교가 가능하다(권장이지 필수는 아님).

## 절차

### 1순위 — 한 줄~수 줄 수정, 즉시 효과

1. **`GET /products`의 `limit` 기본값 None → 20** — `apps/api/src/api/domains/products/router.py:78`.
   공개 무인증 엔드포인트가 전체 테이블을 반환한다. 실측으로 store 홈이 파라미터 없이
   `GET /products`를 호출하는 것을 확인 — 프론트 호출부도 limit을 명시하도록 함께 수정.
   시그니처 기본값 변경은 OpenAPI에 반영되므로 **`pnpm codegen` 후 생성물 동반 커밋 필수**
   (CI codegen-drift가 검사). 같은 쿼리의 찜 수 상관 서브쿼리(`:29-42`)·`sort=popular`
   정렬은 별도 후속(20번).
2. **전역 `refetchOnWindowFocus: "always"` → `true`** —
   `apps/store/src/shared/lib/query-client.ts:7`, `apps/admin/src/app/providers/app-providers.tsx:17`.
   `"always"`는 staleTime을 무시하고 탭 포커스마다 활성 쿼리 전부를 재요청한다. store에는
   이미 opt-in 헬퍼(`live-queries.ts:10`의 `FOCUS_REFETCH`)가 있으니 전역값만 내리고,
   admin에도 동일 opt-in이 필요한 화면(잡 모니터링 등)만 올린다.
3. **admin seamless-list 무조건 30초 폴링 게이팅** —
   `apps/admin/src/pages/generation/seamless-list.tsx:107,112`가 `hasActiveWork`에 리터럴
   `true`를 넘겨 게이트가 무력화돼 있다. `jobs-list.tsx:123`과 같은 방식
   (`items.some(status ∈ {queued, processing})`)으로 통일. 탭을 열어두면 분당 4요청 무기한.
4. **`signed_read_url`에 프로세스 로컬 메모이제이션** — `apps/api/src/api/integrations/gcs.py:171-183`.
   `READ_URL_TTL` 15분인데 같은 객체를 매번 새로 서명한다. 현재 서명 방식
   (`service_account_email` + `access_token`)은 서명 1건마다 IAM Credentials `signBlob`
   API를 네트워크 호출하는 경로라, 이미지가 보이는 화면마다 수십~수백 ms 지연이 붙는다.
   TTL보다 짧은(예: 10분) 만료 기준 캐시로 대부분 해소된다. 단, 키가 content-hash 객체
   키라 무한 성장하므로 **max size 상한(또는 시간 버킷 통삭제)을 반드시 함께** 둘 것.
5. **`address-select-modal`에 `enabled: open` 가드** —
   `apps/store/src/features/shipping/ui/address-select-modal.tsx:43`. 항상 마운트되는 모달이
   비로그인 상태에서도 `GET /addresses`를 쏜다.

### 2순위 — 반나절 내외, 비용 직결

6. **GCS 버킷 수명주기·소프트 삭제 정책 선언** — `infra/main.tf:29-62` 두 버킷 모두
   lifecycle_rule·soft_delete_policy 없음. 생성 이미지가 STANDARD로 무한 누적되고,
   기본 소프트 삭제(7일) 탓에 삭제된 객체도 7일치 저장 요금이 붙는다. 단명 객체가 많은
   uploads 버킷은 `soft_delete_policy { retention_duration_seconds = 0 }`로 끄는 것부터.
   정리 배치 상한(`batch/router.py:21`의 `CLEANUP_BATCH_SIZE = 100`, `scheduler.tf:16`
   일 1회)도 함께 점검 — 만료 발생량이 100건/일을 넘으면 정리가 영구히 밀린다.
7. **공개 이미지 앞에 Cloudflare 캐시 계층** — `gcs.py:59`가
   `https://storage.googleapis.com/{bucket}` 직통 서빙이라 조회마다 서울 리전 egress
   (~$0.12/GB) + Class B 오퍼레이션 + Storage DATA_READ 감사 로그(`infra/audit.tf:20-31`,
   조회 1건 = Cloud Logging 1건)가 1:1로 붙는다. 기존 api-proxy처럼 Cloudflare Worker
   캐시 프록시를 앞에 두면 셋이 동시에 준다. `infra/main.tf:28` 주석은 이미 프록시
   경유라고 사실과 다르게 적혀 있음(문서 드리프트) — 함께 수정. 미루면 차선책으로
   `_Default` 로그 싱크에 공개 객체 GET 제외 필터만이라도.
8. **worker 저작 LLM 호출 횟수 상한** — `apps/worker/src/worker/adapters/llm.py:40,45`.
   요청 1건이 최악 자기수정 4 × HTTP 재시도 4 = 유료 chat 16회까지 가능하고 **호출 횟수**
   상한이 없다(출력 토큰 상한 `MAX_OUTPUT_TOKENS`는 `llm.py:48`에 이미 있으니 예산 객체와의
   관계만 정리하면 됨). 이미지 경로의 `MotifGenerationBudget`(`resolver.py:83`)과 같은 예산
   객체를 저작에도 도입. 아울러 회당 타임아웃 120초 × 4회가 api의 180초
   (`api/config.py:81`)를 넘겨 api가 끊은 뒤에도 유료 호출이 계속되는 문제
   (worker-generate Cloud Run 타임아웃 300초, `infra/cloudrun.tf:211`)를 예산·타임아웃
   정합으로 함께 해결.
9. **주문 트랜잭션 내 원단 단가 중복 조회 제거** — `apps/api/src/api/domains/orders/service.py:690`.
   같은 트랜잭션에서 동일 pricing_constants를 두 번 SELECT한다 — 한 번 조회해 넘긴다.
   (pricing 전반의 TTL 캐시는 기각 — 아래 "기각한 대안" 참조.)

### 3순위 — 국소 리팩터

10. **examples-list 행당 프리뷰 쿼리 N+1** — `apps/admin/src/pages/authoring/examples-list.tsx:53`.
    페이지 크기 100이면 진입 시 최대 101개 동시 요청. 목록 응답에 프리뷰 포함 또는 배치
    엔드포인트.
11. **sticky-section-nav가 모든 탭 content를 즉시 렌더** —
    `apps/store/src/shared/ui/sticky-section-nav.tsx:82`. 상품상세 등 4개 화면이 진입 즉시
    보이지 않는 탭의 무한쿼리 2건을 추가 발사. 46행의 `useEffect(..., [sections])` 인라인
    배열로 인한 IntersectionObserver 재생성도 함께.
12. **api N+1 정리** — `tokens/ledger.py:412-490` `list_refundable_orders`(주문 N건에 쿼리
    3N+1), `design/router.py:1687-1711` `_resolve_user_motifs`(`in_()` 한 방으로 대체,
    디자인 생성마다 타는 경로).
13. **Solapi 클라이언트 싱글턴화 + 결제 알림톡 BackgroundTasks 이동** —
    `integrations/solapi.py:53-66`(발송마다 새 AsyncClient),
    `payments/service.py:677`(인라인 발송으로 결제 응답 최대 10초 지연 —
    `quotes/router.py:46` 패턴 재사용).
14. **worker 임베딩 중복·미캐시** — 같은 프롬프트를 요청당 2회 임베딩
    (`routes.py:464`와 `:476`의 텍스트가 달라 요청 스코프 메모 미적중 —
    `retrieval.py:44`의 접미사 제거 또는 키 정규화), 질의 임베딩 영속 캐시 없음.
    인덱싱·백필의 1건당 1 HTTP도 `/embeddings` 배열 입력으로 배치화
    (`motifs/embeddings.py:12-19`, `tagging.py:20`).
15. **worker 래스터 재인코딩 낭비** — `render/raster.py:73-79`가 PNG를 디코딩→DPI 메타만
    찍어 재인코딩→호출자가 재디코딩. 내부 소비자는 DPI를 안 쓰므로 순수 낭비, finalize
    경로에서 최대 2천만 픽셀 × 4쌍.
16. **서명 URL 쿼리 키 통일(store)** — `["reform-image", key]` / `[..., claim_token]` /
    `["repair-shipping-photo", key]` 세 갈래라 같은 자산의 캐시가 공유 안 됨.
    `quote-request-detail.tsx:47`엔 staleTime 자체가 없어 포커스마다 재발급 + 이미지
    재다운로드.

### 4순위 — 확인 후 판단

17. **admin 쿼리 2회 호출의 원인 확인** — 실측에서 admin의 모든 API가 정확히 2회씩 나감.
    `apps/admin/src/main.tsx:12`가 StrictMode로 감싸고 있어 **dev 이중 마운트 → 프로덕션
    무해로 종결될 가능성이 높다** — 기대 결과를 이걸로 두고 확인한다. 아니면(예: 401
    콜드스타트 재시도 경로) 원인 수정. 확인법: `pnpm --filter admin build` 프리뷰
    (프로덕션 번들)에서 같은 실측 반복.
18. **api DB 풀 vs f1-micro 상한** — `db.py:19-26` pool_size 5 × max 10 인스턴스 = 최대 50
    커넥션인데 f1-micro의 `max_connections`는 25(공식 기본값). max_instances를 낮추거나
    풀을 줄이거나 티어 재상향 신호로 삼을지 결정.
19. **비전 태깅·아이디어의 모델 하향** — `adapters/motif_tagging.py:17`이 저작과 같은
    상위 모델 사용. 저가 모델 후보이나 품질 회귀 확인 필요 —
    `docs/plans/token-pricing-recalibration.md`의 `provider_usage` 실측과 묶어 진행.
20. **잡동사니(효과 소, 여유 있을 때)** — Artifact Registry cleanup policy(`main.tf:21-26`),
    Dockerfile 멀티스테이지 + `.dockerignore` 보강(api 이미지의 worker 자산 32MB),
    `cancel-stale-orders` 15분 → 30분(`scheduler.tf:15`), preview.yml의 중복 프론트 빌드·
    버리는 docker build, recharts·sentry lazy import, admin 대시보드 3쿼리 → overview 1개,
    `design/router.py:768-850` 세션·턴 목록의 SVG 전문 payload, `/products`의 찜 수 상관
    서브쿼리·`sort=popular` 정렬 개선.

## 검증

- 프론트 항목(2·3·5·10·11·16): Aside 브라우저 실측 재현 — 페이지의 fetch/XHR을
  집계해 수정 전 관찰값(탭 포커스마다 전체 재요청, seamless-list 분당 4요청,
  비로그인 `GET /addresses`)이 사라졌는지 확인. 재방문 캐시 적중도 같은 방법.
- api 항목(1·4·9·12·13): 해당 도메인 pytest만 지정 실행 + 로컬 SQL 로그로 쿼리 수
  전후 비교. 1번은 `curl -s localhost:8000/products | jq length`가 20 이하.
- worker 항목(8·14·15): 해당 테스트 파일 지정 실행. 8번은 강제 실패 주입 시 유료 호출
  수가 예산 상한에서 멈추는 로그 확인.
- 인프라 항목(6·7): `tofu plan`으로 의도한 리소스만 변경되는지 확인 후 apply.
  7번은 응답 헤더의 캐시 적중(`cf-cache-status: HIT`)과 Cloud Logging의 DATA_READ
  볼륨 감소로 확인.
- 공통: `pnpm build && pnpm typecheck && pnpm test`, `uv run ruff check .`,
  api 스펙이 바뀌는 항목(**1번**·10번 등)은 `pnpm codegen` 후 생성물 동반 커밋.

## 되돌리는 법 / 상향 신호

- 6번 소프트 삭제 off: `soft_delete_policy` 블록의 retention을 604800(7일)으로 되돌려
  apply. 상향 신호: 실수 삭제 복구가 필요했던 사건 발생.
- 4번 서명 캐시: 캐시 만료 전 객체가 교체되는 사고가 나면(content-hash 키라 이론상 없음)
  캐시 함수만 제거하면 원상복구.
- 2번 focus 정책: 갱신 누락 리포트(admin에서 바꾼 값이 store에 안 보임)가 오면 해당
  쿼리에 `FOCUS_REFETCH`를 추가하는 것이 정답이지 전역값 원복이 아니다.

## 기각한 대안

- **pricing/admin_settings 프로세스 TTL 캐시** — 인덱스 걸린 소형 테이블 SELECT라
  요청당 비용이 사실상 0인데, 돈 경로에 최대 TTL만큼의 옛 가격 창이 생긴다. 낙관적
  락은 admin 동시 쓰기 보호일 뿐 api의 stale 읽기와 무관하고, 돈 경로 동작은
  `docs/api-spec/`이 정본이라 가격 반영 시점 변경은 스펙 검토 대상. 효과 ÷ 리스크가
  안 맞아 기각 — pricing SELECT가 프로파일링에서 실제 병목으로 실측되면 재론.
- **SA 개인키를 받아 서명 URL을 로컬 서명으로 전환** — signBlob 호출이 무료임이 확인돼
  이득이 지연 제거뿐인데, 키리스 원칙(audit.tf의 SA 키 알림,
  `docs/plans/cloud-security-hardening.md`)과 상충한다. 4번 캐시로 부족하면 재론.
- **공개 자산의 Cloudflare R2 이전** — egress 0원이고 wrangler 배포 체계와 결이 맞지만
  이관 작업이 커서, 현재 트래픽 규모에선 7번 Worker 프록시로 충분하다. egress가 청구서
  상위 항목이 되면 재론.
- **`pool_pre_ping` 제거** — 체크아웃마다 왕복 1회를 아끼는 것보다 끊긴 커넥션 감지의
  안정성 가치가 크다.

## 점검에서 문제 없다고 확인된 것

- Cloud Run 사이징: 3서비스 모두 min-instances 0 + cpu_idle, GPU·VPC 커넥터 없음.
- api 배치 조회·페이지네이션(admin 목록 전반), 결제 경로의 "외부 호출 전 커밋" 설계.
- worker GCS 왕복(생성당 업로드 1회, content-hash + 조건부 업로드로 재시도 안전).
- store 프론트: 라우트 스플리팅 100%, 무거운 배럴 의존성 0, 유휴 폴링 없음, 재방문 캐시 적중.
- CI 비용(퍼블릭 레포라 무료), 애플리케이션 로그 볼륨.

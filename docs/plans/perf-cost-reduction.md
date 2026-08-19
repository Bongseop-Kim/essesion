# 성능·비용 절감 플랜

**전제**: 2026-08-19 점검(코드 스캔 4방향 + 로컬 브라우저 네트워크 실측) 결과로 만든
순위표다. 1·2순위(1~9번)는 2026-08-19에 실행·apply 완료 —
`docs/reviews/perf-cost-reduction-2026-08-19.md`. 아래는 남은 항목이며 번호는 원
플랜 번호를 유지한다. 위에서부터 실행하고, 끝난 항목은 reviews에 기록하고 지운다.

**실패 모드**: 절감 효과를 측정 없이 단정하는 것. 청구 BigQuery export가 아직 없어
(`docs/reviews/gcp-cost-reduction-2026-08-17.md`의 남긴 과제) SKU 단위 전후 비교가
불가능하다 — 7번을 실행하기 전에 export부터 켜는 것을 권장.

## 왜 필요한가

- 브라우저 실측(2026-08-19): admin은 클라이언트 캐시가 사실상 없었고 모든 쿼리가
  정확히 2회씩 나감(17번, 원인 미확인). 캐시·폴링 문제는 1차 실행으로 해소.
- 코드 스캔: 프론트 N+1, api N+1, 수명주기 없는 GCS 버킷, egress 직통 서빙 등.
  상세는 아래 각 항목.
- 외부 사실은 공식 문서로 확인함: GCS 소프트 삭제는 기본 7일 활성이고 삭제분도 원
  클래스 단가로 과금, Cloud SQL `db-f1-micro`의 `max_connections` 기본값은 25,
  Cloud Logging은 월 50GiB 무료 후 $0.50/GiB.

## 범위 밖

- Cloud SQL 티어·컨테이너 스캔 — `docs/reviews/gcp-cost-reduction-2026-08-17.md`에서
  이미 실행 완료라 제외했다.
- 토큰 단가 재조정 — `docs/plans/token-pricing-recalibration.md`가 소유. 여기서는
  원가(호출 수)만 줄이고 가격은 건드리지 않는다.
- 기능·UX 변경 없음 — 사용자가 보는 동작이 달라지는 항목은 남은 목록에 없다.

## 실행 조건

- 4순위(17~19번)는 확인 결과가 나오기 전에는 수정하지 않는다.
- 7번(비용)은 청구 export 활성화 후 실행하면 전후 비교가 가능하다(권장이지 필수는 아님).

## 절차

### 2순위 — 비용 직결

7. **공개 이미지 앞에 Cloudflare 캐시 계층** — `gcs.py`의 `public_asset_url`이
   `https://storage.googleapis.com/{bucket}` 직통 서빙이라 조회마다 서울 리전 egress
   (~$0.12/GB) + Class B 오퍼레이션 + Storage DATA_READ 감사 로그(`infra/audit.tf:20-31`,
   조회 1건 = Cloud Logging 1건)가 1:1로 붙는다. 기존 api-proxy처럼 Cloudflare Worker
   캐시 프록시를 앞에 두면 셋이 동시에 준다(main.tf의 주석 드리프트는 1차 실행에서
   수정 완료). 미루면 차선책으로 `_Default` 로그 싱크에 공개 객체 GET 제외 필터만이라도.

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
    `payments/service.py`(인라인 발송으로 결제 응답 최대 10초 지연 —
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

- 프론트 항목(10·11·16): Aside 브라우저 실측 재현 — 페이지의 fetch/XHR을 집계해
  수정 전 관찰값(진입 시 101개 동시 요청 등)이 사라졌는지 확인.
- api 항목(12·13): 해당 도메인 pytest만 지정 실행 + 로컬 SQL 로그로 쿼리 수 전후 비교.
- worker 항목(14·15): 해당 테스트 파일 지정 실행.
- 인프라 항목(7): `tofu plan`으로 의도한 리소스만 변경되는지 확인 후 apply —
  plan 전에 로컬 `production.tfvars`가 라이브와 정합인지 반드시 확인(gitignore 파일이라
  드리프트 이력 있음, 리뷰의 "인프라 apply 기록" 참조). 응답 헤더의 캐시 적중
  (`cf-cache-status: HIT`)과 Cloud Logging의 DATA_READ 볼륨 감소로 확인.
- 공통: `pnpm build && pnpm typecheck && pnpm test`, `uv run ruff check .`,
  api 스펙이 바뀌는 항목(10번 등)은 `pnpm codegen` 후 생성물 동반 커밋.

## 되돌리는 법 / 상향 신호

- 실행 완료 항목의 롤백은 `docs/reviews/perf-cost-reduction-2026-08-19.md` 참조.

## 기각한 대안

- **pricing/admin_settings 프로세스 TTL 캐시** — 인덱스 걸린 소형 테이블 SELECT라
  요청당 비용이 사실상 0인데, 돈 경로에 최대 TTL만큼의 옛 가격 창이 생긴다. 낙관적
  락은 admin 동시 쓰기 보호일 뿐 api의 stale 읽기와 무관하고, 돈 경로 동작은
  `docs/api-spec/`이 정본이라 가격 반영 시점 변경은 스펙 검토 대상. 효과 ÷ 리스크가
  안 맞아 기각 — pricing SELECT가 프로파일링에서 실제 병목으로 실측되면 재론.
- **SA 개인키를 받아 서명 URL을 로컬 서명으로 전환** — signBlob 호출이 무료임이 확인돼
  이득이 지연 제거뿐인데, 키리스 원칙(audit.tf의 SA 키 알림,
  `docs/plans/cloud-security-hardening.md`)과 상충한다. 실행된 서명 URL 캐시로
  부족하면 재론.
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

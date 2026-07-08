# 점검 보고서 — CHECKLIST 1~4단계 완료 항목 × ARCHITECTURE.md 대조

- 점검 일시: 2026-07-07 (KST) · 기준 커밋: `0e7c968` (branch `feat/check`)
- 범위: `docs/CHECKLIST.md`의 완료([x]) 항목 전부. 0단계(외부 계정 준비물)와 미완료([ ]) 항목은 제외.
- 원칙: **보고만, 수정 없음.** 발견 이슈는 ① 설계 위반 ② 계획된 미완(체크리스트/주석에 이미 명시) ③ 문서 불일치 ④ 테스트 결함으로 분류.

## 총평

완료 표기 항목은 실체와 거의 전부 일치하며, 대원칙 위반(프론트 supabase-js, 워커 내 과금 로직, DDL 직접 실행, 코드젠 드리프트)은 **0건**. 스키마 33테이블 1:1, money.md 전 조항 정합, Edge Functions 전수 귀속 등 핵심 설계는 문서와 코드가 맞물린다. 자동 검증(빌드·린트·타입·테스트 124건·codegen·alembic 드리프트)은 flaky 테스트 1건을 제외하고 전부 통과.

발견은 총 11건(F1~F11):
- **즉시 조치 권고 (2)**: F1 flaky 테스트 수정, F11 인가 매트릭스 누락 행 3개 추가
- **4단계 착수 전 결정 (2)**: F2 마이그레이션 배포 경로, F3 Cloud Scheduler IaC
- **계획된 미완 재확인 (4)**: F4 토큰 과금 연동, F6 모티프 registry, F7 batch OIDC, F10 워커 음성 경로 테스트(우선순위 재조정 권고 포함)
- **문서 보정 (3)**: F4 CHECKLIST 주석, F5 폰트 요건, F8·F9 ARCHITECTURE §4 표

---

## Phase A — 자동 검증 (명령 실행 결과)

| # | 명령 | 결과 | 비고 |
|---|---|---|---|
| A1 | `pnpm install --frozen-lockfile` | ✅ | |
| A2 | `pnpm lint` (Biome) | ⚠️ 에러 1 | **환경 노이즈** — `.claude/settings.local.json`(gitignore된 로컬 세션 파일)의 포맷. 레포 추적 파일 26개 기준으로는 통과. CI 영향 없음 |
| A3 | `pnpm turbo build typecheck test` | ✅ 6/6 태스크 | store·admin 빌드, api-client 타입체크 포함 |
| A4 | `uv sync --all-packages` → `ruff check` + `ruff format --check` | ✅ | 133 파일 포맷 정합 |
| A5 | `uv run pyright` | ✅ 0 errors | |
| A6 | `uv run pytest` (testcontainers 실 Postgres) | ⚠️ **123 passed, 1 failed** | 실패는 F1(타임존 flaky) — 아래 상세 |
| A7 | `PYTHONHASHSEED=1` / `=12345`로 worker 테스트 교차 재실행 | ✅ 각 32 passed | 결정론 계약이 해시시드와 무관함을 스위트 레벨로 재확인 |
| A8 | `pnpm codegen` → `git diff --exit-code -- packages/api-client` | ✅ 드리프트 0 | OpenAPI 스펙 ↔ 커밋된 생성물 일치 |
| A9 | `docker compose up -d` → `alembic upgrade head` → `alembic check` | ✅ "No new upgrade operations detected" | 모델 ↔ 베이스라인 리비전 드리프트 0 |
| A10 | `seed.py` 2회 연속 실행 | ✅ 멱등 | 2회차도 오류 없이 완료 |

### F1 — `test_admin_domain.py::test_stats` 타임존 경계 flaky 【분류: 테스트 결함 — 즉시 수정 권고】

- 증상: `AssertionError: {'order_count': 0, 'revenue': 0} != {'order_count': 2, 'revenue': 12500}`
- 원인: 테스트는 `datetime.now(UTC).date()`로 `stat_date`를 만들지만(`apps/api/tests/test_admin_domain.py:52` 부근), 엔드포인트는 `stat_date`를 **KST 하루**로 해석한다(`apps/api/src/api/domains/admin/router.py:24,162`). KST 00:00~08:59(=UTC 15:00~23:59)에 실행하면 테스트의 UTC 날짜가 KST 기준 전날이 되어 방금 만든 주문이 조회 창 밖으로 빠진다.
- 판정: **엔드포인트는 정상**(한국 커머스 도메인에서 KST 하루 해석이 맞음). 테스트의 날짜 생성만 KST 기준으로 바꾸면 됨. GitHub Actions(UTC)에서는 매일 15:00 UTC 이후 실행 시 항상 실패하므로 CI 신뢰성 이슈 — 우선 수정 권고.

---

## Phase C — 이슈 확정·분류 (사전 탐색 의심 지점 6건)

### F2 — 배포 파이프라인에 `alembic upgrade` 경로 없음 【분류: 설계 갭 — 4단계 착수 전 결정 필요】

`.github/workflows/deploy.yml`과 `infra/README.md` 어디에도 `alembic`/`migrat*` 언급이 없다(grep 0건). ARCHITECTURE §4는 `db/`를 "스키마 단일 소유처"로 규정하지만, 스테이징/프로덕션에 리비전을 적용하는 운영 경로(배포 잡 스텝, Cloud Run job, 수동 절차 문서 중 무엇인지)가 미정. CHECKLIST 2단계의 "스테이징 적용은 4단계 tofu apply 후"가 방법까지는 정하지 않았다. **권고**: 4단계 배포 설계 시 결정하고 `infra/README.md`에 명시.

### F3 — Cloud Scheduler 리소스가 IaC에 없음 【분류: 설계 갭(IaC 누락) — 4단계에서 해소 필요】

`apps/api/src/api/domains/batch/router.py`는 "Cloud Scheduler가 호출"을 전제로 배치 3종(`auto-confirm-orders`·`cancel-stale-orders`·`cleanup-images`)을 구현했고 CHECKLIST 3단계도 "(Cloud Scheduler → api)"로 완료 표기했으나, `infra/` 전체에 `google_cloud_scheduler_job` 리소스가 없다(grep 0건, README에 수동 절차도 없음). 엔드포인트는 실재하므로 3단계 [x]는 유지 가능하지만, **호출 주체가 IaC·문서 어디에도 없어** 4단계 tofu에 추가하지 않으면 배치가 조용히 안 돈다. CHECKLIST 1단계 tofu 항목 또는 4단계 배포 항목에 명시 추가 권고.

### F4 — 토큰 과금이 generate 경로에 미연동 【분류: 계획된 미완 + 문서 불일치】

`tokens/ledger.py`의 `use_tokens`·`refund_failed_generation`은 구현·테스트 완비이나 프로덕션 호출부가 0건(테스트에서만 호출 — grep 확인). `/design/generate`는 현재 과금 없이 워커를 호출한다. 주석상 4단계 워커 경로에서 연동 예정. **문서 불일치**: CHECKLIST 3단계 45행 "토큰 과금" [x]는 "원장 구현 완료, generate 연동은 4단계"로 읽어야 정확 — 주석 보정 권고(4단계 52행 또는 59행에 "토큰 과금 연동" 명시 추가).

### F5 — NotoSansCJKkr 폰트 미번들 【분류: 문서 갱신 사안 (위반 아님)】

ARCHITECTURE §7은 "번들 폰트(NotoSansCJKkr)"를 컨테이너 요건으로 명시하나 worker Dockerfile에 폰트가 없다. 단, 확인 결과 **현 구현은 텍스트를 렌더링할 수 없다**: 엔진은 `<text>`를 생성하지 않고, 외부 SVG를 받는 export 경로도 `render/sanitize.py:10`의 `ALLOWED_TAGS`에 `text`가 없어 원천 차단된다. 즉 폰트가 필요 없는 구조. **권고**: ARCHITECTURE §7의 폰트 요건을 "텍스트 렌더링 도입 시"조건부로 갱신하거나, 향후 모티프/라벨에 텍스트가 들어올 계획이면 그때 Dockerfile에 추가.

### F6 — 모티프 인메모리 `_REGISTRY` 전역 【분류: 계획된 미완 — 위험도 낮음】

`apps/worker/src/worker/motifs/registry.py`의 모듈 전역 mutable dict는 §7 "프로세스-로컬 레지스트리 승계 금지"와 형태상 상충. 단 프로덕션 채움 경로가 없고(등록은 테스트 `golden_helpers.py`뿐), `/motifs/candidates`·`/motifs/generate`는 명시적 501이라 실질 위험 없음. CHECKLIST 4단계 52·56행이 이미 "pgvector store로 교체 남음"으로 추적 중 — 추가 조치 불요, pgvector store 구현 시 registry 제거를 완료 조건에 포함할 것.

### F7 — 배치 인증이 공유 시크릿(batch_token) 【분류: 계획된 미완】

`deps.py:77-83` — Bearer 토큰 단순 비교(비교에 `hmac.compare_digest` 미사용인 점도 교체 시 함께 소멸). 주석에 "4단계에서 OIDC 검증으로 교체하는 유일 지점" 명시, CHECKLIST 46행도 "4단계에서 Scheduler OIDC 연결"로 추적 중. 정합.

---

## Phase B — 설계 문서 대조

### B1 — db/MAPPING.md ↔ 실제 모델 【정합】

- **테이블 33종 1:1 완전 일치**: 모델(`db/src/db/models/*.py`의 `__tablename__`) 33개 = MAPPING §1 비드롭 테이블 33개 = 베이스라인 리비전(`db/migrations/versions/20260706_a658f96021f4_baseline.py`)의 `op.create_table` 33개. 문서에만/코드에만 있는 테이블 없음.
- **드롭 선언 대상 클린**: `ai_generation_logs`, LangGraph checkpoint 4종, `design_chat_*`, `design_generations/variants`, 뷰 19종 전부 모델·리비전에 부재. 베이스라인의 `op.execute`는 `CREATE EXTENSION vector`·`DROP TYPE user_role` 2건뿐(뷰 생성 없음) — ARCHITECTURE §6 "애초에 만들지 않는다" 준수.
- **돈 경로 DB함수→api 이전 표본 6/6 실재**: 주문/토큰/클레임/견적 번호 채번(advisory lock, `api/numbering.py:15-17`), 토큰 원장(만료 필터·유료 우선, `tokens/ledger.py`), 결제 lock/confirm/웹훅 멱등(`payments/service.py`), 주문 생성 3종 트랜잭션(`orders/service.py:272,524,605`), 가입 시 초기 토큰 지급(`auth/service.py:108-154`), 토큰 주문·환불(`tokens/ledger.py:217,441-476`).

### B5 — YeongSeon Edge Functions ↔ api 라우터 【정합, 사소 2건】

엣지펑션 전수(최상위 13개 + generate-tile 서브 2개 = 15종 계수)가 api 라우터 대응 또는 명시적 제거로 전부 귀속. generate-tile·imagekit 잔재 grep 클린(히트는 제거 의도 문서·주석뿐).

| 발견 | 분류 |
|---|---|
| **F8** — `cancel-token-payment`의 새 소유자가 ARCHITECTURE §4 표에는 `api payments`로 적혀 있으나 실제 Toss 취소 로직은 `tokens/ledger.py:441-476`(admin 환불 승인)에 있음. `db/MAPPING.md` §2와는 일치 — ARCHITECTURE §4 표만 어긋남 | 문서 불일치(사소) — ARCHITECTURE §4 표 갱신 권고 |
| **F9** — 엣지펑션 개수 표기: ARCHITECTURE "15종" vs MAPPING §2 "13종" (generate-tile 서브펑션 포함 여부 계수 차이) | 사소 — 필요 시 각주 통일 |

### B2 — 인가 매트릭스 커버리지 【부분 — F11】

인가 집행 자체는 전 엔드포인트에서 확인됨(공통 의존성 `ensure_owner`/`get_admin_user`/user_id 필터/`get_owned_order_for_update`). 다만 CHECKLIST 44행이 [x]로 표기한 "testcontainers 403 테스트"의 **매트릭스(OWNER_CASES 7·ADMIN_CASES 6)가 대표를 빠뜨린 도메인**이 있다.

**F11 — 인가 테스트 매트릭스 누락 행 【분류: 테스트 커버리지 갭 — 보강 권고】**

| 누락 | 상세 |
|---|---|
| **클레임 (완전 누락)** | `DELETE /claims/{claim_id}`(`claims/service.py:128-141`, `ensure_owner`)의 행이 없음. 매트릭스의 `token_refund_cancel`은 tokens 도메인의 별개 리소스라 대신 못 함 — AGENTS.md가 지목한 리소스 중 유일하게 대표 0개 |
| **design jobs (실질 누락)** | `GET /design/jobs/{job_id}`는 세션과 별개 테이블(GenerationJob)의 `ensure_owner`인데 행 없음. 세션의 변경 계열(PATCH·turns·generate·finalize)도 미검증 |
| images 업로드 등록 | 소유권을 403이 아닌 **409** upsert 충돌로 거름(`images/router.py:65-89`) — 현 매트릭스 형태로 못 담는 별도 케이스, 검증 0 |
| 배송지 PUT 편집 / 주문 repair-tracking 2종 | 같은 헬퍼의 다른 경로라 우선순위 낮음 |
| **admin 대표 0개 서브도메인** | admin/inquiries(전체), admin/coupons(5개 전체), admin/orders status·tracking, **admin/token-refunds approve(돈 나가는 경로)** — guard가 단일 공유 함수(`deps.py:55-58`)라 회귀 위험은 낮으나 도메인 추가 시 행 추가 원칙(CHECKLIST 44행) 관점에서 공백 |

**권고**: authz.py는 테이블 주도라 행 추가 비용이 낮다 — 최소 클레임 DELETE, design jobs, admin token-refunds approve 3행은 즉시 추가 가치가 있음.

### B3 — docs/api-spec/money.md ↔ payments 구현 【정합 — 불일치 0】

money.md §5(confirm 8조항)·§6(환불 승인 4조항)·§9(자동 대사 2겹 5조항) 전 조항을 `payments/service.py`·`tokens/ledger.py`와 대조 — **전부 정합**. 핵심 확인:

- **금액은 전 경로 DB 재계산**: confirm은 `sum(total_price)`를 Toss에 전달(클라 `body.amount`는 사전 일치 검증 400에만 사용, `service.py:143-165`), webhook은 Toss 조회 `totalAmount`와 DB합 대조, 환불은 서버 저장값+상한 방어. 클라이언트 금액을 신뢰하는 지점 없음.
- **멱등 = 상태 기반 + work_id 유니크**: confirm 상태 전이 경합 양보, 토큰 `order_{id}`, webhook `webhook_cancel_{id}`, 환불 `refund_{claim_id}_paid`.
- ALREADY_PROCESSED 복구(`service.py:192-213`)·webhook 재검증 대사(`:379-489`) 모두 §9 명세와 일치.

저위험 관찰 2건(위반 아님): ① 샘플 쿠폰 sample_type 미지원 시 Toss 승인 후 critical 경로로 빠짐 — 시드/상품 생성 시점에 sample 데이터 무결성 보장 필요. ② webhook CANCELED는 완료 주문도 강제 취소로 덮음(주석으로 의도 명시, 감사 로그로만 추적).

### B4 — 원본 seamless-tile 테스트 인벤토리 대조 【잔여 정량화 — F10】

원본 `seamless-tile/tests` = **44파일 · 572 테스트 함수** vs essesion worker = 2파일 · 8함수(골든 25 intent + candidates + seed·PYTHONHASHSEED 교차). CHECKLIST 55행 "원본 테스트 인벤토리 전체 이식은 후속"의 실제 잔여를 정량화하면:

| 구분 | 수량 | 내용 |
|---|---|---|
| 골든/별도 테스트로 커버 | ~59 | placement·compose·candidates·seamless·multicolor의 happy-path 출력(골든 25 intent 번들) + health |
| 설계상 드롭 (이식 불필요) | 46 | LangGraph 세션 3파일 — ARCHITECTURE §2 "세션 상태는 api 소유" 근거. 단 **api 쪽 세션 테스트로의 이관 여부는 5단계 /design 설계 시 결정 필요** |
| **이식 필요 — 즉시 가능 (기능 구현됨)** | **~206** | intent validate 거부 36 · placement 불변식 40 · **sanitize 보안 14** · api_generate 계약 17 · config 8 · seamless seam 검사 12 · colorway 11 · angle_snap 수학 13 · export 4 등 |
| 이식 필요 — 기능 선행 (미구현) | ~261 | pgvector 모티프 110 · Recraft/LLM/텍스트 118 · geometry/gate 18 · yarn_dyed fabric ~15 — CHECKLIST §4 잔여 항목과 정확히 일치 |

**F10 — 음성 경로 테스트 공백 【분류: 계획된 미완이나 우선순위 재조정 권고】**: 현 워커 테스트는 결정론 계약(happy-path)만 방어하고, 거부·보안·불변식 경로가 통째로 비어 있다. 특히 `render/sanitize.py`는 구현돼 있으나 **테스트 0건** — 외부 SVG를 받는 export의 보안 경계인데 무방비. 즉시 이식 가능 ~206개 중 위험도 대비 공백이 큰 순서: ① sanitize 보안(14) ② intent validate(36) ③ api_generate 계약(17). 4단계 잔여 작업 착수 시 이 세 묶음을 pgvector 구현보다 먼저 이식할 것을 권고.

---

## 발견 총괄표 (조치 열: 2026-07-07 후속 작업 반영)

| # | 발견 | 분류 | 조치 결과 |
|---|---|---|---|
| F1 | `test_stats` UTC/KST 날짜 경계 flaky (CI에서 매일 15:00 UTC 이후 실패) | 테스트 결함 | ✅ **수정** — 테스트 날짜를 KST로 생성 |
| F2 | 배포 파이프라인에 `alembic upgrade` 경로 없음 | 설계 갭 | ✅ **IaC 준비** — Cloud Run job `migrate`(infra/cloudrun.tf) + deploy.yml 스텝(푸시 후·배포 전 execute --wait). apply는 4단계 |
| F3 | Cloud Scheduler 리소스 IaC·문서 부재 (배치 3종 호출 주체 없음) | 설계 갭(IaC 누락) | ✅ **IaC 준비** — `infra/scheduler.tf` 잡 3종(KST, OIDC) + scheduler SA. apply는 4단계 |
| F4 | 토큰 과금(`use_tokens`) generate 경로 미연동 + CHECKLIST 3단계 표기 모호 | 계획된 미완 + 문서 불일치 | ✅ **주석 보정** — CHECKLIST 45·59행. 연동 자체는 4단계 |
| F5 | NotoSansCJKkr 미번들 — 단 현 구현은 텍스트 렌더 불가 구조라 불필요 | 문서 갱신 사안 | ✅ **문서 갱신** — ARCHITECTURE §7 조건부화 |
| F6 | 모티프 인메모리 `_REGISTRY` (프로덕션 채움 경로 없음, /motifs/* 501) | 계획된 미완(저위험) | 유지 — pgvector store 구현 시 제거 |
| F7 | 배치 인증 공유 시크릿 batch_token | 계획된 미완 | ✅ **구현** — OIDC 검증(audience+email 클레임) + 로컬 폴백 compare_digest (deps.py, 테스트 4건) |
| F8 | `cancel-token-payment` 소유자: ARCHITECTURE §4 표(payments) ≠ 실제(tokens/ledger) | 문서 불일치(사소) | ✅ **문서 갱신** — §4 표 정정 |
| F9 | 엣지펑션 계수 15종 vs 13종 표기 차이 | 사소 | ✅ **각주 통일** — §1.1 |
| F10 | 워커 음성 경로 테스트 공백 — 특히 sanitize 보안 0건. 이식 잔여 ~467(즉시 가능 ~206) | 계획된 미완(우선순위 재조정 권고) | 🔶 **우선 3묶음 이식**(sanitize·validate·generate API — 아래 B1~B3 버그 수정 동반). 나머지는 4단계 잔여 |
| F11 | 인가 매트릭스 누락 행 — 클레임 DELETE(완전), design jobs, admin token-refunds approve 등 | 테스트 커버리지 갭 | ✅ **수정** — OWNER 2행 + ADMIN 4행 추가. images 409는 재확인 결과 기존 `test_images.py:34`가 이미 커버(점검 판정 정정) |

**후속 작업에서 추가 발견·수정된 워커 버그 3건** (테스트 이식 설계 중 드러남):

| # | 버그 | 조치 |
|---|---|---|
| B1 | `render/sanitize.py` — SVG 파싱 실패(`ET.ParseError`)가 `/export`의 `except ValueError`를 비켜가 400 대신 **500** | ✅ ValueError 래핑 |
| B2 | `COLOR_RE`가 원본 기능 명세가 허용하는 bare 색 토큰(Pantone spot·rgb()·named color)을 거부 — 대원칙 "기능 명세 동일 재현" 위반 | ✅ 원본 허용 범위로 확장(골든 무영향 확인) |
| B3 | `libs/obs` RequestIdMiddleware가 인바운드 X-Request-ID를 무정제 에코 — GCS object key(`previews/{rid}/...`)에 `/`·`..` 주입 가능 | ✅ 정제(허용 문자 외 치환·길이 상한) |

## CHECKLIST.md 주석 보정 제안 (체크 상태 변경은 승인 후)

1. **45행(3단계 토큰 과금)**: 주석에 "원장·환불 구현 완료, `/design/generate` 차감 연동은 4단계" 명시 → 4단계 59행(api 연결) 잔여 목록에 "토큰 과금 연동" 추가.
2. **21행 또는 58행(4단계 배포)**: "Cloud Scheduler job 3종 tofu 추가 + alembic 적용 경로 결정" 추가 — F2·F3의 추적처 확보.
3. **44행(인가 테스트)**: [x] 유지 가능하나 "클레임 DELETE·design jobs·admin 환불 승인 행 추가" 후속 메모 권고.
4. **55행(결정론 계약)**: "후속" 잔여를 정량으로 — "이식 필요 ~206(즉시)/~261(기능 선행), sanitize·validate·api 계약 우선".

## 검증 방법 (이 보고서의 재현)

- Phase A: 본문 표의 명령을 순서대로 실행 (Docker 필요). F1은 KST 00:00~08:59 사이 `uv run pytest apps/api/tests/test_admin_domain.py::test_stats`로 재현.
- Phase B·C: 각 판정에 첨부된 `파일:라인` 근거로 대조. 원본 테스트 인벤토리는 `/Users/gimbongseob/git/seamless-tile/tests` (읽기 전용) 기준.

# Admin 재작성 개발 플랜

> 상태: 구현·로컬 출시 검증 완료 — A~J 완료, 스테이징 개통·외부 capability 확인으로 인계
>
> 작성일: 2026-07-12
>
> 추가 검토: 2026-07-12 — 인증 경계, 결제 정합성, 이미지 관계·스토리지 불변식, 동시 수정, 운영 복구, 접근성과 구현 중복을 v1 계약과 구현에 보강
>
> 기준 문서: [`ARCHITECTURE.md`](../../ARCHITECTURE.md), [`docs/CHECKLIST.md`](../CHECKLIST.md), [`packages/shared/AGENTS.md`](../../packages/shared/AGENTS.md), [`docs/api-spec/domains.md`](../api-spec/domains.md), [`docs/api-spec/money.md`](../api-spec/money.md)

## 1. 목표와 현재 상태

`apps/admin`을 기존 YeongSeon 관리자 기능의 의미를 보존하는 운영 도구로 새로 작성한다. 기존 코드는 기능 목록과 도메인 동작을 확인하는 용도로만 사용하며 코드는 이식하지 않는다.

현재는 25개 기존 라우트의 acceptance fixture를 기준으로 관리자 전용 인증·세션, 권한 가드, 서버 페이지네이션·검색·필터, 도메인별 상세 read model과 mutation, 생성 클라이언트 기반 admin UI가 구현되어 있다. 상품·주문·클레임·결제 이상·고객·토큰·쿠폰·견적·문의·가격·설정·생성 운영·Motif 화면과 API/실제 PostgreSQL 회귀 테스트가 추가되었고, 실행 중 발견한 안전성 개선은 아래 "실행 중 추가 검토/개선"에 기록했다.

2026-07-12 기준 최종 `pnpm codegen` 재실행에서 생성물 추가 diff가 없었고, repo 전체 lint/build/typecheck/test, 실제 API+PostgreSQL Playwright admin smoke, Aside 데스크톱·모바일 검증까지 통과했다. 따라서 로컬 구현과 출시 검증은 완료로 판정하며, 실제 GCP·Cloudflare 개통과 외부 capability `real` 확인은 [`docs/OPERATOR-CHECKLIST.md`](../OPERATOR-CHECKLIST.md)의 후속 운영 단계로 인계한다.

구현과 남은 검증은 다음 순서를 지킨다.

1. 화면별 계약과 서버 소유 규칙을 확정한다.
2. 해당 수직 슬라이스의 FastAPI 계약과 실제 PostgreSQL 테스트를 먼저 완성한다.
3. `pnpm codegen`으로 `packages/api-client`를 갱신한다.
4. admin UI를 생성 클라이언트만 사용해 구현한다.
5. 단위 테스트와 Aside 브라우저 검증을 통과한 뒤 다음 슬라이스로 이동한다.

## 2. 확정 설계 결정

| ID | 결정 | 적용 내용 |
|---|---|---|
| D1 | 기존 코드는 이식하지 않는다 | 기존 라우트와 동작만 명세로 대조하고 React·FastAPI 코드는 모두 새로 작성한다. |
| D2 | API가 권한과 업무 규칙의 단일 정본이다 | 주문·클레임·견적 상태 전이, Toss 환불, 토큰 증감, 쿠폰 발급·회수, 가격 계산을 프론트에서 재현하지 않는다. |
| D3 | 관리자 인증 발급 경로를 완전히 분리한다 | `/auth/admin/{login,refresh,logout}`만 `admin|manager` access token과 별도 `admin_refresh_token`을 발급한다. 일반 `/auth/login`, `/auth/refresh`, OAuth는 customer 전용이며, 기존 privileged 이메일과 OAuth identity를 연결하거나 privileged token을 발급하지 않는다. |
| D4 | v1도 최소 권한 역할을 서버에서 강제한다 | `manager`는 조회와 일상 운영, `admin`은 금전·권한·전역 설정 변경을 담당한다. 메뉴 숨김이 아니라 `AdminOnly` 의존성과 실제 PostgreSQL 인가 테스트가 정본이다. 범용 RBAC 편집기는 만들지 않는다. |
| D5 | 데스크톱은 240px 사이드바를 쓴다 | 공용 `Header`는 브랜드·모바일 메뉴·세션 액션만 담당한다. admin 전용 sidebar는 shared 토큰·프리미티브를 조합해 앱 로컬 semantic 컴포넌트로 만들고, `Header`에는 데스크톱 내비를 숨기는 최소 옵션만 추가한다. |
| D6 | admin 전용 운영 패턴은 앱 로컬 조합으로 시작한다 | `AdminSidebar`, native table wrapper, `Pagination`은 shared 시각 프리미티브를 재구현하지 않는 앱 로컬 semantic 조합으로 만든다. 실제로 store까지 2개 앱이 사용할 때만 shared 승격을 제안하며 새 테이블 라이브러리는 추가하지 않는다. |
| D7 | 비민감 목록 상태만 URL에 보존한다 | 상태·날짜·정렬·페이지 같은 비민감 필터는 `URLSearchParams`가 정본이다. 이메일·전화번호·이름 등 PII 검색은 request body와 메모리 상태만 사용해 브라우저 기록·프록시 query log에 남기지 않는다. |
| D8 | 목록 API는 제한된 공통 페이지 계약을 쓴다 | `limit`, `offset`, allowlist `sort`, `direction`, 도메인 필터와 날짜 범위를 받고 `{ items, total, limit, offset }`을 반환한다. 기본·최대 limit, `sort + id` 안정 정렬, 검색 길이·wildcard 제한을 서버가 강제한다. |
| D9 | 허용·차단 액션을 서버가 설명한다 | 상세 응답의 `admin_actions`는 대상 상태, 라벨, 활성 여부, 차단 사유, memo 필요 여부, 위험도를 포함한다. 프론트는 상태 머신을 복제하지 않으며 mutation 시 서버가 다시 검증한다. |
| D10 | 변경은 원자적이고 충돌을 감지해야 한다 | 상품·옵션, 쿠폰, 견적, 가격, 설정은 revision 또는 `expected_updated_at`으로 stale write를 409로 거부한다. 상품+옵션과 가격 일괄 저장은 단일 트랜잭션으로 처리하고, UI는 입력을 보존한 채 비교·재조회 동선을 제공한다. |
| D11 | 통계의 기존 `revenue`는 “주문 금액”으로 표시한다 | 현재 집계는 생성된 모든 주문 상태의 금액 합이다. 결제 완료 매출 정의가 추가되기 전까지 “매출”로 오해하게 표시하지 않는다. |
| D12 | 구 AI 생성 로그는 되살리지 않는다 | 삭제된 `ai_generation_logs`와 `generate-tile` 화면은 구현하지 않는다. `/generation-logs`를 `generation_jobs`와 `seamless_generation_logs`를 보는 “생성 운영” 허브로 재정의한다. |
| D13 | 관리자 세션은 store보다 짧고 탭 간 회전을 직렬화한다 | admin absolute TTL은 환경설정으로 store보다 짧게 두고, role·활성 상태 변경 시 admin 세션만 폐기한다. Web Locks와 BroadcastChannel로 여러 admin 탭의 refresh를 직렬화하고 stale replay의 폐기 범위를 같은 `session_kind`로 제한한다. |
| D14 | admin HTTP 경계는 origin·cache 정책을 별도로 가진다 | `/auth/admin/*`와 `/admin/*`는 정확한 `ADMIN_FRONTEND_ORIGIN`만 허용하고 store origin과 누락·불일치 origin을 거부한다. 응답은 `Cache-Control: no-store`이며, 배포 시 direct `run.app` 우회 차단과 login/refresh rate limit을 출시 게이트로 둔다. |
| D15 | 운영 환경의 외부 연동은 fail closed다 | Toss·GCS·Solapi 같은 필수 capability가 없으면 local/test에서만 DryRun을 허용한다. 그 밖의 환경은 시작/준비 상태를 실패시키거나 해당 위험 mutation·알림을 실패 상태로 남기고, UI에 capability 상태를 표시한다. |
| D16 | 외부 결제 불확실성과 고위험 변경은 최소 영속 기록을 남긴다 | 범용 감사 플랫폼 대신 `payment_incidents`와 append-only `admin_operation_logs`를 둔다. 외부 호출 전에 operation을 영속하고 timeout/혼합 상태는 Toss 조회 기반 대사로만 해결하며, 원문 payment key·PII는 로그에 남기지 않는다. |
| D17 | 운영 화면은 거래 시점의 역사 데이터를 우선한다 | 주문 아이템의 상품·옵션·쿠폰 조건과 견적 배송지는 생성 시 snapshot을 저장한다. 이후 원본 수정·삭제가 과거 주문·견적 표시와 금액 의미를 바꾸지 않아야 한다. |
| D18 | 완료·거절 알림은 작은 도메인 outbox로 보장한다 | 프로세스 내 `BackgroundTasks`만 믿지 않고 claim 상태 변경과 같은 트랜잭션에 `claim_notification_logs` pending row를 남긴다. 전송 재시도·실패 사유·관리자 재시도만 구현하며 범용 메시지 플랫폼은 만들지 않는다. |

최소 권한 행렬은 다음으로 고정한다. 각 mutation의 최종 허용 여부는 역할뿐 아니라 리소스 상태·도메인 불변조건까지 서버가 함께 판단한다.

| 기능 | `manager` | `admin` |
|---|---:|---:|
| 관리자 리소스 조회, 주문·견적·문의·일반 클레임 처리, 송장 입력 | 허용 | 허용 |
| 상품·옵션, 쿠폰 정의 수정 | 허용 | 허용 |
| 고객 토큰 지급·회수 | 거부 | 허용 |
| Toss 취소·환불 승인, payment incident 대사·해결 | 거부 | 허용 |
| 고객군 쿠폰 일괄 발급·회수 | 거부 | 허용 |
| 가격·전역 설정 변경 | 거부 | 허용 |

## 3. 범위와 라우트

상세 화면은 정보량, 공유 가능한 URL, 새로고침 복구를 고려해 독립 페이지로 만든다. 기존 `/show/:id`, `/create`, `/edit/:id` 주소는 아래 canonical 주소로 `Navigate`하여 북마크 호환만 유지한다.

| 영역 | canonical 라우트 | 핵심 기능 | 기존 주소 호환 |
|---|---|---|---|
| 인증 | `/login` | 관리자 전용 로그인, 세션 복구, 비관리자 거부 | 동일 |
| 대시보드 | `/` | 기간·주문 유형 통계, 미처리 클레임·문의, 최근 주문·견적 | 동일 |
| 결제 이상 | `/incidents`, `/incidents/:incidentId` | 미해결 결제·취소 불일치 queue, Toss 재조회·대사·해결 이력 | 신규 |
| 주문 | `/orders`, `/orders/:orderId` | 검색·필터, 유형별 상세, 송장, 허용 상태 전이·로그 | `/orders/show/:id` |
| 상품 | `/products`, `/products/new`, `/products/:productId/edit` | 상품·이미지·재고·옵션 원자적 생성·수정 | `/products/create`, `/products/edit/:id` |
| 쿠폰 | `/coupons`, `/coupons/new`, `/coupons/:couponId` | 생성·수정, 대상 미리보기, 발급·회수, 발급 이력 | `/coupons/create`, `/coupons/edit/:id` |
| 견적 | `/quote-requests`, `/quote-requests/:quoteId` | 금액·조건·관리자 메모, 이미지, 상태 전이·로그 | `/quote-requests/show/:id` |
| 클레임 | `/claims`, `/claims/:claimId` | 취소·반품·교환·토큰 환불, 배송 정보, 상태 전이·로그 | `/claims/show/:id` |
| 고객 | `/customers`, `/customers/:userId` | customer 역할만 검색, 프로필, 주문·쿠폰·토큰 잔액/이력, 토큰 지급·회수 | `/customers/show/:id` |
| 문의 | `/inquiries`, `/inquiries/:inquiryId` | 미답변 필터, 고객·상품 문맥, 답변 | `/inquiries/show/:id` |
| 가격 | `/pricing` | 봉제·수선·원단·샘플·토큰 가격 일괄 조회·저장 | 동일 |
| 생성 운영 | `/generation-logs`, `/generation-logs/jobs/:jobId`, `/generation-logs/seamless/:logId` | 전체 작업 상태와 Seamless 결과·지연·오류·SVG 재조회 | 아래 예외 참조 |
| Motif | `/motifs` | Motif SVG·메타데이터 읽기 전용 조회 | 동일 |
| 설정 | `/settings` | 기본 택배사, 신규 사용자 초기 토큰의 typed 설정 | 동일 |
| 오류 | `*` | 404와 대시보드 복귀 | 신규 |

생성 로그 주소 호환 규칙은 다음과 같다.

- `/seamless-logs` → `/generation-logs?tab=seamless`
- `/seamless-logs/:id` → `/generation-logs/seamless/:id`
- 기존 `/generation-logs/:id`는 데이터 원본이 삭제되었으므로 상세 호환을 제공하지 않고 생성 운영 허브로 보낸다.

## 4. API 선행 작업

모든 `/admin/*` 라우트는 FastAPI의 `AdminUser`로 `admin|manager`를 강제하고 D4의 금전·전역 변경은 `AdminOnly`를 추가 적용한다. 인가 테스트는 mock이 아니라 testcontainers의 실제 PostgreSQL을 사용한다. API 스펙을 바꾼 커밋에는 반드시 생성된 `packages/api-client`를 포함한다.

### 4.1 공통 계약

- 일반 `/auth/login`, `/auth/refresh`, OAuth callback은 `role=customer`만 access/refresh token을 발급한다. OAuth 이메일이 기존 `admin|manager` 계정과 일치하면 identity 연결과 로그인을 거부한다.
- `POST /auth/admin/login`: 정확한 admin origin, 비밀번호, 활성 상태, `admin|manager` 역할을 모두 검증한 뒤에만 토큰을 발급하며 실패 응답에 cookie를 남기지 않는다.
- `POST /auth/admin/refresh`, `POST /auth/admin/logout`: `admin_refresh_token`만 읽고 회전·폐기한다. stale replay·역할 변경·비활성화 시 같은 사용자의 `admin` 세션만 폐기하고 store 세션은 유지한다.
- Alembic으로 `refresh_tokens.session_kind`(`store|admin`, 기존 row는 `store`)와 admin absolute expiry를 추가한다. cookie 이름·path·SameSite 계약을 store와 분리하고 모든 admin 응답에 `Cache-Control: no-store`를 적용한다.
- 브라우저용 `/auth/admin/*`, `/admin/*`는 정확한 `ADMIN_FRONTEND_ORIGIN`을 의존성으로 검증한다. store origin과 origin 누락·불일치의 음성 테스트를 둔다.
- 모든 mutation은 생성 또는 전달한 `request_id`를 응답·구조화 로그·operation/incident에 연결한다. 토큰·결제·쿠폰 일괄 처리에는 payload와 결합된 idempotency key를 사용하고 같은 key의 다른 payload는 409로 거부한다.
- 관리자 목록은 공통 `Page[T]` envelope, 기본/max limit, allowlist sort, `sort + id` tie-breaker를 사용한다. `q` 길이·escape·wildcard를 제한하고 목록 projection에서 SVG·raw prompt·대형 이미지 payload를 제외한다.
- 이메일·전화번호·이름 검색은 `/admin/customers/search`처럼 body 기반 endpoint로 분리하고 role을 서버에서 `customer`로 고정한다. privileged·inactive 계정은 토큰·쿠폰 대상에 포함하지 않는다.
- 관리자 상세 응답은 화면에 필요한 관계 데이터를 한 번에 제공하되 무제한 하위 목록은 별도 paged endpoint로 분리한다.
- 변경 응답은 최신 리소스와 `admin_actions`를 반환한다. 편집 mutation은 revision 또는 `expected_updated_at`을 받고 stale write를 409로 거부한다.
- 오류는 기존 한국어 도메인 의미를 보존한다. DB unique/check/FK 위반을 안정적인 409 또는 field-level 422 코드로 변환하고 내부 SQL·객체 경로를 노출하지 않는다.
- 목록 필터·정렬 경로에는 Alembic index를 함께 설계하고 대표 데이터 규모의 `EXPLAIN (ANALYZE, BUFFERS)`를 구현 PR 근거로 남긴다.
- 모든 스키마·기본 설정 row 변경은 `db/` Alembic revision만 사용하며 직접 DDL을 실행하지 않는다. fresh DB에도 allowlist 설정 row를 data migration/seed로 보장하고 누락 시 임의 upsert 대신 명시적인 `missing_configuration` 오류를 반환한다.

`admin_actions`의 최소 의미는 다음과 같다.

```text
kind, target_status, label, enabled, blocking_reason, requires_memo, destructive
```

배송장 입력, 토큰 환불 승인처럼 상태 변경 외 입력이 필요한 액션은 `kind`로 구분한다. 차단된 액션도 운영자가 이유를 알 수 있게 내려줄 수 있으나 실행 버튼은 제공하지 않는다. 실제 전이 가능 여부와 불변조건은 mutation 시점에 서버가 다시 검증한다.

### 4.2 화면별 계약 차이

| 도메인 | 현재 가능한 기능 | 구현 전에 보강할 계약 |
|---|---|---|
| 대시보드 | 오늘/기간 주문 수·금액 | 명시적 `order_amount` 의미, 최근 주문 limit, 미처리 클레임·문의와 open payment incident total, 데이터 기준 시각 |
| 결제 이상 | 없음 | confirm/refund/partial cancel/mixed state/amount mismatch incident queue·상세, Toss 상태 재조회, 멱등 대사·해결 memo/actor |
| 주문 | 목록, 상태·송장 변경, 일부 `admin_actions` | 고객·배송지·아이템 snapshot·유형별 정보·상태 로그·활성 클레임·같은 `payment_group_id` 주문을 포함한 상세, `admin_actions`, 검색·필터·페이지네이션 |
| 클레임 | 목록, 상태 변경, 토큰 환불 승인 | 주문·고객·배송·수선 수거/영수증/사진 문맥, 반품·재발송 송장 수정, 결합 timeline, 타입별 `admin_actions`, 알림 전송 상태 |
| 견적 | 목록, 금액·조건·메모 포함 상태 변경 | 고객·배송지 snapshot·이미지·상태 로그 상세, `admin_actions`, 필터·페이지네이션 |
| 문의 | 목록, 답변 | `user_id`와 고객·상품 요약, 상세 조회, 상태·검색·페이지네이션 |
| 고객 | 사용자 목록, 토큰 지급·회수 | `/admin/customers`가 customer role만 반환하는 상세·검색·상태 필터, 주문·쿠폰·토큰 잔액/원장 paged 조회 |
| 쿠폰 | 생성, 목록, 발급·회수 | 수정·상세, 발급 시점 금전 조건 snapshot, active 대상 검증, 서버측 고객군 preview/멱등 issue, actor·페이지네이션 |
| 상품 | 생성·수정, 옵션 전체 교체 | 관리자 목록, 안정적인 option ID diff와 optimistic concurrency, 상품+옵션 단일 트랜잭션, product GCS 서명 업로드·검증·확정 |
| 가격 | 없음 | 카테고리·키 allowlist 기반 조회, 전체 검증 후 일괄 저장, `updated_by/updated_at` 반환 |
| 설정 | 없음 | `default_courier_company`, `design_token_initial_grant`만 노출하는 typed 조회·수정, 기본 row migration, `updated_by/updated_at` 반환 |
| 생성 작업 | 본인 작업만 조회 | 관리자 전체 `generation_jobs` 통계·목록·상세, 상태·기간·사용자 필터 |
| Seamless 로그 | 없음 | 성공뿐 아니라 sanitized 실패 로그, 실제 `render_ms`, 통계·목록·상세, 안전한 후보 SVG, 공개 결과 content-hash URL과 비공개 입력 만료 URL 구분 |
| Motif | worker 조회만 존재 | 관리자용 목록·상세 읽기 계약과 서버 페이지네이션 |

### 4.3 도메인별 안전 조건

- 주문·클레임·견적: 화면이 전이표를 소유하지 않는다. 활성 클레임 차단, 롤백 memo, 송장 필수 조건은 서버가 재검증하고 actor·request ID가 있는 상태 로그를 남긴다. 클레임 완료·거절 알림은 상태 변경 트랜잭션에 pending outbox row를 함께 기록해 재시도 가능하게 한다.
- 역사 snapshot: 주문 생성 시 상품명·코드·이미지·옵션명과 적용 쿠폰 표시명·금전 조건을 order item에 보존한다. 견적은 `shipping_address_snapshot`을 저장하고 원본 주소 FK를 nullable/`SET NULL`로 전환한다. 기존 데이터는 best-effort backfill하며 상세는 snapshot을 우선 읽는다.
- 결제: 외부 Toss 호출 전에 고유 operation과 예상 금액을 영속한다. timeout이나 Toss 성공 후 DB 실패는 `payment_incidents(type, status, operation_id, request_id, actor_id, refs, redacted amounts, resolution)`에 남기고 성공으로 응답하지 않는다. blind retry를 금지하고 Toss 조회 → 금액 검증 → 멱등 DB 반영 → resolve 순서의 대사 endpoint만 제공한다.
- 고위험 변경: 토큰 조정, 쿠폰 일괄 발급·회수, 가격·설정 변경은 append-only `admin_operation_logs(operation_id unique, actor_id, action, target ref/count, reason, redacted before/after, request_id, created_at)`에 남긴다. 상태별 기존 로그를 대체하거나 원문 결제키·PII를 중복 저장하지 않는다.
- 상품: 상품 본문, 옵션 diff, 이미지 참조 확정을 한 트랜잭션으로 처리한다. 옵션은 저장 때마다 DELETE+INSERT하지 않고 안정적인 ID로 create/update/delete하며 `(product_id, name)` unique, `additional_price >= 0`, revision 제약을 둔다. 삭제된 옵션을 담은 cart line은 다른 옵션으로 재매핑하지 않고 unavailable로 표시한다.
- 이미지·SVG: signed read는 임의 `object_key`를 받지 않고 order/claim/quote/job 등 entity 관계와 권한을 검증해 발급한다. product upload는 kind, MIME·크기·소유권을 검증하고 미확정 객체는 cleanup한다. 외부 SVG는 sanitize한 `<img>`/blob URL로만 표시하고 `dangerouslySetInnerHTML`을 금지한다.
- 쿠폰: 전체·최근 30일 가입·이번 달 생일·구매·미구매·휴면 고객군 계산과 예상 인원/샘플을 서버가 담당한다. active customer와 활성·미만료 coupon만 대상으로 하며 percentage 1..100, 최대 할인액·KST 만료를 검증한다. 발급 시 금전 조건을 `user_coupons`에 snapshot하고 서버 `INSERT … SELECT` batch와 idempotency key로 preview와 authoritative count를 반환한다.
- 가격·설정: 임의 key 편집기를 만들지 않는다. 서버 allowlist, domain validation, stale revision 검사를 모두 통과한 경우에만 저장한다. fresh DB에 `default_courier_company`를 포함한 모든 allowlist row가 존재해야 한다.
- 생성 로그: worker는 success/partial뿐 아니라 예외도 sanitized error와 실제 `render_ms`로 기록한다. 목록에서는 사용자 식별자·raw prompt·intent·SVG·비공개 객체 경로를 제외하고, 상세에서는 운영 진단에 필요한 저장 prompt 원문, allowlist로 투영한 확정 intent와 안전화한 SVG만 제공한다. 확정 결과는 content-hash URL, 비공개 입력·첨부는 관계 검증된 만료 signed URL을 사용한다.
- 외부 capability: local/test가 아닌 환경에서 Toss·GCS·Solapi 필수 설정 누락을 성공 DryRun으로 바꾸지 않는다. readiness 또는 mutation 503으로 fail closed하고, 알림 provider 장애는 outbox를 failed/pending으로 남겨 재처리한다.
- 관리자 bootstrap: nonlocal seed의 기본 비밀번호를 금지한다. Secret Manager/env를 요구하는 일회성 `bootstrap_admin` 명령과 계정 비활성화·role 변경·비밀번호 재설정 시 admin refresh 폐기, 복구 runbook을 배포 인계에 포함한다. 계정 관리 UI는 만들지 않는다.

## 5. 프론트엔드 구조

예상 구조는 아래와 같다. 이름은 역할을 설명하기 위한 기준이며 구현 중 불필요한 계층은 만들지 않는다.

```text
apps/admin/src/
├── app/
│   ├── providers/        # QueryClient, session, Snackbar
│   ├── router/           # lazy routes, guards, legacy redirects
│   └── styles/
├── entities/             # order, claim, product 등 API 응답 표시 모델
├── features/             # 로그인, 상태 변경, 토큰 조정, 쿠폰 발급 등 사용자 액션
├── pages/                # 라우트 단위 화면
├── widgets/
│   ├── admin-shell/      # shared 프리미티브를 조합한 admin 전용 앱 셸
│   └── admin-table/      # native table·filter·pagination semantic 조합
└── shared/
    └── lib/              # generated client, query keys, URL query, formatters
```

`packages/shared/AGENTS.md`의 “2개 이상 앱에서 사용” 기준을 따른다. 현재 admin만 필요한 내비·테이블·페이지네이션은 shared의 토큰·프리미티브·`ScrollFog`를 조합한 앱 로컬 semantic 컴포넌트로 만들며, 색·간격·버튼·폼 같은 시각 프리미티브를 재구현하지 않는다. store에서 실제 재사용 요구가 생긴 뒤에만 shared 승격을 제안한다.

### 5.1 앱 기반

- essesion API 요청은 `@essesion/api-client`와 generated TanStack Query options/mutations만 사용한다. 직접 `fetch`, axios, Supabase 클라이언트를 금지한다. API가 발급한 signed URL로 GCS 객체를 `PUT`하는 업로드만 예외로 두고, 기존 store 업로드 헬퍼와 같은 검증·timeout·오류 계약을 가진 좁은 테스트 헬퍼를 사용한다.
- store와 같은 access-token 메모리 보관 원칙을 따르되 관리자 인증은 독립 구현한다. 탭 내부 single-flight에 더해 Web Locks로 refresh를 탭 간 직렬화하고 BroadcastChannel로 성공·로그아웃만 전달한다.
- 401은 관리자 refresh 뒤 idempotent GET/HEAD만 한 번 자동 재시도한다. 금전·상태 mutation은 자동 또는 optimistic 재전송하지 않으며 idempotency key를 유지한 채 사용자가 결과를 확인하고 다시 실행한다. 일반 리소스 403은 화면 오류로 처리하고 role loss가 확인될 때만 세션과 Query cache를 비운다.
- `VITE_API_BASE_URL` 설정과 `credentials: include`를 generated client 한 곳에서 구성한다.
- Vite dev port를 API CORS 기본값과 같은 `3001`로 고정한다.
- 도메인별 query-key factory와 mutation invalidation 표를 먼저 만든다. 필터 변경은 이전 request의 `AbortSignal`을 전달하고, 이전 page를 표시하는 동안 `aria-busy`와 갱신 상태를 노출하며 stale row action은 잠근다.
- 조회는 window focus refetch, “마지막 갱신” 시각, 수동 새로고침을 제공하되 dirty form을 덮어쓰지 않는다. generation nonterminal과 open payment incident만 문서가 visible일 때 polling하고 hidden/terminal에서 중지한다.
- 상품·쿠폰·견적·가격·설정 폼은 route blocker와 `beforeunload`로 미저장 변경을 보호한다. admin draft·PII·Query cache는 localStorage/sessionStorage에 영속하지 않는다.
- 각 라우트는 lazy import하며, 로그인 bootstrap 중에는 셸이나 보호 데이터를 잠깐 노출하지 않는다.

### 5.2 UI 규칙

- `@essesion/shared` 우선순위 사다리, 토큰, 레이아웃 프리미티브를 준수한다. raw 색상·간격·radius·shadow 값을 쓰지 않는다.
- 앱 셸은 skip link, `header`·`nav`·`main` landmark, sidebar `aria-current`를 제공한다. 라우트 전환 시 문서 제목을 갱신하고 `h1`에 focus하며 dialog 종료 후 실행 버튼으로 focus를 복귀한다.
- 목록은 native `<table>`을 사용하고 caption 또는 `aria-label`, `th scope`, 정렬 버튼과 `aria-sort`, `nav` pagination과 `aria-current`, 결과 갱신 `aria-live`/`aria-busy` 계약을 지킨다.
- 클릭 가능한 `<tr>`를 만들지 않는다. 첫 식별 셀에 명시적 상세 `Link`를 두고 행 액션의 accessible name에 주문·고객 등 대상 ID를 포함한다.
- 본문 기본 typography는 `bodySm`, 수량·금액·날짜 열은 tabular nums와 우측 정렬을 사용한다.
- 모든 데이터 화면에 loading, 최초 데이터 없음, 필터 결과 없음, error, stale/refetch 상태를 구분한다. 목록 total, 활성 필터, 전체 초기화와 상세 복귀 시 scroll/focus 복원을 제공한다.
- 목록 필터는 데스크톱에서 상단 바, 모바일에서 `ResponsiveModal` 또는 `BottomSheet`로 제공한다.
- 표 컨테이너는 `min-width: 0`을 보장하고 작은 화면에서 낮은 우선순위 열을 먼저 숨긴 뒤 `ScrollFog`를 focus 가능한 이름 있는 영역으로 제공한다. 390/767/768/1024/1440px와 200% zoom에서 수평 overflow와 조작 가능성을 검증한다.
- 위험 작업은 대상·변경 내용·영향을 보여주는 `AlertDialog`, 긴 편집은 독립 페이지, 짧은 보조 입력은 `ResponsiveModal`을 사용한다. pending 중 중복 제출을 막고 완료 후 최신 server state를 재조회한다.
- 모든 form은 visible label을 사용한다. 제출 오류는 요약에 focus한 뒤 첫 invalid field로 이동하고 field error와 연결한다. 성공·비동기 오류는 전역 `SnackbarHost`와 적절한 `aria-live`로 알리며 reduced motion을 존중한다.
- 날짜 경계와 표시는 `Asia/Seoul`로 명시하고 request/order/claim ID는 문맥 있는 복사 액션을 제공한다.

## 6. 구현 단계

각 단계는 API 테스트 → codegen → UI → UI 테스트 → Aside 검증 순서로 닫는다. 한 단계가 완료되기 전에 다음 단계 화면의 임시 mock 데이터를 만들지 않는다.

### A. 계약 기준선과 인증

- [x] 25개 기존 라우트의 표시 필드·액션을 이 문서의 라우트와 대조해 API acceptance fixture로 고정한다.
- [x] admin-local sidebar·native table·pagination의 semantic/a11y 계약을 기록하고 shared scroll 문서 링크 드리프트를 정리한다.
- [x] 일반 login/refresh/OAuth를 customer 전용으로 제한하고 privileged identity 연결을 차단한다.
- [x] `/auth/admin/{login,refresh,logout}`, 별도 cookie, 짧은 absolute TTL, `refresh_tokens.session_kind`와 같은 kind 범위 폐기 테스트를 추가한다.
- [x] 정확한 admin Origin, `no-store`, request ID, `AdminUser`/`AdminOnly` 역할 행렬을 공통 의존성으로 추가한다.
- [x] 제한·안정 정렬이 있는 paged 모델, body 기반 PII 검색, revision/409 공통 오류 계약을 추가한다.
- [x] nonlocal DryRun fail-closed, capability/readiness, one-time admin bootstrap과 세션 폐기 절차를 추가한다.
- [x] `pnpm codegen` 후 auth·page 타입과 query options가 생성되는지 확인한다. — *마지막 API 변경을 포함해 재생성했으며 생성 파일 SHA-256이 전후 동일해 drift 0을 확인했다.*

구현 근거: [`docs/fixtures/admin-route-acceptance.json`](../fixtures/admin-route-acceptance.json), [`docs/admin-ui-contract.md`](../admin-ui-contract.md), `test_admin_acceptance_fixture.py`, `test_auth.py`, `test_admin_hardening.py`, `test_admin_bootstrap.py`.

완료 기준: customer 계정은 관리자 token을 받지 못하고, privileged 계정은 일반 login/OAuth로 token을 받지 못한다. store와 admin 동시 로그인, stale refresh replay, role 변경이 서로 다른 `session_kind`를 폐기하지 않는다. store origin·direct non-proxy 운영 요청·필수 secret 없는 위험 mutation이 거부되고 모든 관리자 목록이 같은 page metadata 의미를 사용한다.

### B. admin 앱 기반과 셸

- [x] `@essesion/api-client`, Vitest, Testing Library, user-event, jsdom과 admin `test` script를 workspace catalog로 추가한다.
- [x] generated client, query-key/invalidation 표, QueryClient, session bootstrap, 탭 내부·탭 간 refresh 직렬화를 구성한다.
- [x] `/login`, `ProtectedRoute`, 역할 가드, 404, error boundary, cache 정리, Snackbar host를 구현한다.
- [x] 데스크톱 sidebar, 모바일 Header menu, active route, logout을 구현한다.
- [x] admin-local native table·pagination과 비민감 URL filter/PII memory search helpers를 shared 프리미티브로 조합한다.
- [x] skip link·landmark·route title/heading focus·dirty form blocker의 앱 공통 계약을 구현한다.

구현 근거: `apps/admin/src/app`, `apps/admin/src/widgets/admin-{shell,table}`, `admin-api-client.test.ts`, `router.test.tsx`, `admin-table.test.tsx`, `pagination.test.tsx`, `url-query.test.ts`.

완료 기준: 새로고침 세션 복구, 두 admin 탭 동시 refresh, store 세션 공존, refresh 실패, 일반 403의 현재 세션 유지, role loss의 세션·cache 정리, logout, legacy redirect를 단위 테스트하고 1440px·390px에서 셸을 Aside로 확인한다.

### C. 대시보드와 주문

- [x] 대시보드를 기간·주문 유형 필터와 URL query로 구현한다.
- [x] “주문 금액”, 주문 수, 미처리 클레임·문의·payment incident, 최근 주문·견적을 각각 독립 query로 조합한다.
- [x] 카드와 목록에 기준 시각·수동 새로고침을 표시하고 open incident만 visible 상태에서 갱신한다.
- [x] 주문 목록의 검색·유형·상태·기간·정렬·페이지네이션을 구현한다.
- [x] 주문 item snapshot, 관련 `payment_group_id` 주문, 상태 로그, 활성 클레임을 포함한 상세 read model을 구현한다.
- [x] 서버 `admin_actions` 기반 상태 변경·롤백 memo·송장 입력을 구현한다.

구현 근거: `test_admin_orders.py`, `apps/admin/src/pages/dashboard.test.tsx`, `apps/admin/src/pages/orders/{list,detail}.test.tsx`.

완료 기준: 일반·주문제작·수선·토큰·샘플 주문 fixture가 생성 시점 상품·옵션·쿠폰 정보를 표시하고, 활성 클레임·송장 필수·불법 전이를 서버가 거부한다. 비민감 URL 상태는 복구되며 PII 검색어는 주소·persistent storage에 남지 않는다.

### D. 클레임과 결제 이상

- [x] 타입·상태·기간별 클레임 목록과 상세를 구현한다.
- [x] 취소·반품·교환 배송, 반품·재발송 송장 수정, 수선 수거·영수증·사진과 결합 timeline을 표시한다.
- [x] 서버 `admin_actions` 기반 진행·거부·롤백과 memo 입력을 구현한다.
- [x] claim 알림 outbox의 pending/sent/failed, 재시도 횟수·오류와 관리자 재시도를 구현한다.
- [x] `/incidents` queue·상세와 Toss 조회 → 금액 검증 → 멱등 반영 → 해결 memo 동선을 구현한다.
- [x] 토큰 환불 승인·거절 결과를 claim과 payment incident 양쪽에서 연결해 표시한다.

구현 근거: `test_admin_phase_d.py`, `apps/admin/src/pages/claims/detail.test.tsx`, `apps/admin/src/pages/incidents/detail.test.tsx`. 외부 결제 호출 전 operation 영속성과 송장 변경 audit까지 실제 PostgreSQL 회귀 테스트에 포함했다.

완료 기준: 클레임 유형별 전이·송장·로그, 알림 유실 후 재시도, 토큰 원장과 Toss 취소의 멱등성, ambiguous timeout·DB 실패 대사 테스트가 통과한다. open incident는 dashboard와 queue에서 사라지지 않고 manager의 환불·resolve는 403이다.

### E. 고객·토큰·쿠폰

- [x] customer role로 고정된 body 기반 PII 검색·상태 필터·목록과 상세를 구현한다.
- [x] 고객별 주문·쿠폰·토큰 잔액/원장에 독립 페이지네이션을 적용한다.
- [x] 토큰 지급·회수에 client operation UUID, 수량·사유·위험 확인, append-only operation log를 적용한다.
- [x] 쿠폰 목록·생성·수정·상세·발급 이력·회수를 구현한다.
- [x] 쿠폰 금전 조건의 발급 시점 snapshot과 active/unexpired 대상 검증을 migration·계약에 반영한다.
- [x] 고객군 조건, 예상 대상 수, paged 미리보기, 서버 batch·멱등 발급 결과와 actor 기록을 구현한다.

구현 근거: `test_admin_management.py`, `test_admin_domain.py`, `test_token_adjustment_safety.py`, `apps/admin/src/pages/customers/*.test.tsx`, `apps/admin/src/pages/coupons/*.test.tsx`.

완료 기준: 브라우저가 전체 고객/주문을 내려받지 않고 고객군을 계산하며 privileged·inactive 계정은 대상에서 제외된다. 쿠폰 template을 수정해도 이미 발급된 조건이 바뀌지 않고, 같은 batch/operation 재요청은 중복 권리를 만들지 않는다. 토큰 조정 후 잔액·원장·operation log가 함께 확인된다.

### F. 상품·옵션·이미지

- [x] 관리자 상품 목록과 검색·필터·페이지네이션을 구현한다.
- [x] 생성/수정 폼의 기본 정보, 가격, 재고, 옵션 검증을 구현한다.
- [x] product GCS 서명 업로드, 미리보기, 제거, 저장 확정 흐름을 구현한다.
- [x] 안정적인 option ID diff, 제약, revision을 적용해 상품+옵션+이미지 참조를 한 API 트랜잭션으로 저장한다.
- [x] stale 409에서 사용자 입력을 보존하고 server 변경과 비교·재조회하는 UI를 구현한다.

구현 근거: `test_admin_products.py`, `test_cart.py`, `apps/admin/src/pages/products/{list,new,edit,upload}.test.*`. signed PUT create-only precondition, legacy URL 보존, 삭제 옵션 unavailable 회귀를 추가했다.

완료 기준: 옵션 유무에 따른 재고 규칙, 옵션 ID 보존·동명이름/음수 추가금 제약, cart의 삭제 옵션 unavailable 처리, 이미지 MIME·크기·소유권, stale save와 부분 저장 방지, 임시 upload cleanup이 실제 PostgreSQL과 local/test GCS DryRun으로 검증된다.

### G. 견적과 문의

- [x] 견적 목록·상세·참고 이미지·금액·조건·관리자 메모를 구현한다.
- [x] 견적 배송지 snapshot/backfill, revision과 상태 로그를 서버 액션 기반으로 구현한다.
- [x] 문의 목록·미답변 필터·상세의 고객/상품 문맥을 구현한다.
- [x] 주문·클레임·견적의 entity 관계 검증형 signed read와 만료 재발급을 구현한다.
- [x] 문의 답변 입력, actor·재조회·중복 제출 방지를 구현한다.

구현 근거: `test_admin_quotes_inquiries.py`, `test_order_image_security.py`, `apps/admin/src/pages/quotes/*.test.tsx`, `apps/admin/src/pages/inquiries/*.test.tsx`.

완료 기준: 원본 배송지 삭제 뒤에도 견적의 역사 정보가 남고, 임의 object key로 다른 고객 파일을 조회할 수 없다. 견적·문의 동시 변경의 409/오류를 UI가 입력 손실 없이 표시한다.

### H. 가격과 설정

- [x] 가격 카테고리별 현재 값, 단위, 설명, 수정 시각/수정자를 표시한다.
- [x] 전체 validation을 통과해야 저장되는 일괄 가격 편집을 구현한다.
- [x] Alembic data migration으로 기본 row를 보장한 `default_courier_company`와 `design_token_initial_grant` typed 설정을 구현한다.
- [x] 저장 전 변경 요약·사유·revision 확인, append-only operation log와 저장 후 최신값 재검증을 구현한다.

구현 근거: `test_admin_management.py`, `test_auth.py`, `apps/admin/src/pages/pricing.test.tsx`, `apps/admin/src/pages/settings.test.tsx`. 초기 토큰 설정은 누락·비정수·범위 초과를 임의 기본값으로 대체하지 않고 명시적으로 실패한다.

완료 기준: manager의 변경과 임의 key 조회·수정은 거부되고, 누락 설정은 자동 생성되지 않고 명시적 오류가 된다. 잘못된 금액·토큰 값, stale revision, 일부 항목만 저장되는 상황이 서버에서 차단된다.

### I. 생성 운영과 Motif

- [x] `/generation-logs`에 작업/Seamless 두 탭을 구현한다. 기간·상태는 공통, 사용자는 작업 탭, `request_id`는 Seamless 탭에서만 필터한다.
- [x] generation job 상세에 단계·시도·실패·결과 객체 상태를 표시한다.
- [x] worker가 성공/부분 성공/예외를 모두 sanitized error와 실제 `render_ms`로 기록하게 한다.
- [x] Seamless 상세에 상태·후보 SVG·성능 정보를 안전한 `<img>`/blob URL로 표시한다.
- [x] Motif SVG와 메타데이터를 같은 안전 렌더링 규칙으로 읽기 전용 목록에 표시한다.
- [x] 민감 필드 마스킹과 공개 결과 content-hash URL을 검증한다. 비공개 이미지 입력은 `/design` v2 이연 범위라 현재 운영 로그에는 생성되지 않는다.

구현 근거: `test_admin_generation.py`, `apps/worker/tests/test_generation_logging.py`, `apps/admin/src/pages/generation/*.test.tsx`, `apps/admin/src/pages/motifs/list.test.tsx`. Alembic `20260712_f18a6c2d9b40_seamless_reference_image_relation.py`와 관계 검증형 read endpoint는 v2 이미지 입력 writer를 위한 선행 기반이며, 현재 완료 근거로 세지 않는다.

완료 기준: 구 `ai_generation_logs`를 참조하지 않고 실패한 작업까지 관리자 전체에서 조회한다. 공개 생성물 URL은 content-hash 정책을 따르고 목록 응답에는 raw prompt·intent·SVG·private 객체 경로·시크릿·불필요한 PII가 노출되지 않는다. 저장 prompt 원문과 allowlist 확정 intent는 관리자 상세에서만 표시하고 SVG는 재검사된 격리 이미지로만 렌더해 script가 실행되지 않는다.

### J. 회귀 검증과 배포 인계

- [x] 모든 목록의 loading/empty/error/refetch와 모든 mutation의 pending/error/success를 공통 상태 컴포넌트·페이지 회귀 테스트로 점검한다.
- [x] native table semantics, 키보드 탐색, focus 복귀, 오류 요약, dialog 닫힘, reduced motion을 확인한다.
- [x] 390/767/768/1024/1440px, 200% zoom, table `ScrollFog` 조작을 확인한다.
- [x] 세션 만료, 비관리자 접근, 직접 상세 URL, 잘못된 ID, 네트워크 실패를 확인한다.
- [x] admin login/refresh rate limit, CSP·`frame-ancestors 'none'`·Referrer-Policy·no-store와 direct `run.app` 우회 차단을 배포 설정과 runbook에 반영한다.
- [x] 실제 API+PostgreSQL seed를 사용하는 Playwright admin smoke를 CI에 추가한다.
- [x] lint, typecheck, unit/integration test, OpenAPI drift를 모두 통과한다.
- [x] Aside로 핵심 운영 시나리오를 데스크톱·모바일에서 검증한다.
- [x] 완료 후 [`docs/CHECKLIST.md`](../CHECKLIST.md)의 `admin 재작성`을 체크하고 Cloudflare 배포 단계로 인계한다.

J 완료 근거: Python 535건, shared 45건, store 114건, admin 87건과 repo lint/build/typecheck를 통과했고 `pnpm codegen` 재실행은 drift 0이었다. Alembic은 `f18a6c2d9b40` 단일 head이며 `alembic check`에서 추가 upgrade operation이 없었다. 실제 API+PostgreSQL seed 기반 `e2e/admin-smoke.spec.ts` 1건이 로그인 → 보호 목록/상세 → 상태 변경 → 원상 복구 → 로그아웃을 통과했으며, 재시드 없이 두 번 연속 실행해 재시도 안전성도 확인했다. Aside에서는 1440px·390px와 767/768/1024px 경계, 200% zoom, 주문·클레임 mutation, 상품 편집 취소 복원, 안전한 Seamless SVG, 모바일 메뉴, table `ScrollFog`, dialog focus 복귀, reduced motion, 잘못된 ID, 탭 간 logout을 확인했으며 유효 origin에서 console error는 없었다. 초기 lazy route의 hydration 경고는 root `HydrateFallback`을 추가해 제거했다.

### 실행 중 추가 검토/개선 (2026-07-12)

최초 플랜을 구현하면서 발견한 결함과 운영 위험을 아래처럼 v1 범위에 추가했다. 아래의 “완료”는 코드와 집중 회귀 테스트에 더해 전체 repo gate를 통과했다는 뜻이다.

| 영역 | 추가 검토 결과와 개선 | 구현·테스트 근거 | 상태 |
|---|---|---|---|
| 관리자 access token | store access token으로 DB 역할 변경 후 admin 경계나 owner-only 우회에 진입할 수 없도록 access claim에 `session_kind`와 role을 넣고, 모든 인증 경로가 token role=current role을 확인하며 `AdminUser`는 `session_kind=admin`도 확인한다. | `api/security.py`, `api/deps.py`, `test_auth.py`, `test_admin_hardening.py` | 완료 |
| 결제 crash window | Toss confirm/refund 호출 전에 `provider_call_pending` operation을 `payment_incidents`에 commit한다. 명시적 거절은 resolve하고 timeout·5xx·프로세스 중단은 open incident로 남겨 blind retry 대신 대사 흐름으로 보낸다. | `payments/operation_journal.py`, `payments/service.py`, `tokens/ledger.py`, `test_admin_phase_d.py` | 완료 |
| 토큰 bucket 불변식 | 관리자 회수는 paid→bonus→free 가용분을 잠금 하에서 분할 차감하고, 어떤 token class도 음수가 되지 않게 했다. 기존 음수 bucket은 사용 시 거부하며 동시 회수·멱등 재요청을 검증한다. | `tokens/ledger.py`, `test_token_adjustment_safety.py` | 완료 |
| 주문 참고 이미지 | custom/sample 주문 body가 raw `object_key` 대신 완료된 소유자 `upload_id`만 받도록 staging·complete 계약을 추가하고, 주문-이미지 관계를 통해 관리자 signed read를 발급한다. | `images/router.py`, `orders/service.py`, `test_order_image_security.py`, store upload 테스트 | 완료 |
| 삭제된 상품 옵션 | cart 조회·수정·checkout에서 사라진 option을 FREE/base 옵션으로 재매핑하지 않고 `unavailable`로 표시·거부한다. | `cart/router.py`, `test_cart.py`, store cart 테스트 | 완료 |
| 상품 이미지 PUT·legacy | signed PUT에 `x-goog-if-generation-match: 0` create-only 조건을 서명·필수 header로 포함했다. relation ID가 없는 기존 상품 URL은 미변경 PATCH에서 생략해 보존하고, 명시적 제거만 빈 목록으로 보낸다. | `admin/products.py`, `integrations/gcs.py`, `test_admin_products.py`, product edit/upload 테스트 | 완료 |
| 비공개 staging PUT | 주문·견적·리폼을 포함한 임시 업로드도 create-only 조건을 서명하고, 두 GCS 버킷 CORS가 해당 필수 header를 허용하게 해 URL 유효기간 중 덮어쓰기를 막는다. | `images/router.py`, `integrations/gcs.py`, `infra/main.tf`, `test_images.py`, store upload 테스트 | 완료 |
| GCS capability | private upload/read용 `gcs`와 공개 결과·상품용 `gcs_assets`를 readiness와 대시보드에서 분리해, private bucket만 준비된 환경을 ready로 오판하지 않게 했다. | `api/main.py`, `admin/router.py`, dashboard, `test_admin_hardening.py` | 완료 |
| 403 role probe | 일반 관리자 mutation 403 뒤 `getMe`가 5xx·네트워크 오류라고 세션을 지우지 않는다. 401/403 또는 확인된 비관리자 역할일 때만 access token과 보호 cache를 폐기한다. | `admin-api-client.ts`, `admin-api-client.test.ts` | 완료 |
| 클레임 송장 audit | 반품·재발송 송장 변경을 상태별 서버 action, operation UUID, request ID, before/after operation log와 timeline으로 연결하고 UI 입력 실패 보존을 검증한다. | `admin/claim_operations.py`, `test_admin_phase_d.py`, claim detail 테스트 | 완료 |
| Seamless reference image | `/design` 이미지 입력은 v2 이연 상태라 production writer가 없다. 향후 비공개 입력을 raw object key로 추론하지 않도록 nullable FK와 관계 검증형 관리자 read endpoint만 선행 배치했으며, 현재 기능 완료로 판정하지 않는다. | `docs/plans/store-design.md`, Alembic `20260712_f18a6c2d9b40_seamless_reference_image_relation.py`, `admin/generation.py` | v2 이연, 선행 기반만 반영 |
| 대표 query plan | 주문 queue뿐 아니라 상품 필터 10,000행 fixture도 `EXPLAIN (ANALYZE, BUFFERS)`로 검사하고 Seq Scan 회귀를 막는다. | `test_admin_query_plans.py` | 완료 |
| lazy route 초기 상태 | 느린 lazy route의 최초 hydration 중 빈 화면과 React Router 경고가 생기지 않도록 root `HydrateFallback`을 shared primitive로 구성했다. | `app/router/router.tsx`, `router.test.tsx` | 완료 |
| 목록·테스트 중복 | 9개 목록의 URL 상태, 날짜 범위, 메모리 전용 PII 검색, table card 조합을 작은 admin-local helper로 통합했다. 페이지별 고유 필터와 PII 저장 금지 정책은 유지하고, 20개 페이지 테스트의 router/provider 준비는 `renderAdminPage`로 통합했다. | `use-admin-list-url-state.ts`, `paginated-admin-table-card.tsx`, `render-admin-page.tsx`, admin 87 tests | 완료 |
| 상품 폼 책임 분리 | 상품 속성 정본과 draft 변환·검증·payload 생성을 순수 모듈로 분리했다. 상품 ID 변경 시 form identity를 교체하고, 업로드 중 피커를 잠그며 unmount 뒤 완료된 staging을 폐기한다. 안정적인 option ID와 legacy 이미지 생략 의미는 보존하고 새 form library나 범용 상태 머신은 도입하지 않았다. | `product-attributes.ts`, `product-form-model.ts`, product edit/new/model tests | 완료 |
| 관리자 API 조립 경계 | 공개 견적·문의 router의 파일 하단 admin router 결합을 제거하고 앱 조립부에서 명시적으로 등록했다. KST 날짜 경계, snapshot 우선 배송지, 정렬 타입 중복은 admin helper로 모으되 결제 command 순서와 transaction 경계는 변경하지 않았다. | `api/main.py`, `admin/helpers.py`, PostgreSQL admin tests, OpenAPI 127 paths | 완료 |
| 운영 회귀 재실행 | 문의 목록 query key와 요청에 같은 `limit` 포함 params를 사용하도록 고정했다. smoke는 시작 시 남은 상태를 복구하고 검증 후에도 seed 주문을 대기로 되돌려 실행 간 상태를 격리한다. | `inquiries/list.test.tsx`, `e2e/admin-smoke.spec.ts`, 재시드 없는 2회 연속 Playwright | 완료 |

## 7. 테스트 전략

### API와 데이터베이스

- 실제 PostgreSQL testcontainer로 `customer/admin/manager` 인가 행렬과 manager의 고위험 mutation 403을 검증한다.
- 일반 login/refresh/OAuth의 privileged token·identity 차단, store/admin cookie 공존, 같은 `session_kind` 범위 replay 폐기를 검증한다.
- admin·store·누락 Origin, `no-store`, request ID, nonlocal missing-secret fail-closed를 검증한다.
- 목록 기본/max limit, allowlist·안정 정렬, 검색 제한, page total, KST 날짜 경계와 대표 query plan을 검증한다.
- 주문·클레임·견적 상태 머신, 송장 조건, 롤백 로그, snapshot 보존, revision 동시 요청을 검증한다.
- claim notification의 transaction rollback, failed retry, 중복 전송 방지를 검증한다.
- 쿠폰 조건 snapshot, active 대상, preview와 batch 결과, 재활성화/회수, idempotency를 검증한다.
- 상품+안정적 option ID 저장, option 제약과 가격 일괄 저장의 409·transaction rollback을 검증한다.
- 토큰 지급·회수·환불의 원장, operation ID payload 충돌과 append-only actor 기록을 검증한다.
- Toss timeout/성공 후 DB 실패 시 `payment_incidents`가 남고, 조회 기반 대사가 중복 반영 없이 해결되며 dashboard·claim에서 해결 전까지 사라지지 않는지 검증한다.
- entity 관계가 없는 signed read와 unsafe SVG payload가 거부되는지 검증한다.

### 프론트 단위·통합 테스트

- store/admin cookie 공존, session bootstrap, 두 탭 refresh 직렬화, 401 한 번 재시도, role loss 시 session·cache 정리를 검증한다.
- 비민감 URL query parse/serialize, PII memory 검색, debounce·abort, page reset, legacy redirect를 검증한다.
- 돈·KST 날짜·상태 label formatter와 활성/차단 `admin_actions`의 이유 렌더링을 검증한다.
- mutation 중 버튼 잠금, idempotency key 유지, memo validation, 위험 확인 취소, query invalidation을 검증한다.
- dirty form blocker, stale 409 입력 보존, focus refetch가 dirty 값을 덮어쓰지 않는지 검증한다.
- 화면별 최초 empty/필터 empty/error/stale data와 hidden/terminal polling 중지를 검증한다.
- native table·pagination, route heading, error summary, dialog focus 복귀의 접근성 계약을 검증한다.

라우트 가드, dialog focus, mutation interaction은 Testing Library+user-event+jsdom으로 검증하고, 순수 formatter/query helper는 node 환경 Vitest로 분리한다.

### 브라우저 핵심 시나리오

1. 관리자 로그인 → 대시보드 → 필터된 주문 → 상세 → 송장/상태 변경
2. 클레임 상세 → 롤백 memo → 토큰 환불 timeout → payment incident 대사·해결
3. 고객 상세 → 토큰 지급 → 원장 반영 → 쿠폰 고객군 preview/발급/회수
4. 상품 생성 → 이미지 업로드 → 옵션 저장 → 수정 화면 재조회
5. 견적 변경 → 문의 답변 → 가격/설정 변경 확인
6. 생성 작업 실패 상세 → Seamless 후보 SVG → Motif 조회
7. 390px 모바일 메뉴·필터·table scroll·dialog focus 복귀, 200% zoom
8. store와 admin 동시 로그인 → 두 admin 탭 동시 refresh → role loss 후 보호 데이터 제거

탐색 검증은 반드시 `.claude/skills/aside-browser/SKILL.md`의 Aside 하네스를 사용한다. 배포 회귀는 실제 API와 PostgreSQL seed를 사용하는 Playwright admin smoke로 별도 자동화한다.

## 8. 검증 명령

```bash
uv sync --all-packages
uv run pytest
uv run ruff check .
uv run pyright
pnpm codegen
pnpm lint
pnpm turbo build typecheck test
pnpm test:e2e
pnpm --filter admin dev
```

API 스펙 변경 후 `pnpm codegen`으로 생긴 차이는 같은 변경에 포함하고, 다시 실행했을 때 `packages/api-client`에 추가 diff가 없어야 한다.

## 9. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| 일반 OAuth/login이 privileged 계정에 관리자 token을 발급 | customer-only auth와 admin 전용 issuer를 분리하고 identity 연결·refresh 회귀 테스트를 둔다. |
| store origin 또는 direct `run.app`이 admin 경계를 우회 | exact admin Origin, no-store, Cloudflare origin verification/ingress 제한, rate limit을 출시 게이트로 둔다. |
| 기존 상세 화면을 얇은 API로 조합해 N+1·과도한 요청 발생 | 화면 단위 read model과 paged 하위 리소스를 먼저 설계한다. |
| 프론트 상태 머신과 서버 규칙이 어긋남 | `admin_actions`만 렌더링하고 mutation 때 서버가 재검증한다. |
| 결제 외부 성공 후 DB 실패·timeout | 외부 호출 전 operation, `payment_incidents`, 멱등키, Toss 조회 기반 대사 동선을 둔다. |
| 옵션 ID 교체·동시 저장이 cart/재고를 손상 | 안정적 option diff, revision 409, 단일 트랜잭션과 제약 테스트를 둔다. |
| 원본 상품·쿠폰·주소 수정이 과거 거래 의미를 바꿈 | 주문 item·발급 쿠폰·견적 배송지 snapshot을 기록하고 backfill한다. |
| 프로세스 재시작으로 클레임 알림 유실 | 상태 변경 transaction에 작은 outbox를 함께 기록하고 멱등 재시도한다. |
| 운영 secret 누락이 성공 DryRun으로 처리 | DryRun을 local/test로 제한하고 readiness/503으로 fail closed한다. |
| 대형 목록이 브라우저 메모리와 응답을 압박 | 모든 관리자 목록과 하위 이력을 서버 페이지네이션한다. |
| 생성 로그가 PII·비공개 객체 경로를 과다 노출 | 목록 최소화, 상세 마스킹, 공개 결과 content-hash URL과 비공개 입력 signed URL 분리, 권한 테스트를 적용한다. |
| 범위가 커서 마지막에만 통합됨 | 도메인별 API→codegen→UI→Aside 수직 슬라이스로 완료 상태를 만든다. |

## 10. v1 범위 밖

- 삭제된 `generate-tile`, `ai_generation_logs`, design chat 로그 복원
- Supabase view/RPC 또는 `supabase-js` 사용
- D4의 고정 최소 권한 행렬을 넘어선 세부 permission·custom role·범용 RBAC 편집기
- 관리자 계정·역할 생성 UI: v1 계정은 seed/운영 절차로 관리한다.
- 상품 삭제, Motif 등록·수정, 범용 CMS
- chart library, realtime subscription, 범용 DataGrid 도입
- CSV export, 생성 작업 수동 재큐, 가격·설정 버전 롤백 UI
- 범용 감사 검색 UI·이벤트 플랫폼·메시지 플랫폼. 범위가 고정된 `admin_operation_logs`, `payment_incidents`, claim notification outbox는 안전상 v1에 포함한다.
- MFA·Cloudflare Access 같은 추가 인증 계층. exact Origin, direct origin 우회 차단, login/refresh rate limit과 security headers는 v1 배포 조건에 포함한다.
- Cloudflare/GCP 실제 프로비저닝과 스테이징 데이터 이관: [`docs/CHECKLIST.md`](../CHECKLIST.md)의 후속 단계에서 수행한다.

## 11. 전체 완료 정의

- canonical 라우트와 명시한 legacy redirect가 모두 동작한다.
- 모든 essesion API 호출이 생성된 `packages/api-client`를 경유하며 OpenAPI drift가 없다. GCS signed URL 업로드는 문서화한 유일한 예외다.
- FastAPI가 customer/admin 인증 발급 경계, exact Origin, `AdminUser`/`AdminOnly` 역할과 도메인 불변조건을 강제한다.
- 상태 전이·금액·환불·토큰·쿠폰 계산을 프론트가 복제하지 않는다.
- 과거 주문·쿠폰·견적은 원본 수정·삭제 뒤에도 거래 시점 의미를 보존하고, stale write·결제 불확실성·알림 실패에 복구 동선이 있다.
- 모든 데이터 화면에 loading/empty/error/stale 상태가 있고, 모든 위험 mutation에 pending/error/확인·멱등 처리가 있다.
- native table, 키보드·focus, 200% zoom, 390px 반응형과 SVG 안전 렌더링 계약이 검증된다.
- API 실제 PostgreSQL 테스트, admin 단위 테스트, repo lint/build/typecheck/test가 모두 통과한다.
- Aside 데스크톱·390px 핵심 시나리오와 실제 API+PostgreSQL Playwright admin smoke가 통과하고 결과가 구현 플랜 또는 체크리스트에 기록된다.
- 로컬·CI 계약은 필수 secret 누락, store origin, direct `run.app` 우회를 fail closed로 검증하며, 실제 스테이징 보안 header·rate limit·capability 확인은 운영 개통 게이트로 남긴다.
- `docs/CHECKLIST.md`의 admin 재작성과 Playwright admin smoke를 완료로 바꾸고, 실제 GCP·Cloudflare 개통은 별도 미완 항목으로 유지한다.

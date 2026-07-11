# store 주문 내역·클레임(C9) 구현 플랜

> YeongSeon `/order/order-list` + `/order/:id` + `/order/repair-shipping/:orderId` + `/order/claim-list` + `/order/claim/:type/:orderId/:itemId` + `/order/claim-detail/:claimId`를 essesion store로 재작성.
> **상태: 구현 완료 (2026-07-11)** — D3(클레임 신청 = ResponsiveModal)·D6(customer_actions 정본, cancel 가드 확장·return/exchange 가드 sale로 축소)를 포함한 C9 범위 구현·검증 완료.
> 기존 미배선 생성물 `createClaimMutation` · `listMyClaimsOptions` · `cancelClaimMutation` · `confirmPurchaseMutation`을 모두 연결했다.
> 원본 참고(복사 금지): `../git/YeongSeon/apps/store/src/pages/order/{order-list,detail,repair-shipping}.tsx`, `pages/claim/**`.

## 1. 범위 (라우트 매핑)

C1–C8에서 이미 상당 부분이 선행 구현됐다. 원본 라우트를 그대로 복제하지 않고 기존 essesion 라우트에 정착시킨다:

| YeongSeon | essesion | 성격 |
|---|---|---|
| `/order/order-list` | **`/my-page/orders`** (기존 확장) | 타입 필터 칩 + 날짜 그룹 추가. 별도 라우트 신설 안 함(D1) |
| `/order/:id` | **`/order/:orderId`** (기존 확장) | 구매확정·클레임 액션·배송지·업체 발송 정보·수선품 보낼 주소 추가 |
| `/order/repair-shipping/:orderId` | **`/order/:orderId/repair-shipping`** (기존 유지) | C3에서 구현 완료 — 보강만(§4) |
| `/order/claim-list` | **`/my-page/claims`** (신규) | 클레임 목록. 알림톡 폴백 URL 문구 동기화 필요(D4) |
| `/order/claim/:type/:orderId/:itemId` | **라우트 없음 — `ClaimFormModal`** (신규) | 주문 상세에서 여는 ResponsiveModal(D3) |
| `/order/claim-detail/:claimId` | **`/my-page/claims/:claimId`** (신규) | 클레임 상세 |

신규 라우트 2건은 기존 ProtectedRoute 그룹(`app/router/index.tsx`)에 lazy로 추가.

## 2. 원본 명세 요약 (보존 대상 = "무엇을 하는가")

- **주문 목록**: 타입 탭(전체/일반구매/수선/주문제작/샘플/토큰) + 주문일 그룹핑. 카드에 상태 뱃지·주문번호·상품·합계. 아이템별 클레임 버튼.
- **주문 상세**: 결제 정보 사이드바, "현재 할 일"(repair 발송대기 — 보낼 주소+복사+송장 등록 CTA), 배송지 정보, 배송 추적(repair는 고객/업체 2블록), 구매확정 섹션, 상품 목록+클레임 버튼. **버튼 노출은 전부 서버 `customerActions` 위임** — 프론트는 자격을 재계산하지 않는다.
- **클레임 신청**: type=`cancel|return|exchange` 3종. 공통 폼(수량 — 아이템 수량>1일 때만, 사유 라디오 필수, 상세 500자 선택)에 **사유 목록·유의사항만 타입별 분기**, 제출 API는 동일(type 파라미터 차이뿐). 타입별 처리 상태 흐름: cancel `접수→처리중→완료` / return `접수→수거요청→수거완료→완료` / exchange `…→재발송→완료`.
- **클레임 목록**: 타입 탭 + 날짜 그룹. 카드에 유형·상태 뱃지, 클레임/주문번호, 대상 상품, 사유.
- **클레임 상세**: 요약 사이드바(유형/상태/사유/접수일/번호들), 대상 상품, 신청 사유+상세, `접수` 상태에서만 "신청 취소".
- **수선품 발송**: 발송대기 전용 가드. 송장 있음(택배사+송장번호→`발송중`) / 없음(사유 선택→`발송확인중`) 2-path. 사진 최대 3장 선택.
- **구매확정**: `customerActions`에 `confirm_purchase` 시 노출(배송중/배송완료, 활성 클레임 없음) → 확정 후 `완료`.
- 원본의 `token_refund` 클레임은 별도 플로우(이 폼으로 신청 불가) — essesion도 동일하게 폼에서 제외, 목록/상세는 라벨만 대응.

## 3. 클레임 타입 분기 설계 (착수 전 제안 ①)

**원칙: 자격 판정은 서버, 프론트는 렌더 분기만.** 노출은 `order.customer_actions`(`claim_cancel|claim_return|claim_exchange|confirm_purchase`)가 유일한 신호이고, 타입별 차이는 단일 config 맵에 데이터로 둔다 — YeongSeon의 페이지 곳곳에 흩어진 조건 분기를 한 곳으로 모은다.

```ts
// features/claims/model/config.ts
type ClaimType = "cancel" | "return" | "exchange";
const CLAIM_TYPE_CONFIG: Record<ClaimType, {
  label: string;              // 취소 | 반품 | 교환
  action: string;             // customer_actions 값 (claim_cancel …)
  reasons: ClaimReason[];     // 타입별 사유 (API enum 부분집합)
  notices: string[];          // 유의사항 문구
}>
```

**사유 매핑** — YeongSeon의 한글 사유가 essesion API `ClaimReason` enum과 1:1 대응된다:

| API enum | 라벨 | cancel | return | exchange |
|---|---|:-:|:-:|:-:|
| `change_mind` | 단순 변심 | ✓ | ✓ | |
| `defect` | 상품 불량 | ✓ | ✓ | ✓ |
| `delay` | 배송 지연 | ✓ | | |
| `wrong_item` | 다른 상품 배송 | ✓ | ✓ | ✓ |
| `size_mismatch` | 사이즈 불일치 | | ✓ | ✓ |
| `color_mismatch` | 색상 불일치 | | ✓ | ✓ |
| `other` | 기타 | ✓ | ✓ | ✓ |

**신청 UI는 라우트 페이지가 아니라 `ResponsiveModal`**(D3): 주문 상세의 아이템 행 액션 버튼("취소 요청" 등) 클릭 → `ClaimFormModal({type, order, item})`. type이 URL이 아니라 버튼에서 주입되므로 원본의 `VALID_CLAIM_TYPES` URL 검증·"잘못된 접근" 화면이 통째로 사라진다. 폼: 수량(item.quantity>1일 때만) + `RadioGroup`(사유) + `TextAreaField`(상세, 500자) + 유의사항 `Callout`. 제출 = `createClaimMutation` → orders·claims 쿼리 invalidate → snackbar → 모달 닫기.

**타입별 상태 흐름 차이는 표시 전용** — 상세에서 `Badge`로만 표시(원본 동일). `거부` 상태는 critical 톤.

**서버 정합 선행 필요(D6)**: 현재 `status_machine.CLAIM_CANCEL_ACTION_FROM`(버튼 노출)과 `claims/service.CANCEL_ALLOWED_STATUS`(생성 가드)가 불일치 — 예: repair `발송대기/발송중/발송확인중/수거예정`에서 `claim_cancel` 액션은 내려오는데 생성은 `대기중/결제중`만 허용해 400. 또 `claim_*` 액션이 `has_active_claim`을 안 봐서 활성 클레임 존재 시 버튼은 보이는데 제출은 `active_claim` 409. 프론트 착수 전 서버에서 두 표를 단일 소스로 통합하고 `claim_*`도 `has_active_claim` 게이트를 적용한다. 방향은 확정: cancel은 액션 표 기준으로 가드 확장, return/exchange는 가드를 sale로 축소(D6).

## 4. 수선 송장 접수 흐름 (착수 전 제안 ②)

C3에서 이미 **원본의 2모드 토글("송장 있어요/없어요")을 단일 선언형으로 개선 구현**했다 (`pages/order/repair-shipping.tsx` + `features/repair-shipping`): 필수는 "수선품을 발송했습니다" 선언뿐, 택배사+송장번호는 선택 증빙(쌍 검증), `shipmentRequestBody()`가 송장 유무로 `repair-tracking`(→발송중) / `repair-no-tracking`(→발송확인중) API를 자동 라우팅. no-tracking 사유 select(퀵/해외/분실)는 자유 메모로 대체(API `reason`은 선택 필드로 존치). **이 구조를 유지한다**(D8) — C9에서 재작업하지 않는다.

C9 잔여 보강:
- **수선품 보낼 주소 안내 부재**: 원본은 상세 "현재 할 일"에 보낼 주소+복사 버튼을 제공하는데 essesion에는 회사 입고 주소가 어디에도 없다 → `features/repair-shipping/model/inbound-address.ts` 상수 + 주문 상세 발송대기 Callout 영역과 repair-shipping 페이지에 표시 + 복사 버튼(`navigator.clipboard` + snackbar)(D10).
- **업체 발송 정보**: `OrderOut.company_courier_company/tracking_number/shipped_at`이 이미 내려오는데 상세가 미표시 → repair 상세에 "업체 발송 정보" 블록 추가(고객 발송 정보와 병렬)(D10).
- 라우트는 기존 `/order/:orderId/repair-shipping` 유지 — 원본 `/order/repair-shipping/:orderId` 형태로 재배치하지 않는다.

## 5. 하네스 매핑

| 원본 요소 | essesion | 근거 |
|---|---|---|
| 타입 탭(6종)+검색 | `Chip` 필터 행(전체/일반구매/수선/주문제작/샘플/토큰) | SegmentedControl은 2–4개 제한. 검색은 이연(D11) |
| 날짜 그룹 sticky 헤더 | `List`+`ListHeader`(날짜) | sticky 미복원 — 목록 규모 작음 |
| 클레임 신청 페이지 | `ResponsiveModal`(ClaimFormModal) | 임시 작업·폼 기본 패턴 |
| 사유 라디오 | `RadioGroup`/`RadioGroupItem` | 소수 옵션 배타 단일 선택 |
| 상세 설명 | `TextAreaField`(500자) | — |
| 유의사항 NoticeList | `Callout`(tone neutral) 또는 사이드바 목록 | 섹션 상주 안내 |
| 구매확정·클레임 신청취소 확인 | `AlertDialog` | 되돌릴 수 없는 결정(확정 후 반품/교환 불가·클레임 레코드 삭제). 레코드 삭제(DELETE /claims/{id})는 cancel/return/exchange 한정 — `token_refund`는 `cancelTokenRefundMutation`으로 `거부` 전이하고 레코드를 보존 |
| 상태 뱃지 | `Badge`+`orderStatusTone`/클레임 톤 맵 | 기존 `features/orders` 패턴 |
| 배송조회 외부 링크 | `courierLabel` 확장 — 조회 URL 빌더 추가 | 기존 `couriers.ts`에 URL 맵 추가 |
| 결과 알림 / 로딩 / 빈·에러 | `snackbar()` / `Skeleton` / `ContentPlaceholder` | 3상태 규칙 |

## 6. 데이터 계약 (구현 완료 — §11 참고)

| 용도 | 엔드포인트 | api-client | 상태 |
|---|---|---|---|
| 주문 목록(+타입 필터) | GET /orders?order_type= | `listMyOrdersOptions` | 사용 중(order_type 쿼리 포함) |
| 주문 상세 | GET /orders/{id} | `getOrderOptions` | 사용 중 |
| 구매확정 | POST /orders/{id}/confirm-purchase | `confirmPurchaseMutation` | 배선 완료(주문 상세) |
| 수선 송장/무송장 접수 | POST /orders/{id}/repair-tracking·repair-no-tracking | `submitRepairTracking/NoTracking` | 사용 중(C3) |
| 클레임 생성 | POST /claims | `createClaimMutation` | 배선 완료(ClaimFormModal) |
| 클레임 목록 | GET /claims | `listMyClaimsOptions` | 배선 완료(목록·상세) |
| 클레임 신청 취소 | DELETE /claims/{id} | `cancelClaimMutation` | 배선 완료(클레임 상세) |

**서버 변경(전부 적용 완료, codegen 재생성 커밋됨 — §11)**:
1. **`ClaimOut` 보강(D5)**: `order_number: str` + `item: OrderItemOut`(order_item 관계 조인). 목록·상세가 주문번호·대상 상품 카드를 추가 fetch 없이 렌더 — 단건 GET /claims/{id}는 신설하지 않고, 상세는 목록 쿼리에서 `find(id)`(원본도 단일 뷰로 양쪽을 서빙했고, 목록은 소유자 스코프 소량). admin 클레임 화면도 같은 보강을 수혜.
2. **액션-가드 정합(D6, 확정)**: 표를 `status_machine`에 단일 소스로 두고 `claims/service`가 import해 파생. cancel 가드는 `CLAIM_CANCEL_ACTION_FROM` 기준으로 **확장**(repair 발송대기 등 — 결제 후 미발송 상태의 정당한 취소 경로), return/exchange 생성 가드는 **sale만으로 축소**(수선은 반품 대상·교환 재고가 없고, 주문제작·샘플은 재고 교환 불성립 — 액션 노출과 일치). `customer_actions`의 `claim_*`에 `has_active_claim` 게이트 추가.
3. **주문 상세 배송지(D9)**: `GET /orders/{id}` 응답에 `shipping_address`(조인) 추가 — `OrderDetailOut(OrderOut)` 신설 또는 OrderOut에 optional 필드(목록은 미채움). FK가 `SET NULL`이고 스냅샷이 아니라서 주소 수정/삭제가 과거 주문 표시에 반영되는 한계는 §10에 기록.
4. **알림톡 폴백 URL(D4)**: `claims/service.py`의 `essesion.shop/order/claim-list` 문구 2곳 → `/my-page/claims` (OpenAPI 무관 — codegen 불필요).

캐시 규칙: 클레임 생성/취소·구매확정 성공 시 `listMyClaimsQueryKey` + `getOrderQueryKey(해당 주문)` + `listMyOrdersQueryKey` invalidate (customer_actions가 바뀌므로 주문 쿼리 동기화 필수).

## 7. 원본 대비 결정·개선 (실행 전 확정 제안)

| ID | 결정 | 근거 |
|---|---|---|
| D1 | 주문 목록은 `/my-page/orders` 확장 — `/order/order-list` 미신설 | C8에서 이미 정착한 경로. 동일 화면 이중 라우트 금지. 타입 필터는 서버 `order_type` 쿼리(원본은 200건 전량 로드 후 클라 필터) |
| D2 | **목록에서 클레임 버튼 제거 — 액션은 상세에서만** | 원본은 카드(Link) 안에 버튼을 중첩해 `stopPropagation` 핵 사용. 목록은 내비게이션 전용으로 두면 클릭 타깃이 명확하고 접근성 문제 소멸 |
| D3 | **(확정)** 클레임 신청 = `ResponsiveModal` — `/order/claim/:type/:orderId/:itemId` 라우트 미신설 | type을 버튼에서 주입 → URL 파라미터 검증·잘못된 접근 화면·경로 빌더 삭제. 이미 손에 든 `order`·`item` 객체를 그대로 전달(재조회 불필요). 폼 필드 4개 이하로 모달 규모 적합. 딥링크 수요 없음(알림톡도 목록으로 연결, 진입은 항상 상세에서). C8 D1(팝업→모달)과 동일한 결 |
| D4 | 클레임 목록/상세 = `/my-page/claims`·`/my-page/claims/:claimId` + 알림톡 폴백 URL 문구 동기화 | 주문 내역과 형제 관계(C8 허브 "주문과 내역" 그룹에 행 추가). `claims/service.py`가 구주소를 하드코딩 — 미수정 시 알림톡 링크가 404 |
| D5 | `ClaimOut`에 `order_number`·`item` 조인 — 단건 GET 미신설 | 없으면 클레임 목록이 주문 N건을 추가 fetch해야 대상 상품을 그림. 상세는 목록 캐시/재조회에서 find |
| D6 | **(확정) 서버 선행**: `customer_actions`(status_machine) 정본 — 표를 status_machine에 두고 claims/service가 import. cancel 가드 확장(액션 표 기준), return/exchange 가드 sale로 축소, `claim_*`에 has_active_claim 게이트 | 현재 repair 발송대기 등에서 "취소 요청" 버튼 노출 → 제출 시 400(버튼을 숨기는 방향은 정당한 취소 경로를 막는 퇴행), 활성 클레임 존재 시 버튼 노출 → 409. 수선·주문제작 반품/교환은 도메인상 성립하지 않음(재수선·별도 협의 플로우). 서버 신호를 신뢰하는 D3 설계의 전제 |
| D7 | 구매확정은 `AlertDialog` 확인 필수 | 확정 즉시 `완료` — 이후 반품/교환 불가. 원본은 섹션 버튼 즉시 실행(오클릭 위험) |
| D8 | 수선 발송은 기존 단일 선언형 유지 — 원본 2모드 토글·무송장 사유 select 미복원 | C3에서 의도적으로 단순화(필수는 선언뿐, 사유→자유 메모). API `reason`은 하위호환 유지 |
| D9 | 주문 상세에 배송지 정보 표시 — 서버 조인 추가 | 원본 기능 보존. 현재 OrderOut엔 `shipping_address_id`뿐이라 프론트 단독으론 불가 |
| D10 | 수선품 보낼 주소 상수+복사 버튼, 업체 발송 정보 블록 추가 | 원본 기능 보존 — 현재 essesion에 입고 주소가 어디에도 없어 고객이 어디로 보낼지 알 수 없음 |
| D11 | 키워드 검색·기간 필터·페이지네이션 **이연** | 원본도 클라 `includes` 검색+200건 상한의 절충. 데이터 소량 단계 — 타입 필터+날짜 그룹으로 충분. 필요 시 서버 파라미터부터 |

## 8. 파일 계획

```text
apps/api/src/api/domains/
  claims/schemas.py·router.py     (ClaimOut 보강 — D5)
  claims/service.py               (CANCEL_ALLOWED_STATUS 통합·알림 URL — D4·D6)
  orders/status_machine.py        (customer_actions 게이트 — D6)
  orders/schemas.py·router.py     (상세 배송지 — D9)

apps/store/src/
  features/claims/                (신규 feature)
    model/config.ts               (CLAIM_TYPE_CONFIG — 라벨·사유·유의사항·상태 톤)
    ui/claim-form-modal.tsx       (ResponsiveModal — 수량·사유·상세·유의사항)
    ui/claim-item-actions.tsx     (customer_actions → 아이템 행 버튼 렌더)
    index.ts
  features/repair-shipping/
    model/inbound-address.ts      (수선품 보낼 주소 상수 — D10)
    model/couriers.ts             (배송조회 URL 빌더 추가)
  pages/my-page/
    claims.tsx                    (클레임 목록 — 타입 칩+날짜 그룹)
    claim-detail.tsx              (클레임 상세 — 사이드바 요약+신청 취소)
    orders.tsx                    (확장 — 타입 칩·날짜 그룹, D1·D2)
    index.tsx                     (허브 "주문과 내역"에 클레임 내역 행 추가)
  pages/order/detail.tsx          (확장 — 구매확정·클레임 액션·배송지·업체 발송·보낼 주소)
  app/router/index.tsx            (라우트 2건 추가 — lazy)
```

## 9. 작업 순서 (초기 계획 — 전 단계·검증 완료, §11)

1. **서버 선행(D4·D5·D6·D9)**: 액션-가드 단일 소스화(+testcontainers 인가·가드 테스트 갱신) → ClaimOut 보강 → 상세 배송지 → 알림 URL 문구 → `pnpm codegen` (같은 커밋).
2. **features/claims**: config 맵 → `ClaimFormModal` → `claim-item-actions`.
3. **주문 상세 확장**: 구매확정(AlertDialog→mutation→invalidate) + 아이템 행 클레임 액션 + 배송지 + 업체 발송 정보 + 보낼 주소(D10).
4. **주문 목록 확장**: 타입 칩(서버 필터) + 날짜 그룹 ListHeader.
5. **클레임 목록/상세 페이지 + 라우트 + 허브 행 추가**.
6. **검증**: `pnpm lint` → `pnpm turbo typecheck test` → `uv run pytest` → Aside 브라우저 왕복 —
   ① 배송중 sale 주문: 구매확정 확인 다이얼로그 → 완료 전이 → 버튼 소멸 ② 배송완료 주문에서 반품 신청(수량>1이면 부분 수량) → 클레임 목록/상세 반영 → 같은 주문 두 번째 클레임 버튼 미노출(has_active_claim) ③ 접수 상태 신청 취소 → 목록에서 소멸 + 주문 버튼 복원 ④ repair 발송대기: 보낼 주소 복사 → 송장 등록(발송중)·무송장(발송확인중) 가드 회귀 ⑤ 취소 가능 상태별 버튼 노출이 서버 가드와 일치(D6 검증) ⑥ 모바일 뷰포트 ClaimFormModal=BottomSheet ⑦ 비로그인 `/my-page/claims` 진입 가드.
7. `docs/CHECKLIST.md` C9 기록, 본 문서 상태 갱신.

## 10. 이연·기록

- ~~**주문 배송지 스냅샷 부재**~~: **해소(2026-07-11)** — `orders.shipping_address_snapshot` JSONB 도입, 생성 시점 기록·백필·조회 스냅샷 우선. `docs/plans/store-order-claim-followups.md` §2.
- 키워드 검색·기간 필터·페이지네이션(D11) — 서버 파라미터 설계부터 별도 청크로.
- ~~`token_refund` 클레임 생성 플로우~~ — **배선 완료(2026-07-11)**: 주문 상세 `TokenRefundSection`(신청) + 클레임 상세 취소. `docs/plans/store-order-claim-followups.md` §1.
- return/exchange의 수거/재발송 송장(`return_*`·`resend_*` 필드)은 관리자가 기입 — 클레임 상세에 있으면 표시(읽기 전용), 고객 입력 플로우는 범위 밖.

## 11. 완료 검증 (2026-07-11)

- API 계약 변경 후 `pnpm codegen`으로 `packages/api-client`를 재생성했다.
- `pnpm lint`, `pnpm turbo build typecheck test`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyright`, `uv run pytest` 통과(417 tests).
- Aside로 데스크톱 주문 목록·구매확정·클레임 생성/목록/상세/취소·수선 입고 주소/복사/발송 등록 화면, 390×844 모바일 BottomSheet, 비로그인 보호 라우트를 확인했으며 콘솔 오류는 없었다.

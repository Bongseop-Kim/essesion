# 주문 내용 누락 방지 — store·admin 화면 개편 플랜

> 주문제작·샘플제작·수선은 고객이 입력한 사양·요청사항·첨부 이미지가 `OrderItem.item_data`(JSONB)와 수선 사이드 테이블에 **이미 저장**돼 있으나, store 마이페이지와 admin 주문 화면이 그 대부분을 **렌더에서 버린다**. 결과적으로 고객도 관리자도 "무엇을 주문/수선했는지" 확인할 수 없다. 스키마·과금·상태기계는 불변으로 두고, **이미 클라이언트에 도달한 데이터를 화면에 표시**하는 것이 대부분이며, 이미지·수선 픽업/발송 정보만 읽기모델을 보강한다.
> 근거: `db/src/db/models/commerce.py:239-267`(item_data), `apps/api/src/api/domains/orders/router.py:113,151`(store 원본 반환), `apps/api/src/api/domains/admin/orders.py:65-84`(admin 새니타이즈). 관련: `docs/plans/store-order-claim.md`, `docs/plans/admin-rewrite.md`, `docs/plans/store-custom-order.md`, `docs/plans/store-sample-order.md`.

## 1. 현황 (사실관계)

### 1.1 데이터는 이미 저장·전송된다

- 주문별 고객 입력은 `OrderItem.item_data` JSONB 한 컬럼에 스냅샷된다(`commerce.py:250`, 주석 그대로 "reform/custom/sample 스냅샷").
  - custom: `options`(14+ 키), `quantity`, `reference_images[{image_id}]`, `additional_notes`, `pricing`, `coupon` — `orders/service.py:724-732`.
  - sample: `sample_type`, `options`, `reference_images[{image_id}]`, `additional_notes`, `pricing`, `coupon` — `service.py:818-825`.
  - repair(reform): `tie.automatic{mechanism, wearer_height_cm, dimple, turn_knot}`, `tie.width{target_width_cm}`, `tie.restoration{memo}`, `tie.image.object_key`, `cost`, `coupon` — `reform/service.py:63-73`, `service.py:439,578`.
- store 응답은 `item_data`를 **원본 그대로** 반환(`orders/router.py:113,151`). admin 응답은 **새니타이즈**(`object_key`·`uploads/` 접두 문자열 제거, `reference_images`→`reference_image_count` 축약)하되 사양·메모 텍스트는 보존(`admin/orders.py:65-84`).
- 수선 전용 사이드 테이블은 item_data 밖에 있고 **어느 주문 응답에도 실리지 않는다**: `RepairPickupRequest`(수거 수령인·연락처·주소·수거비, `commerce.py:448-460`), `RepairShippingReceipt`(고객이 낸 발송 방식·사유·메모·사진, `commerce.py:463-477`). 현재는 클레임 상세(`AdminClaimDetailOut.shipping`)에만 노출된다.

### 1.2 두 화면의 렌더는 서로의 사각지대다 (핵심)

| | store 마이페이지 상세 | admin 주문 상세 |
|---|---|---|
| **주문제작(custom)** | ❌ 항목 제목이 상수 `"맞춤 주문"`(`claims/config.ts:138`), 사양·요청사항·이미지 **전부 미표시**. 수량·단가만 렌더(`order/detail.tsx`). | ✅ 제작 요약 카드로 사양·요청사항·참고이미지 표시(`orders/detail.tsx:450-512`) — 단 **옵션 화이트리스트**(`:73-96`)에 없는 키는 조용히 누락, **첫 아이템만**(`orderItems[0]`, `:350`). |
| **샘플제작(sample)** | ❌ 상수 `"샘플 주문"`(`config.ts:139`). `sample_type`·옵션·요청사항·이미지 **전부 미표시**. | ✅ custom과 동일 카드/한계. |
| **수선(repair)** | △ 항목 제목에 `reformServiceLabel`로 사양 텍스트 인라인(`reform.ts:125-145`) — 유일하게 디코드됨. 단 **수선 사진 미표시**, 고객이 낸 발송 정보(RepairShippingReceipt) 되읽기 불가. | ❌ `isProductionOrder`가 false라 **타입 전용 카드 없음**. 항목 표에 `reform · <uuid>` 폴백만(`:69`). 메커니즘·착용키·목표폭·요청메모·사진 **전무** → 관리자가 무엇을 수선할지 앱에서 알 수 없음. |
| **배송 요청사항** | ✅ delivery_request/memo 렌더 | ❌ `recipient_phone`·`delivery_memo`·`delivery_request` 수신하나 미표시(`orders/detail.tsx:415-417`) |
| **참고/수선 이미지** | ❌ 어디에도 이미지 렌더 없음(`ImageFrame` 미임포트) | custom/sample만 서명 URL로 표시, repair 사진은 **조회 경로 자체가 없음**(새니타이저 제거 + 엔드포인트가 custom/sample 한정, `admin/orders.py:62,72-73`) |

**결론:** 사용자가 말한 "완전히 누락"의 실체는 세 갈래다 — ① store에서 custom/sample 사양·요청·이미지 전부, ② admin에서 repair 내용 전부, ③ 참고/수선 이미지의 조회 경로 부재. ①②는 **데이터가 이미 클라이언트에 있는데 화면이 버리는** 순수 프론트 문제이고, ③과 수선 픽업/발송 정보만 읽기모델 보강이 필요하다.

## 2. 방침

- **스키마·상태기계·과금 불변.** 개편은 (a) 프론트 렌더 추가와 (b) 최소한의 읽기모델/이미지 엔드포인트 보강뿐.
- **"present면 표시, absent면 숨김".** 값이 있으면 반드시 한 화면에 노출한다. 라벨 사전에 없는 옵션 키도 **버리지 말고** 키를 사람이 읽을 형태로 폴백 표기(현재 admin 화이트리스트가 조용히 버리는 버그 제거). 값이 없는 필드는 `-`로 채우지 않고 행 자체를 숨겨 잡음을 줄인다.
- **한 곳에서 디코드.** item_data는 타입이 없어 store·admin이 각자 역설계 중이고, 그 결과 서로의 사각지대가 생겼다. 사양 디코더 + 라벨 사전을 **한 모듈로 공유**해 드리프트를 없앤다(`packages/shared` 로직 모듈 또는 소형 lib). 근본적으로는 백엔드 읽기모델에 타입드 `spec` 블록을 얹는 게 정석이나(§5.4), 우선은 공유 디코더로 충분 — 드리프트가 재발하면 그때 타입드로 승격.
- **이미지는 디자인 시스템 규칙대로 `ImageFrame`**(모든 콘텐츠 이미지), 서명 read-url 경유(원본 object_key를 프론트로 내리지 않는다).
- **비목표:** 주문 생성/결제 위저드 변경(그 화면들은 사양을 이미 정상 표시), 상태 전이·클레임 흐름 변경.

## 3. 공통 UI — "주문 내용" 섹션 (store·admin 공용 개념)

두 앱 모두 항목 카드/행 아래에 타입별 **주문 내용** 블록을 둔다. 세 부분으로 고정:

1. **사양(spec) rows** — 라벨→값 목록. shared `List`/`ListItem`(라벨·값 2열) 또는 admin의 기존 `DetailList`(`shared/ui/detail-list.tsx`) 재사용. 불리언 마감옵션(dimple·turn_knot·삼침 등)은 켜진 것만 shared `TagGroup`/`Tag`로 압축.
2. **요청사항(memo)** — custom/sample `additional_notes`, repair `tie.restoration.memo`, 배송 `delivery_request`. 고객 자유 입력이므로 눈에 띄게 `Callout`(informative) 또는 라벨 붙은 본문 블록. 비면 숨김.
3. **첨부 이미지** — 참고 이미지/수선 사진. `AspectRatio`+`ImageFrame` 썸네일 그리드, 클릭 시 원본. store는 신설 read-url, admin은 기존 서명 URL 흐름.

디자인 시스템 준수: 레이아웃은 프리미티브(`VStack`/`Grid`), 타이포 `Text`+`textStyle`, 색은 시맨틱 토큰만(`packages/shared/AGENTS.md`). 사양 rows에 맞는 공용 컴포넌트가 없으면 `List`로 조합하고, 반복 패턴이면 shared 추가를 제안.

## 4. store 마이페이지 (`apps/store/src/pages/order/detail.tsx`)

- **custom/sample**: 항목 카드 아래 §3 주문 내용 블록 추가. 사양은 공유 디코더로 `item_data.options`(+ custom `quantity`, sample `sample_type`) 전 키를 rows로, `additional_notes`를 요청사항으로. 현재 `orderItemTitle`이 반환하는 상수 문자열(`"맞춤 주문"`/`"샘플 주문"`)은 유지하되 그 아래에 실제 내용이 붙는다. [FE-only — item_data 원본이 이미 응답에 있음]
- **custom/sample 참고 이미지**: 렌더한다. 단 현재 `item_data.reference_images`는 `{image_id}`만 담겨 고객 read-url(`images/router.py:296-319`, object_key 기반)로 **해석 불가** → §5.1의 store 이미지 엔드포인트 신설이 선행. [API+codegen]
- **repair 사진**: `item_data.tie.image.object_key`는 store 응답에 그대로 있고 소유자 read-url로 해석 가능 → `ImageFrame`으로 렌더만 추가. [FE-only]
- **repair 발송 되읽기**: 고객이 제출한 `RepairShippingReceipt`(방식·사유·메모·사진)를 상세에 표시 → §5.3 읽기모델 보강 후 렌더. [API+codegen]
- 부수: 항목별 할인(`line_discount_amount`)·상품 옵션 라벨은 여력 시 함께(부차, 별도 처리 가능).

## 5. admin (`apps/admin/src/pages/orders/detail.tsx`)

- **repair 주문 내용 카드 신설**: `isProductionOrder` 게이트(`:213`)를 `custom|sample`에서 확장하거나 repair 전용 카드를 추가. `item_data.tie`를 공유 디코더로 디코드해 메커니즘·착용키·목표폭·요청메모를 rows로 표시(텍스트는 새니타이저가 보존). [FE-only]
- **옵션 화이트리스트 버그 제거**: `optionSummary`(`:93-96`)가 `optionLabels`만 순회 → **item_data에 실재하는 키 전부**를 순회하고 미지 키는 폴백 라벨로. 조용한 누락 종식. [FE-only]
- **첫 아이템 한정 제거**: `productionItem = orderItems[0]`(`:350`) → 항목별로 주문 내용 렌더(다품목 제작 주문 대응). [FE-only]
- **배송 요청사항 표시**: `recipient_phone`·`delivery_memo`·`delivery_request` 렌더 추가(`:403-435` 카드). [FE-only]
- **order_type 지역화**: 상세가 raw 문자열 노출(`:388`) → list의 라벨 맵(`list.tsx:25-32`) 공용화. [FE-only]
- **repair 사진 조회 경로**: 새니타이저가 object_key 제거 + 참고이미지 엔드포인트가 custom/sample 한정 → §5.2로 repair(reform) 엔티티까지 확장. [API]
- **수선 픽업/발송 정보**: `RepairPickupRequest`·`RepairShippingReceipt`를 admin 주문 상세에 표시 → §5.3 읽기모델 보강. [API+codegen]
- 부수: 미표시 라이프사이클 타임스탬프(shipped/delivered/confirmed/company_shipped)·업데이트 시각 노출(여력 시).

### 5.1–5.4 백엔드 보강 (스펙 변경 → `pnpm codegen` 동반)

1. **store 참고 이미지 엔드포인트**(5.1): admin의 `GET /admin/orders/{id}/reference-images` + read-url(`admin/router.py:177-199`)를 소유자용으로 미러 → `GET /orders/{id}/reference-images`. 또는 store `item_data.reference_images`에 서명 read-url을 실어 내리는 경량안. 전자 권장(admin 로직 재사용).
2. **admin repair 사진**(5.2): 참고이미지 엔티티 필터(`admin/orders.py:62`)를 `custom_order|sample_order`에서 `reform`(수선 사진)·`repair_shipping`(발송 사진)까지 확장. 새니타이저는 count만 노출하는 현 계약 유지, 실제 바이트는 서명 read-url로.
3. **수선 픽업/발송 읽기모델**(5.3): `RepairPickupRequest`·`RepairShippingReceipt`를 클레임 상세에만 붙이던 것을 주문 읽기모델로도 파생 — `OrderDetailOut`·`AdminOrderDetailOut`에 `repair_pickup`·`repair_receipts` 필드 추가(사진은 count + read-url, 기존 `phase_d`/`entity_images` 패턴 재사용). ARCHITECTURE의 "집계는 API 계층 소유" 원칙에 부합.
4. **(선택·후속) 타입드 spec 블록**(5.4): item_data 역설계를 없애는 정석. `OrderItemOut`에 `spec: CustomSpecOut | SampleSpecOut | ReformSpecOut | None` 파생 필드를 백엔드가 한 번 디코드해 내리고 양 클라이언트는 타입드 rows만 렌더. 지금은 §2의 공유 디코더로 갈음하고, 드리프트 재발 시 승격.

## 6. 검증

- `pnpm codegen`(drift 없음) → `pnpm lint`(harness 포함) → `pnpm turbo build typecheck test`.
- pytest(testcontainers, mock 금지, `uv run pytest apps/api/tests`): ① store `get_order`가 custom/sample `item_data.options`·`additional_notes`를 반환 ② store 참고이미지 엔드포인트가 소유자에게 서명 URL 발급·비소유자 거부 ③ admin repair 주문 상세 응답에 `tie` 사양·`repair_pickup`·`repair_receipts` 포함 ④ admin repair 사진 read-url 발급.
- 단위: 공유 사양 디코더 — 미지 옵션 키가 **버려지지 않고** 폴백 라벨로 나오는지(현 화이트리스트 버그 회귀 가드) 1개 assert 테스트.
- Aside(브라우저, `.claude/skills/aside-browser`): `docker compose up -d`→alembic upgrade→seed 후 `pnpm --filter store dev`/`admin dev`. custom·sample·repair 주문 각각에 대해 store 상세·admin 상세에서 사양·요청사항·이미지가 누락 없이 보이는지 육안 확인.

## 7. 상태 — 완료 (2026-07-15)

- shared 디코더로 custom·sample·repair 사양, 활성 마감 옵션, 요청 메모를 항목별로 표시한다. 미지 옵션은 폴백 라벨로 보존하고 저장소 식별자는 제외한다.
- store·admin 주문 상세에 참고/수선 이미지의 관계 검증 조회·서명 URL 흐름과 수선 수거·발송 읽기모델을 연결했다. admin에는 배송 요청·메모와 지역화된 주문 유형도 표시한다.
- OpenAPI/api-client를 재생성하고 맞춤·샘플·수선 로컬 시드를 추가했다. Python 652건, store 174건, admin 111건, shared 51건과 빌드·타입체크를 통과했으며 Aside에서 양 앱의 세 주문 상세와 서명 URL 동작을 확인했다.

# e2e-01 스토어 결과 후속 수정 플랜

> `docs/reviews/e2e-01-store-2026-08.md`의 FAIL 3건과 시드 기인 WARN을 해소한다.
> FAIL 1·2는 코드 결함이 아니라 시드 데이터 결함이 원인이고, FAIL 3만 API 로직 수정이다.
> 프론트 수정은 없다 — 후기 버튼은 `customer_actions` 기반이라 API만 고치면 된다.

## 1. 관리자 상품 상세 409 — 시드 상품 이미지 연결 (FAIL 1, 배포 차단)

**원인**: `GET /admin/products/{id}`의 `_linked_product_image_ids`(`apps/api/src/api/domains/admin/products.py:235`)는
상품 대표 이미지에 대응하는 `images` 행(`entity_type="product_primary"`, URL이 object_key로 끝남)을
필수로 요구하고 없으면 `invalid_product_image_state` 409를 던진다. 시드 상품(`apps/api/scripts/seed.py`의
`PRODUCTS`)은 `https://placehold.co/600x600` 외부 URL만 갖고 `images` 행이 없어 상세 조회가 항상 409다.
admin 생성 플로우로 만든 상품은 영향 없다 — 조회 로직은 그대로 두고 시드를 고친다.

- `seed.py`에서 상품마다 placeholder PNG 1장을 fake-GCS에 업로드(api `integrations/gcs.py` 헬퍼 재사용)하고,
  `entity_type="product_primary"` `entity_id=product.id`인 `Image` 행을 만든 뒤
  `product.image = public_asset_url(settings, object_key)`로 저장한다.
- 멱등 + 백필: 이미 존재하는 상품이라도 `product_primary` 연결이 없으면 이미지 업로드·`Image` 행·URL 갱신을
  수행한다 — 기존 로컬 DB를 재시드만으로 복구할 수 있어야 한다.
- 상세 이미지(detail_images)는 시드에 없으므로 그대로 빈 배열 유지.

## 2. 시드 상품 확대 — 홈 인기 상품·목록 분기 (FAIL 2 + WARN 1 일부)

**원인**: 홈 인기 상품은 `sort=popular&limit=4` 서버 조회(`apps/store/src/features/home/popular-products.tsx`)인데
게시 시드 상품이 2개뿐. S1의 "12개 초과 더 보기/무한스크롤", S2의 "재고 5개 이하 `N개 남음`" 분기도
같은 이유로 실행 불가였다.

- `PRODUCTS`를 상수 2개 나열 대신 루프 생성으로 바꿔 **14개**(카테고리 4종 × 색·패턴·소재 조합)를 시드한다.
  기존 코드(`3F-SEED-001`, `KN-SEED-001`)는 유지해 기존 주문·후기 참조를 깨지 않는다.
- 그중 1개 상품에 재고 3인 옵션을 포함한다 (S2 `N개 남음` 분기).
- 전 상품이 1번 항목의 이미지 연결 규칙을 따른다.

## 3. 구매확정 전 후기 버튼 노출 (FAIL 3)

**원인**: `apps/api/src/api/domains/orders/status_machine.py:117`의
`REVIEWABLE_STATUSES = {"완료", "배송완료", "제작완료", "수선완료"}` — 배송완료(구매확정 전)부터
`write_review`가 내려간다. 제작완료·수선완료도 배송 전 중간 상태라 같은 문제다.

- `REVIEWABLE_STATUSES = {"완료"}`로 축소 — 후기는 구매확정(완료) 이후에만.
  기능 명세 원본(YeongSeon)에는 주문 후기 기능 자체가 없어 대조 기준이 없고, e2e 기대(구매확정 후 노출)를 따른다.
- `apps/api/tests/test_reviews.py`의 상태 전제를 완료 기준으로 갱신하고,
  "배송완료에서는 write_review 없음" 회귀 케이스를 추가한다.
- 응답 스키마 변경 없음(actions 값만 변동) — api-client 재생성 불필요. 프론트 무수정.

## 4. e2e 재실행 지시서 반영 (WARN 2·3·4 — 시나리오 순서 문제)

코드 수정 대상이 아니라 다음 재실행 시 시나리오 순서로 해소한다. 재실행 지시서 작성 시 반영:

- S18: **알림 ON을 전화 인증 전에 먼저** 실행해 "미인증 ON → 인증 성공 시 자동 ON" 결합 분기를 태운다.
- 주문·클레임 Solapi DRYRUN 로그: 전화 인증을 마친 뒤 새 주문·클레임을 실행해 알림 경로를 검증한다.
- SA2: 활성 클레임이 있는 주문에서 상태 변경을 시도해 클레임 차단 사유 툴팁을 재현한다.

SA7 결제 이상 상세는 이상 결제 데이터를 만들어야 해서 이번 범위에서 제외한다.

## 검증

- `uv run pytest` — test_admin_products·test_reviews 통과.
- 시드 재실행(기존 DB 그대로) 후 `GET /admin/products/1` 200, 옵션 재고 편집 화면 렌더 (S3 재고 0 분기 실행 가능).
- store 홈 인기 상품 4개 렌더, `/shop` 12개 초과 더 보기 동작, 재고 3 옵션에 `3개 남음` 표시.
- 배송완료 주문 상세에 후기 버튼 없음 → 구매확정 후 노출 (Aside로 S14 재확인).

## 상태 — 계획

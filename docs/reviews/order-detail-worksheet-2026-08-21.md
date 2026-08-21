# 주문·수기 주문 상세를 작업지시서로 (2026-08-21)

`docs/plans/order-detail-worksheet.md`의 항목 1~8을 전부 실행한 결과다. 실행 중 사용자 요청으로
**품목별 첨부 이미지**와 **주문제작 원단 라벨**을 추가했다. store·모바일은 손대지 않았다.

## 서버

| 파일 | 변경 |
|---|---|
| `db/src/db/models/commerce.py` | `manual_orders.discount`(기본 0) + CHECK `discount >= 0`·`discount <= amount` |
| `db/migrations/versions/20260821_c8b2e5f1a094_*.py` | 위 컬럼·제약. 제약명은 bare name으로 넘겨 naming_convention이 확장하게 한다(아래) |
| `apps/api/.../admin/manual_orders.py` | `discount`(422 검증), 첨부 이미지 2개 엔드포인트, 링크·만료, `images` 출력 |
| `apps/api/.../admin/orders.py` | 대시보드 수기 매출 = `amount - discount + shipping_fee` |
| `apps/api/.../images/service.py` | `_verify_object_metadata` → `verify_object_metadata`(재사용을 위해 공개) |
| `docs/api-spec/domains.md` | 매출 기준 갱신 + §8에 `manual_order_upload` 규약 추가 |

`amount`는 **원금 그대로** 뒀다. `discount` 기본 0이므로 기존 행의 매출 합계는 변하지 않는다.

### 이미지 계약

`manual_order_upload`(uploads 버킷, TTL 24h) → 저장 시 `manual_order`(entity_id=주문 id,
expires_at=NULL). 등록·수정 요청은 **남길 이미지 전체 목록**이고 빠진 이미지는
`expires_at = now()` — 정리는 기존 `cleanup-images` 배치가 `expires_at` 기준으로 한다(화이트리스트
아님). complete 엔드포인트는 만들지 않았다: 링크 시점의 `verify_object_metadata` 한 번으로 충분하다.

발급 요청은 `content_type`·`size_bytes`만 받는다. 객체 키 확장자는 `IMAGE_EXTENSIONS`로
content_type에서 뽑는다 — 형식 화이트리스트를 하나로 유지하려고 클라이언트 `filename`을 신뢰하지
않는다(products 쪽은 아직 filename+확장자 세트 2개를 쓴다).

수정 시 링크를 허용하는 id는 두 종류다 — (a) 본인이 올린 신규 스테이징, (b) 이미 이 주문에 링크된
행. (b)에 `uploaded_by` 검증을 걸지 않는다(다른 관리자가 수정만 해도 저장이 깨진다).

### 품목별 이미지 (추가 요청)

`items[].image_upload_ids`를 품목 JSONB에 둔다. 링크·만료·읽기 URL은 주문 단위와 **완전히 같은
경로**를 쓰고, "어느 품목 것인지"만 JSON에 남는다. 한 이미지는 주문 단위와 품목 중 한 곳에만 붙는다
(양쪽에 넣으면 422) — 아니면 만료 판단이 갈린다. `ManualOrderOut.images`는 주문의 살아 있는 이미지
전체이고, 화면이 `items[].image_upload_ids`로 갈라 그린다.

## admin

| 파일 | 변경 |
|---|---|
| `pages/orders/detail.tsx` | 개요를 수취인 중심으로, 금액 1행, "항목" 탭 제거(품목·수선 발송·첨부를 개요로), 탭 라벨 `배송`, 캡처 래퍼·저장 버튼 |
| `pages/manual-orders/detail.tsx` | 금액 1행, "주문 품목", 첨부 이미지 카드, 품목별 사진, 캡처 래퍼·저장 버튼 |
| `pages/manual-orders/manual-order-form.tsx` | 할인 칸·계산 한 줄, `ImageAttachments`(주문 단위 + 품목별), 원단 라벨 |
| `pages/manual-orders/upload.ts` | 신규. 업로드 URL 발급 → PUT (complete 없음) |
| `shared/lib/capture.ts` | 신규. `domToPng(scale 2)` + 토큰에서 읽은 배경색 + `data-capture-hide` 제외 |
| `shared/lib/format.ts` | `formatAmountBreakdown` — `100,000 − 10,000 + 3,000 = ₩93,000` |
| `shared/ui/private-asset-preview.tsx` | 마운트 시 읽기 URL 자동 발급, 버튼은 "URL 재발급"(캡처 제외) |
| `pages/manual-orders/edit.tsx` | `manualOrderId` 전달 — 저장된 첨부의 썸네일 발급용 |
| `pnpm-workspace.yaml`, `apps/admin/package.json` | `modern-screenshot@^4.7.0`(catalog) |

품목 첨부 UI는 shared의 `AttachmentDisplayField`를 쓴다(하네스 규칙 0). 캡처 라이브러리는
`html-to-image`가 2025-04 이후 릴리스가 없어 기각했다.

### 수선 품목 표기를 한 곳으로

`item_data.tie`를 읽는 코드가 admin(`repairItemDetailItems`)과 shared
(`decodeOrderItemContent`의 repair 분기) 두 곳에 있어 수선 필드가 늘면 둘 다 고쳐야 했다. 파싱을
`decodeTieSpec` 하나로 모으고 **표기는 둘 다 유지**했다 — admin은 작업지시서용(`[자동] 타입·마감`),
store는 고객용(`자동 타이 방식` + 태그)이라 라벨을 합치면 어느 한쪽 문구가 나빠진다. admin은
`AdminOrderContent`가 수선까지 담당해 품목당 한 번만 그린다(이전엔 개요에 "수선 품목" 카드가 따로
있어 같은 값이 두 형식으로 나왔다).

## 함정 3개 (다음에 또 밟을 것들)

**1. `op.create_check_constraint`에 완성된 제약명을 주면 두 번 접두된다.**
`"ck_manual_orders_discount"`를 넘기면 실제 이름이 `ck_manual_orders_ck_manual_orders_discount`가
된다 — naming_convention이 다시 확장하기 때문이다. 모델의 `CheckConstraint(name=...)`와 같은 **bare
name**을 넘겨야 autogenerate 드리프트가 안 생긴다. `drop_constraint`는 반대로 최종 이름을 쓴다.

**2. 자식 effect에서 부모의 mutation을 즉시 호출하면 완료 알림을 놓친다.**
`PrivateAssetPreview`가 마운트 effect에서 곧바로 `onRequest()`를 부르면 읽기 URL은 잘 오는데
`mutation.isPending`이 영구히 true로 남아 버튼이 계속 로딩이었다(자식 effect가 부모보다 먼저 돌아
호출자의 구독이 아직 없다). `setTimeout(onRequest, 0)`으로 한 틱 미뤄 해결.

**3. 캡처 이미지에 조작 컨트롤이 찍힌다.** 저장 버튼은 래퍼 밖에 뒀지만 "URL 재발급"은 첨부 카드
안이라 PNG에 들어가고, 위치까지 어긋나 보였다. `data-capture-hide` + `domToPng`의 `filter`로 제외.

## 검증

- 스키마: `\d manual_orders`에 `discount` + 두 CHECK, downgrade/upgrade 왕복 확인
- `uv run pytest apps/api/tests/test_admin_manual_orders.py apps/api/tests/test_admin_orders.py` 통과
  (할인 매출 합산·422·업로드→링크→read-url·남의 주문 404·품목 이미지 왕복)
- `pnpm lint`·`pnpm typecheck`·`pnpm --filter admin test`(237)·`pnpm architecture:check`·`ruff`·`pyright`
- codegen 드리프트 없음
- 브라우저(Aside, admin :3001): 수기 주문을 할인 + 사진으로 등록 → 금액 한 줄
  `100,000 − 10,000 + 3,000 = ₩93,000`, 사진이 버튼 없이 표시, **PNG에 사진과 한글 글꼴이 정상
  포함**(dataURL을 열어 눈으로 확인). 품목 사진 2장 → 수정에서 썸네일 표시 → 1장 제거 후 저장 →
  상세에 1장. 주문 상세도 개요 한 화면·PNG 확인.

주문 상세 PNG의 사진 자리가 비는 경우가 있는데, 로컬 fake-gcs에 그 시드 객체가 없어서다(라이브
화면에서도 ImageFrame 폴백이다). 코드 문제가 아니다.

## 남긴 것

- store 주문 상세·클레임·목록의 금액 표기는 그대로(플랜 non-goal)
- 인쇄·PDF 경로 없음. A4 여러 장짜리 지시서가 필요해지면 그때 `window.print()`를 재론
- 로컬 DB에 검증용 수기 주문 2건(`작업지시 테스트`·`품목사진 테스트`)이 남아 있다

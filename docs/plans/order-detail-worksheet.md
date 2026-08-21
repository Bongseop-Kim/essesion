# 주문·수기 주문 상세 개편 — 개요를 작업지시서로

admin의 주문 상세(`apps/admin/src/pages/orders/detail.tsx`)와 수기 주문 상세
(`apps/admin/src/pages/manual-orders/detail.tsx`)를 "개요 한 화면 = 이미지로 저장해 작업장에 넘길
작업지시서"로 맞춘다. 2026-08-21 요청분 4건(금액 한 줄·수취인 중심 개요·섹션명 통일과
다운로드·수선/이미지 개요 이동)을 항목 1~8로 쪼갰다. 항목 1이 스키마·API를 건드리므로
항목 1 → 2 순서는 고정, 나머지는 독립 실행 가능하다. store·모바일은 손대지 않는다.

## 왜 필요한가

- **금액이 4행으로 흩어져 있다.** 주문 상세는 원금·할인·배송비·주문 금액을 각각
  DetailList 행으로 쓴다(`apps/admin/src/pages/orders/detail.tsx:708-721`). 수기 상세는
  금액·택배비 2행뿐이고 할인 개념이 아예 없다(`manual-orders/detail.tsx:230-231`).
- **수기 주문에 할인 칸이 없어서 장부가 실제와 다르다.** 전화·무통장 접수에서 깎아주는
  금액을 기록할 곳이 없으니 `amount`에 미리 깎은 값을 적는 편법밖에 없고, 그러면 원금이
  사라진다. 대시보드 매출도 `amount + shipping_fee`로 합산하므로
  (`apps/api/src/api/domains/admin/orders.py:389`) 할인의 흔적이 남지 않는다.
- **개요가 사용자 정보를 보여준다.** 물건이 실제로 가는 곳은 배송지의 수취인인데 개요에는
  회원 이름·이메일·전화가 있고(`orders/detail.tsx:694-706`), 수취인은 배송 탭에 있다
  (`orders/detail.tsx:763-800`). 개요만 보고 작업·발송을 못 한다.
- **섹션 이름이 세 가지다.** "주문 항목"(`orders/detail.tsx:955`), "수선 품목"(:730),
  "작업 품목"(`manual-orders/detail.tsx:237`). 같은 것이다.
- **첨부 이미지가 버튼 뒤에, 그것도 다른 탭에 있다.** 버튼을 둔 이유는 조회 비용이 아니다.
  서명 읽기 URL 발급을 명시적 관리자 액션으로 둔 초기 설계이고
  (`apps/admin/src/shared/ui/private-asset-preview.tsx:44-56`), 실제 발급은 서버 메모리
  캐시 뒤에 있어(`apps/api/src/api/integrations/gcs.py:180-201`) 자동 발급 비용은 이미지당
  GCS Class B 요청 1건 수준이다 — 자동 로드로 바꿔도 비용 근거가 없다.
- **수기 주문은 사진을 붙일 수 없다.** 종이 지시서에 클립으로 사진을 끼우던 자리가 없다.

## 범위 밖(non-goals)

- store 주문 상세·클레임 상세·목록 화면의 금액 표기. 이번엔 admin 상세 2개만 맞춘다.
- 수기 주문에 상태머신·회원 연결·주문번호를 붙이는 일. 수기는 계속 별도 장부다.
- 브라우저 인쇄·PDF 경로(§기각한 대안). 다운로드는 PNG 하나만 만든다.

## 실행 조건

- 로컬 부트스트랩(docker compose·alembic upgrade head·seed)이 끝난 상태.
- 항목 1은 Alembic revision을 추가한다 — DDL 직접 실행 금지(`db/README.md`).
- 항목 1·5는 OpenAPI가 바뀌므로 `pnpm codegen` 산출물을 같은 커밋에 넣는다.
- **항목 2는 항목 1 없이 실행하지 말 것** — 폼에서 보낼 필드가 서버에 없다.
- 커밋·푸시는 사람이 한다.

## 절차

### 1. 수기 주문 `discount` 컬럼과 매출 기준

`amount`의 의미는 **원금 그대로 둔다**. `discount`를 기본 0으로 추가하면 기존 행의
합계가 그대로 유지된다(과거 장부 매출이 조용히 바뀌는 것을 막는 유일한 방법).

- `db/src/db/models/commerce.py:648` 아래에 `discount: Mapped[int]`
  (`server_default=text("0")`) 추가, `__table_args__`(:655-659)에
  `CheckConstraint("discount >= 0")`와 `CheckConstraint("discount <= amount")` 추가.
- `db/migrations/versions/`에 새 revision 1개 — 컬럼 + 두 제약. 근거: 할인이 원금을 넘으면
  합계가 음수가 되어 대시보드 매출이 깎인다.
- `apps/api/src/api/domains/admin/manual_orders.py` — `ManualOrderCreateRequest`(:97-112)와
  `ManualOrderOut`(:119-132), `_out`(:135-152)에 `discount: int = Field(default=0, ge=0)`
  추가. `model_validator`로 `discount <= amount` 검증(422). 기본값이 있으므로 기존
  클라이언트 요청은 그대로 통과한다.
- `apps/api/src/api/domains/admin/orders.py:388-389` —
  `_MANUAL_ORDER_AMOUNT`를 `amount - discount + shipping_fee`로 바꾸고 위 주석 한 줄도 함께
  고친다. 근거: 대시보드 매출은 실수령액이어야 한다.
- `docs/api-spec/domains.md:85` — "금액은 `amount + shipping_fee`" 문장을
  `amount - discount + shipping_fee`로 갱신(대원칙: 명세가 정본).
- `apps/admin/src/pages/dashboard.tsx:128` — 수기 표 금액 렌더도 같은 식으로.
- `apps/api/tests/test_admin_manual_orders.py:231-257`의 대시보드 합산 테스트에 할인 있는
  행을 하나 추가하고, `discount > amount` 422 케이스를 새로 넣는다.

### 2. 수기 등록·수정 폼의 할인 칸

- `apps/admin/src/pages/manual-orders/manual-order-form.tsx` — `ManualOrderDraft`(:64-75)와
  `emptyManualOrderDraft`(:109-120)·`manualOrderDraftFrom`(:122-)에 `discount` 추가,
  `manualOrderDraftBody`(:296-)에서 전송. 라벨은 "할인", `NumberField`에
  `suffix="원" groupThousands`(금액·택배비와 동일, :452-469 사이에 배치).
- 검증(:239-244 옆): 0 이상 정수 + `할인 ≤ 금액`. 서버 422를 폼 에러로 흘리지 말고 여기서
  막는다.
- 폼 아래(또는 금액 칸 옆)에 계산 결과 한 줄을 텍스트로 보여준다 — 항목 3과 같은 식.
- `apps/admin/src/pages/manual-orders/new.test.tsx`의 전송 body 기대값에 `discount` 추가.

### 3. 금액을 한 줄로

두 화면 모두 **DetailList 한 행**으로 합친다. 라벨에 식, 값에 숫자를 둔다:
라벨 `원금 − 할인 + 배송비 = 주문 금액`, 값 `100,000 − 10,000 + 3,000 = 93,000원`.
값이 좁은 화면에서 접히는 것은 허용(`detail-list.tsx:19`의 `break-words`).

- `apps/admin/src/pages/orders/detail.tsx:708-721` 4행 → 1행. 주문 시각 행은 유지.
- `apps/admin/src/pages/manual-orders/detail.tsx:230-231` 2행 → 1행. 수기는 배송비 라벨이
  "택배비"이므로 라벨은 `원금 − 할인 + 택배비 = 주문 금액`, 합계는 프론트에서 계산한다
  (API에 합계 필드를 새로 만들지 않는다).

### 4. 주문 상세 개요를 수취인 중심으로

- `apps/admin/src/pages/orders/detail.tsx:686-724`의 "주문 정보" 카드 행 구성을 바꾼다:
  주문 유형·주문 상태 → **수취인 이름·수취인 연락처·수취인 주소**(`data.shipping_address`의
  `recipient_name`/`recipient_phone`/`postal_code+address+address_detail`, 없으면 "-")
  → **회원**(이름만, `Link to={`/customers/${data.customer.id}`}` — 라우트는
  `apps/admin/src/app/router`의 `customers/:userId`) → 금액 한 줄(항목 3) → 주문 시각.
- 고객 이메일·전화 행(:698-706)은 삭제한다. 회원 상세에서 본다.
- 배송 탭의 "배송 정보" 카드(:763-800)에서 받는 분·수령인 연락처·배송 주소 3행을 삭제해
  중복을 없앤다. 배송 탭은 송장 2종·배송 요청·배송 메모만 남긴다.
- 수기 상세는 회원 연결이 없으므로 이 항목을 적용하지 않는다(이름·휴대폰·주소가 이미
  수취인 정보다).

### 5. 수기 주문 첨부 이미지 (선택 항목, 사진 없어도 저장 가능)

주문 참고 이미지와 같은 **비공개 uploads 버킷 + 서명 읽기 URL** 방식을 쓴다. 공개 assets
버킷을 쓰면 고객 사진이 인터넷에 그대로 노출된다(§기각한 대안).

- 서버: `apps/api/src/api/domains/admin/manual_orders.py`에 2개 엔드포인트를 추가하고
  `apps/api/src/api/domains/admin/products.py:596-643`(upload-url)의 구조를 그대로 베낀다.
  - `POST /admin/manual-orders/images/upload-url` — `entity_type='manual_order_upload'`,
    객체 키 접두사 `uploads/manual_order_upload/`, TTL 24h,
    `Image` 행 생성 후 서명 PUT URL 반환. 검증 상수는
    `apps/api/src/api/domains/images/service.py:20-22`(10MB, jpeg/png/webp) 재사용.
  - `POST /admin/manual-orders/{id}/images/{image_id}/read-url` — 소속 검증 후
    `SignedReadUrlOut`. `apps/api/src/api/domains/admin/router.py:162-173`과 같은 모양.
  - 별도 complete 엔드포인트는 만들지 않는다. 링크 시점에 `gcs.object_metadata`로
    크기·타입을 한 번 검증하면 충분하다(`images/service.py:54-64`의 `_verify_object_metadata`
    재사용).
- 링크: `ManualOrderCreateRequest`에 `image_upload_ids: list[UUID]`(최대 5, 중복 금지).
  `_apply_body`(:165-169) 뒤에서 해당 `Image` 행을 `entity_type='manual_order'`,
  `entity_id=수기주문 id`, `expires_at=None`으로 갱신하고, 목록에서 빠진 기존 이미지는
  `expires_at=now()`로 만료시킨다. **수정(PUT) 요청도 같은 `image_upload_ids`를 전체
  목록으로 보낸다** — 링크 단계에서 허용하는 id는 두 종류다: (a) 신규 스테이징
  (`entity_type='manual_order_upload'`, `uploaded_by=현재 admin`), (b) 이미 이 주문에
  링크된 행(`entity_type='manual_order'`, `entity_id=이 주문`) — (b)는 그대로 유지한다.
  (b)에는 `uploaded_by` 검증을 걸지 않는다 — 다른 관리자가 수정만 해도 저장이 깨진다.
  삭제 엔드포인트(`:236-242`)도 연결 이미지를 만료시킨다.
  정리는 기존 배치가 처리한다 — entity_type 화이트리스트가 아니라 `expires_at` 기준이고
  (`apps/api/src/api/domains/batch/router.py:110-124`) uploads 버킷이 기본값이다(:135-138).
- 출력: `ManualOrderOut`에 `images: list[...]`(id·content_type·size_bytes·created_at) 추가.
  형태는 `AdminOrderReferenceImageOut`(`admin/schemas.py:177-181`)과 동일하게.
- 폼: `manual-order-form.tsx`에 이미지 추가/제거 UI. 업로드 헬퍼는
  `apps/admin/src/pages/products/upload.ts`를 본떠 `manual-orders/upload.ts`로 새로 쓴다
  (products 헬퍼는 상품 전용 엔드포인트를 호출하므로 재사용 불가).
- 상세: "첨부 이미지" 카드 추가, `PrivateAssetPreview`로 렌더. 없으면 카드 자체를 숨긴다.
- 테스트: `apps/api/tests/test_admin_manual_orders.py`에 업로드→링크→read-url 경로와, 남의
  수기 주문 이미지로 read-url을 요청하면 404인지 확인하는 케이스를 추가한다.

### 6. 첨부 이미지 자동 표시

- `apps/admin/src/shared/ui/private-asset-preview.tsx` — 마운트 시 한 번 `onRequest`를
  자동 호출하고(호출자에서 하지 않는다: 세 군데가 같은 실수를 반복한다), 버튼은
  "URL 재발급"으로 남긴다. 실패 시 기존 Callout 경로 그대로.
- `orders/detail.tsx`의 "수선 발송 접수" 사진(:850-908)과 "첨부 이미지"(:911-944), 항목 5의
  수기 이미지가 모두 같은 컴포넌트를 쓰므로 이 한 곳만 고친다.
- 근거: 발급은 서버 캐시 뒤(`gcs.py:180-201`)이고 비용은 이미지당 Class B 요청 1건이다.

### 7. 수선·이미지를 개요로, "항목" 탭 제거

캡처 영역이 두 탭에 걸치면 잡을 수 없다 — `TabContent`는 비활성 탭을 렌더하지 않는다
(`packages/shared/src/components/tabs.tsx:183`). 그래서 캡처 대상 카드를 모두 개요로 모은다.

- `orders/detail.tsx:72-77` `ORDER_TABS`에서 `"items"` 제거. 알 수 없는 `?tab=` 값은 이미
  개요로 떨어지므로(:79-87) 기존 `?tab=items` 링크는 개요를 연다.
- "주문 항목" 카드(:952-988, AdminTable + 품목별 `AdminOrderContent`)와 그 아래
  `TechnicalDetails`를 개요 탭 안, "주문 정보" 카드 다음으로 옮긴다. `order_type === "repair"`
  전용 "수선 품목" 카드(:726-757)는 이 카드에 흡수시킨다 — 같은 품목을 두 번 그리지 않도록
  `repairItemDetailItems`(:105-142) 출력은 옮긴 카드 안에서 렌더한다.
- "수선 발송 접수"(:850-908)와 "첨부 이미지"(:911-944) 카드를 개요로 옮긴다. 배송 탭에는
  송장·배송 요청·메모와 "수선 수거 요청"(:824-847)만 남긴다 — 수거는 주소·비용을 다루는
  물류 정보다. 탭 라벨은 `배송·수선` → `배송`(:672-674).
- `hasShippingTab`(:411-417)에서 `repair_receipts`·`hasOrderImages` 항을 지운다 — 두 카드가
  개요로 갔으니 죽은 항이다(비토큰 주문은 첫 항으로 항상 탭이 생기므로 동작 변화 없음).
- `apps/admin/src/pages/orders/detail.test.tsx:190-201, 322, 685` — 탭 전환으로 품목 표를
  확인하던 단정을 개요 기준으로 고친다.

### 8. 섹션 이름 통일 + PNG 다운로드

- 품목 카드 제목을 세 곳 모두 **"주문 품목"**으로: `orders/detail.tsx:955`(+ AdminTable의
  `label`:959), 흡수된 수선 품목, `manual-orders/detail.tsx:237`,
  `manual-order-form.tsx:507`.
- 캡처 라이브러리 **`modern-screenshot`**을 추가한다. `pnpm-workspace.yaml`의 `catalog:`에
  버전을 등록하고 `apps/admin/package.json`의 `dependencies`에 `catalog:`로 참조(레포 규칙:
  store/admin 공유 의존성은 카탈로그 단일 선언). 2026-04 기준 유지보수 중(v4.7.0).
  `html-to-image`는 2025-04 이후 릴리스가 없어 기각.
- 인쇄·PDF는 만들지 않는다. 캡처 대상 래퍼에 `data-capture` 속성을 주고, 카드 헤더 밖의
  ActionButton("작업지시서 이미지 저장")에서 `domToPng(node, { scale: 2 })` →
  `<a download>`로 blob을 내려준다. 파일명은 `주문_{order_number}_작업지시서.png` /
  `수기주문_{이름}_{날짜}.png`. 버튼은 래퍼 밖에 두어 캡처에 안 찍히게 한다.
- 캡처 영역은 **주문 정보 + 주문 품목 + 첨부 이미지**. 항목 7로 셋이 모두 개요에 있고,
  사진 없는 수선 지시서는 작업장에서 쓸모가 없다.
- **사진이 PNG에 들어가는 조건은 이미지 호스트의 CORS다.** `modern-screenshot`은 canvas에
  라이브 `<img>`를 그리는 방식이 아니라 리소스를 `window.fetch`로 재요청해 dataURL로
  인라인한다(options.ts: `fetchFn`, `fetch.requestInit` 기본 `{cache:'force-cache'}`,
  `fetch.placeholderImage` — 실패 시 예외 없이 자리표시자로 대체). 따라서 `<img>`에
  `crossOrigin` 속성을 뚫는 작업은 **불필요하다**. 필요한 버킷 CORS는 이미 있다:
  uploads 버킷이 `GET, HEAD`를 `http://localhost:3001`·`https://admin.essesion.shop`에 허용
  (`infra/main.tf:88-93`, `infra/variables.tf:102-111`), 로컬 fake-gcs-server도 CORS 헤더 제공
  (`docker-compose.yml:20-27`) — **인프라·공용 컴포넌트 변경 없음**. 서명 읽기 URL이
  만료(READ_URL_TTL)된 채 캡처하면 fetch가 실패해 사진 자리가 비므로, 캡처 결과는 검증
  항목의 브라우저 실측으로 확인한다.
- `domToPng`에 `backgroundColor`를 지정한다 — 래퍼 요소 자체는 배경이 투명해서 지정하지
  않으면 PNG 배경이 투명/검정으로 나온다.
- 폰트: Pretendard는 jsdelivr CDN(`apps/admin/src/index.css:2`)에서 오고 `*` CORS라
  라이브러리가 웹폰트를 인라인할 수 있다. 실패하면 PNG의 글꼴만 시스템 폰트로 떨어지므로
  치명적이지 않다 — 검증에서 눈으로 확인한다.
- 수기 상세에도 같은 버튼·래퍼를 넣는다.

## 검증

- 스키마: `docker compose exec -T db psql -U essesion -d essesion -c "\d manual_orders"`에
  `discount` 컬럼과 두 CHECK 제약이 보인다.
- API: `uv run pytest apps/api/tests/test_admin_manual_orders.py apps/api/tests/test_admin_orders.py`
- 프론트: `pnpm --filter admin test && pnpm typecheck`, `pnpm lint`,
  구조·문서를 건드렸으므로 `pnpm architecture:check`.
- codegen 드리프트: `pnpm codegen` 후 `git status`가 깨끗해야 한다.
- 브라우저(Aside, `.claude/skills/aside-browser/SKILL.md`): 수기 주문을 할인 + 사진 1장으로
  등록 → 상세에서 금액 한 줄이 `원금 − 할인 + 택배비 = 합계`로 맞는지, 사진이 버튼 없이 바로
  보이는지, **이미지 저장 버튼으로 받은 PNG에 사진과 한글 글꼴이 제대로 들어갔는지**(빈
  사각형·깨진 글꼴이면 CORS·폰트 인라인 실패다). 주문 상세에서도 같은 확인.
- 대시보드: 할인 있는 수기 주문 1건을 `is_paid=true`로 두고 오늘 매출이 `amount - discount
  + shipping_fee`만큼 오르는지 확인.

## 되돌리는 법 / 상향 신호

- 항목 1: `uv run alembic -c db/alembic.ini downgrade -1`. `discount`는 기본 0이라 되돌려도
  기존 합계는 변하지 않는다. **상향 신호** — 대시보드 매출이 이전 값과 달라졌다면 할인
  0이어야 할 과거 행에 값이 들어간 것이다.
- 항목 7: `?tab=items` 링크가 404·빈 화면이 되면 fallback(:79-87)이 깨진 것이다. 탭 상수만
  되돌리면 된다.
- 항목 8: PNG에서 사진만 비면 그 origin이 버킷 CORS 목록에 없다는 뜻이다 —
  `upload_cors_origins`(`infra/variables.tf:102-111`)에 origin을 추가한다. 코드 되돌릴 것 없음.

## 실패 모드

`amount`를 "합계"로 재해석해 과거 장부 매출을 조용히 바꾸는 것, 그리고 캡처가 성공했다고
믿었는데 PNG 안의 사진이 빈 사각형인 것 — 이 두 개가 이 플랜의 실패 모드다. 전자는
`discount` 기본 0을 지켜서, 후자는 항목 8을 실제 브라우저에서 PNG를 열어보고 확인해서 막는다.
캡처는 예외를 던지지 않고 이미지만 비운 채 성공하므로 자동 테스트로는 잡히지 않는다.

## 기각한 대안

- **브라우저 인쇄(`window.print()`) → PDF 저장** — 의존성 0으로 끝나지만 요청은 사진(PNG)
  이다. 재론 조건: A4 여러 장짜리 지시서가 필요해질 때.
- **`html-to-image`** — 같은 일을 하지만 2025-04 이후 릴리스가 없다.
- **uploads 버킷에 CORS를 새로 열기** — 이미 열려 있다(`infra/main.tf:88-93`). 확인 없이
  terraform을 만지지 말 것.
- **api에 이미지 바이트 프록시를 만들어 dataURL로 치환** — 버킷 CORS가 이미 admin origin을
  허용하므로 불필요한 엔드포인트다. 재론 조건: 사진을 admin 외 origin에서도 캡처해야 할 때.
- **worker에서 PDF/이미지 렌더링** — 화면 한 장 뽑는 데 이미지 생성 워커를 끌어들일 이유가 없다.
- **수기 이미지를 공개 assets 버킷 + 기존 상품 이미지 엔드포인트로** — 경로·엔티티 타입이
  상품용이라 의미가 어긋나고, 무엇보다 고객 사진이 공개 URL로 노출된다.
- **"항목" 탭 유지 + 개요에 품목 카드 복제** — 캡처를 위해 같은 품목을 두 번 렌더하는 코드가
  탭을 지우는 것보다 길다. 재론 조건: 품목 표가 개요를 못 쓰게 만들 만큼 길어질 때.

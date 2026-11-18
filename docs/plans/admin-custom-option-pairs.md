# 관리자 제작 사양 표시 — 고른 옵션과 안 고른 옵션을 함께 보여 준다

관리자 화면의 주문 제작·샘플 주문 상세와 견적 요청 상세에서 제작 사양을, 수선 주문처럼 **선택지를 모두 그리고 고른 쪽만
채우는** 방식으로 바꾼다. 관리자 화면만 바꾸며 API·명세 변경은 없다. 2026-11-18에 운영자가 범위(주문 제작·샘플·견적 전부)를
확정했다. 바로 실행할 수 있다.

이 플랜의 실패 모드: 데이터에 없는 옵션을 "안 고름"으로 그리는 것. 옛 주문에는 없는 키가 있고, 샘플 주문에는 봉제 옵션이
아예 없다. 키가 없으면 그 선택지를 그리지 않는다 — 없는 것과 안 고른 것을 구별한다.

## 왜 필요한가

- 주문 제작 상세는 고른 값만 나열한다. 봉제 옵션은 고른 것만 꼬리표로 나오고 안 고른 것은 화면에서 사라진다
  (`packages/shared/src/order-content.ts:77-94` `optionContent` — `false`인 마감 옵션은 버린다). 운영자가 "바텍이 빠진 건지 원래
  없는 옵션인지" 화면에서 판단할 수 없어 헷갈린다고 했다(2026-11-18).
- 수선 주문은 2026-09-01에 같은 이유로 이미 바꿨다(`docs/reviews/admin-ui-dashboard-stack-and-order-options-2026-09-01.md` §2,
  `apps/admin/src/shared/ui/option-pair.tsx`). 주문 제작만 옛 방식으로 남아 있다.
- 견적 요청 상세도 받은 키를 순서대로 한 줄씩 나열한다(`apps/admin/src/pages/quotes/detail.tsx:300-303`). 스토어 플랜
  (`docs/plans/store-action-bar-quote-always.md`)으로 견적이 수량과 관계없이 들어오게 되면 이 화면을 더 자주 본다.

## 범위 밖

- 고객이 받는 견적서 엑셀(`apps/api/src/api/domains/orders/estimate.py`). 견적서는 "무엇을 얼마에 만드는지"를 확정하는 문서라
  고른 사양만 적는다. 안 고른 옵션을 적으면 결재 문서에 불필요한 줄이 늘고 "빠진 항목"처럼 읽힌다.
- 스토어의 고객용 주문 상세(`apps/store/src/pages/order/detail.tsx`)와 `decodeOrderItemContent`. 고객 화면은 고른 것만 보여 주는
  지금 방식을 유지한다. 그래서 shared의 디코더는 건드리지 않고 관리자 쪽에 표시 함수를 따로 둔다.
- 수선·수기 주문 상세. 이미 이 방식이다.

## 절차

1. **`OptionPair`를 선택지 N개·다중 선택까지 받게 넓힌다** — `apps/admin/src/shared/ui/option-pair.tsx`.
   `options`를 `readonly string[]`로, `selected`를 `string | readonly string[]`로 바꾼다. 그리는 방식(고른 쪽 solid + 체크,
   나머지 outline, 스크린리더 문구 "선택됨/선택 안 됨")은 그대로다. 포인트(없음·자수·열전사 필름)가 3지선다이고 봉제 옵션이
   다중 선택이라 필요하다. 이름은 호출부가 많아 그대로 둔다. 기존 호출(`orders/detail.tsx:160-183`,
   `manual-orders/detail.tsx`)은 바꾸지 않아도 타입이 맞는다.
2. **제작 사양 표시 함수 추가** — `apps/admin/src/shared/ui/custom-option-items.tsx`에
   `customOptionItems(options: unknown): DetailItem[]`. 아래 순서로, **해당 키가 `options`에 있을 때만** 행을 만든다.
   값 해석은 스토어가 보내는 형태(`apps/store/src/features/custom-order/model/options.ts:84-107`,
   `apps/store/src/features/sample-order/model/options.ts:34-42`)를 따른다.

   | 행 | 키 | 선택지 | 값 해석 |
   |---|---|---|---|
   | 주문 구분 | `reorder` | 신규 · 재주문 | 불리언 |
   | 원단 제공 | `fabric_provided` | 당사 원단 · 고객 제공 | 불리언. 포인트 주문이면 행을 만들지 않는다(아래) |
   | 포인트 | `point` | 없음 · 자수 · 열전사 필름 | `null` → 없음, `EMBROIDERY`, `HEAT_TRANSFER` |
   | 원단 | `fabric_type` | 폴리 · 실크 | `null` → 선택지 대신 "해당 없음" 글자(원단 제공·봉제 샘플). 포인트 주문이면 행을 만들지 않는다 |
   | 디자인 방식 | `design_type` | 날염 · 선염 | 원단 행과 같다 |
   | 타이 방식 | `tie_type` | 수동 타이 · 자동 타이 | `""`·`null`·`MANUAL` → 수동 |
   | 심지 | `interlining` | 폴리 · 울 | `""`·`POLY` → 폴리 |
   | 사이즈 | `size_type` | 성인용 · 아동용 | |
   | 타이 폭 | `tie_width` | (글자) | `8cm`. `null`이면 "미입력" |
   | 봉제·마감 | `triangle_stitch` `side_stitch` `bar_tack` `fold7` `spoderato` `brand_label` `care_label` | 있는 키 전부, 다중 선택 | `true`인 것만 채움 |
   | [자동] 옵션 | `dimple` `turn_knot` | 딤플 · 돌려묶기, 다중 선택 | 타이 방식이 자동이거나 둘 중 하나라도 `true`이면 행을 만든다. 수동에는 없는 옵션이라 평소엔 숨기지만, 옛 데이터에 수동 + `true`가 있으면 고른 값을 숨기면 안 된다 |

   - **포인트 주문(`point`가 자수·열전사 필름)에는 원단 제공·원단·디자인 방식 행을 만들지 않는다.** 포인트 주문은 정해진
     넥타이 위에 자수·필름만 올리는 방식이라 원단을 고르지 않고, 관리자도 그렇게 알고 있다(운영자 확인 2026-11-18).
     스토어는 이때 `fabric_provided`를 `true`로 보내지만(원단 비용이 없다는 뜻, `apps/store/src/features/custom-order/model/options.ts:85-88`)
     "고객 제공"으로 그리면 틀린 정보가 된다. 포인트 행에서 자수·필름이 채워져 있는 것으로 충분하다.
   - **포인트 주문에서는 심지·사이즈·타이 폭·봉제 옵션(삼각·옆선·바택·7폴드·스포데라토)도 고르는 항목이 아니다**(운영자 확인
     2026-11-18 — 고를 수 있는 건 포인트 방식·타이 방식·라벨뿐이다). 이 행들도 포인트 주문에서는 만들지 않고, 봉제·마감 행에는
     브랜드 라벨·케어 라벨만 그린다. 단 스토어 주문서가 지금은 이 항목들을 포인트 주문에서도 받고 과금하므로, 값이 실제로
     골라져 있으면(`true`·`WOOL`·아동용·폭 입력) 숨기지 않고 그대로 보여 준다 — 돈을 받은 옵션을 화면에서 지우면 안 된다.
     스토어·서버가 이 선택을 막는 작업은 `docs/plans/point-order-option-limits.md`가 다룬다(순서 무관 — 어느 쪽을 먼저 실행해도 된다).
   - 선택지에 없는 값(예: 나중에 생긴 세 번째 원단)은 선택지를 그리지 않고 값을 글자로 보여 준다 — 둘 다 미선택으로 그리면
     "아무것도 안 골랐다"로 읽힌다.
   - 표에 없는 키는 지금처럼 버리지 않고 표 뒤에 글자 행으로 붙인다(옛 견적의 `fabric`·`width`, 테스트의 `lining_color` 등).
     `object_key`·`image_id`·`upload_id`는 지금처럼 숨긴다.
   - 라벨 문구는 스토어 주문서의 표기를 정본으로 맞춘다. 스토어 주문서(`apps/store/src/pages/custom-order/index.tsx:1000`)와
     관리자 가격 설정(`apps/admin/src/pages/pricing.tsx:58`)은 "바택"인데 `order-content.ts:20`과 견적서 엑셀
     (`apps/api/src/api/domains/orders/estimate.py:22`)은 "바텍"이다. 새 함수는 "바택"으로 쓰고, 같은 PR에서 `order-content.ts:20`과
     `estimate.py:22`도 "바택"으로 고친다(운영자 확정 2026-11-18 — 영어 bar tack의 음차라 어느 쪽이든 무방하고, 고칠 곳이 적은
     쪽을 택했다. 엑셀은 글자 한 개만 고치는 것이라 범위 밖 조항과 충돌하지 않는다). "바텍"을 기대하는 테스트가 있으면 함께 고친다.
3. **주문 상세에 적용** — `apps/admin/src/pages/orders/detail.tsx:227-235`. 주문 유형이 `custom`·`sample`이면
   `decodeOrderItemContent`가 준 `rows` 중 사양 행 대신 `customOptionItems(item_data.options)`를 쓰고, 꼬리표(`tags`,
   `:271-277`)는 그리지 않는다(봉제·마감 행이 대신한다). 제작 수량·샘플 유형 행과 요청사항(`memo`)은 그대로 둔다.
4. **견적 상세에 적용** — `apps/admin/src/pages/quotes/detail.tsx:300-303`의 `optionItems`를 `customOptionItems(data.options)`로
   바꾸고, 쓰이지 않게 된 이 파일의 `OPTION_LABELS`·`OPTION_VALUES`(`:72-108`)·`formatQuoteOption`(`:119-130`)을 지운다.
   2026-09-01 리뷰가 "옵션 라벨 상수가 4개 파일에 중복 — 옵션 그룹이 추가되는 날 재론"이라고 남긴 것 중 관리자 쪽 두 곳이
   이 함수 하나로 합쳐진다.
5. **테스트**
   - 새 파일 `apps/admin/src/shared/ui/custom-option-items.test.tsx`: (a) 주문 제작 전체 옵션 — "실크 선택됨"·"폴리 선택 안 됨",
     봉제·마감에서 고른 것과 안 고른 것이 모두 보인다. (b) 수동 타이에는 [자동] 옵션 행이 없다. (c) 샘플(키 4개) — 봉제·마감
     행이 없다. (d) `fabric_type: null` → "해당 없음". (e) 모르는 키는 글자 행으로 남고 기술 키는 숨는다.
     (f) 수동 타이인데 `turn_knot: true`인 옛 데이터 — [자동] 옵션 행이 나오고 돌려묶기가 채워져 있다. (g) 포인트 주문 —
     원단 제공·원단·디자인 방식 행이 없고 포인트 행에 자수가 채워져 있다.
   - 고칠 테스트: `apps/admin/src/pages/orders/detail.test.tsx:508`(맞춤)·`:583`(샘플), `apps/admin/src/pages/quotes/detail.test.tsx`
     에서 옛 표기(값만 나열·"포함/미포함")를 기대하는 단언. `packages/shared/src/order-content.test.ts`는 디코더를 안 바꾸므로
     그대로 통과해야 한다.
6. **마무리** — 결과를 `docs/reviews/`에 기록하고 이 문서를 지운다.

## 검증

- `pnpm lint && pnpm typecheck && pnpm --filter admin test && pnpm --filter @essesion/shared test`
- 브라우저(admin :3001, 사용자가 띄워 둔 경우만):
  - 주문 제작 주문 상세 — 원단·타이 방식·심지·사이즈가 두 선택지로 보이고 고른 쪽만 채워져 있다. 봉제·마감 행에 7개가
    모두 보이고 고른 것만 채워져 있다. 수동 타이 주문에는 [자동] 옵션 행이 없다.
  - 포인트(자수·필름) 주문 — 원단 제공·원단·디자인 방식 행이 없다.
  - 샘플 주문 상세 — 봉제·마감 행이 없다. 봉제 샘플은 원단이 "해당 없음".
  - 견적 요청 상세 — 같은 표기. 기술 정보 접기 안의 원문은 그대로다.
  - 수선 주문 상세 — 바뀐 것이 없다.
  - 390px 폭에서 봉제·마감 배지가 줄바꿈되고 가로로 넘치지 않는다.

## 기각한 대안

- **봉제 옵션을 옵션마다 한 행씩(안 함 · 함) 9행으로** — 수선과 모양은 같지만 사양 카드가 두 배로 길어진다. 한 행에 배지로
  모으면 한눈에 들어온다. 배지가 많아 읽기 어렵다는 피드백이 오면 재론한다.
- **shared의 `decodeOrderItemContent`를 고쳐 스토어·관리자가 같이 쓰게** — 고객 화면까지 바뀐다. 고객에게 안 고른 옵션을 보여
  달라는 요청이 생기면 재론한다.
- **선택지 목록을 스토어 주문서 코드에서 가져오기** — 관리자가 스토어 앱을 import할 수 없고(모듈 경계), shared로 옮기는 건
  이 변경보다 큰 작업이다. 선택지가 바뀌면 절차 2의 "선택지에 없는 값은 글자로" 규칙 덕에 값이 숨지는 않는다.

# 포인트 주문 선택 항목 제한 — 타이 방식과 라벨만 고르게 한다

주문 제작에서 "자수·필름"(포인트)을 켠 주문은 정해진 넥타이 위에 자수·필름만 올리는 방식이다. 그런데 지금 주문서는 포인트
주문에서도 심지·사이즈·폭·봉제 옵션을 고르게 하고 서버는 그 값을 받는다. 스토어 주문서에서 이 항목들을 숨기고, 서버가 포인트
주문에 이 옵션이 오면 거절하게 한다. 돈 경로라 `docs/api-spec/money.md` 갱신이 포함된다. 규칙은 2026-11-18에 운영자가 확정했다.
바로 실행할 수 있다.

이 플랜의 실패 모드 두 가지: (1) 포인트를 켜기 전에 골라 둔 옵션이 화면에서는 숨었는데 금액에는 남는 것. (2) 스토어와 서버
규칙이 어긋나 포인트 주문 전체가 400으로 막히는 것 — 서버가 거절할 값을 스토어가 한 가지라도 계속 보내면 그렇게 된다.

## 확정된 규칙 (운영자, 2026-11-18)

포인트 주문에서

| 항목 | 고를 수 있나 |
|---|---|
| 수량, 포인트 방식(자수·열전사 필름), 로고 이미지, 요청사항 | 가능 |
| 타이 방식(수동·자동) | 가능 |
| 브랜드 라벨, 케어 라벨 | 가능 |
| 재주문 | 가능 |
| 딤플, 돌려묶기 | 불가 (자동 타이를 골라도) |
| 심지, 사이즈, 넥타이 폭 | 불가 |
| 삼각 봉제, 옆선 봉제, 바택, 7폴드, 스포데라토 | 불가 |
| 원단 직접 제공 | 불가 — 택배로 받는 절차가 필요해 작업 대비 얻는 게 적다 |

가격 공식은 그대로다: `기본 봉제비 + 고른 옵션 값(자동 타이·라벨) + 포인트 값 + 봉제 샘플비`. 원단비는 지금처럼 0.

## 왜 필요한가

- 지금은 포인트 주문 손님이 울 심지·7폴드 등을 고르면 실제로 해 주지 않는 옵션의 값을 낸다
  (`apps/api/src/api/domains/orders/service.py:678-694`가 포인트 여부와 무관하게 옵션 값을 더한다).
- 주문서는 포인트를 켜도 3·4·5단계를 그대로 보여 준다(`apps/store/src/pages/custom-order/index.tsx:803-1023`).
  2단계만 원단에서 포인트 방식으로 바뀐다(`:741-800`).
- 관리자 사양 표시 플랜(`docs/plans/admin-custom-option-pairs.md`)이 포인트 주문에서 이 행들을 숨기기로 했는데, 새 주문에 값이
  계속 들어오면 "고른 값은 숨기지 않는다" 규칙 때문에 행이 다시 나온다.

## 범위 밖

- 포인트 주문 전용 페이지. 수량·첨부·임시 저장·요약·버튼·결제가 전부 겹치고 서버 계산도 하나라, 기존 주문서를 고친다
  (아래 기각한 대안).
- 견적 요청 접수(`POST /quotes`)의 사양 검증. 견적은 사양을 검증 없이 저장하는 지금 방식 그대로다 — 스토어가 같은 정리된
  값을 보내므로 새 견적에는 금지 옵션이 들어오지 않는다.
- 이미 접수된 포인트 주문·견적의 데이터 수정. 관리자 화면이 고른 값을 그대로 보여 준다.

## 실행 조건

- 스토어 변경(절차 1~3)이 서버 변경(절차 4)보다 **먼저 또는 같은 배포로** 나가야 한다. 서버가 먼저 나가면 지금 스토어가 보내는
  포인트 주문 중 금지 옵션이 섞인 것이 400으로 막힌다.
- `docs/plans/store-action-bar-quote-always.md`와 같은 파일(`custom-order/index.tsx`, `model/options.ts`)을 고친다. 둘 중 나중에
  실행하는 쪽은 줄 번호가 밀려 있으니 이름(함수·섹션 id)으로 찾는다.

## 절차

1. **서버로 보내는 값을 한 곳에서 정리한다** — `apps/store/src/features/custom-order/model/options.ts`.
   - `customOrderApiOptions`(`:84-107`)에서 `pointEnabled`이면 다음으로 고정한다: `interlining: ""`, `size_type: null`,
     `tie_width: null`, `triangle_stitch`·`side_stitch`·`bar_tack`·`fold7`·`spoderato`·`dimple`·`turn_knot` 전부 `false`,
     `fabric_provided: false`. `tie_type`·`brand_label`·`care_label`·`reorder`·`point`는 고른 값 그대로.
     지금 `normalizedTieOptions`(`:79-82`)가 수동 타이의 딤플을 정리하는 것과 같은 자리·같은 방식이다. 화면 state는 건드리지 않는다 —
     포인트를 껐다 켜면 골라 둔 값이 돌아온다(참고 이미지 칸과 같은 관례, `custom-order/index.tsx:287-288` 주석).
   - `fabric_provided`를 `false`로 보내는 이유: 지금은 "원단비 없음"의 뜻으로 포인트 주문에 `true`를 보내는데
     (`:85-88`), 서버는 `point`만으로 원단비를 0으로 계산하므로(`service.py:653`) `true`일 필요가 없고, `true`면 관리자 화면에서
     "고객 제공"으로 읽힌다.
   - `invalidCustomOrderSection`(`:134`~): `pointEnabled`이면 넥타이 폭·딤플·돌려묶기 검증을 건너뛴다. 숨은 칸 때문에 제출이
     막히면 안 된다.
   - **결제 초안이 빈 폭을 받게 한다** — `apps/store/src/features/custom-order/model/draft.ts:53-55`의 `orderOptionsSchema`는
     `tieWidth`를 숫자로만 받는다. 포인트 주문은 폭 칸이 숨어 빈 값(`""`)인 채로 넘어가므로, 그대로 두면 결제 페이지가 초안을
     버리고 주문서로 되돌려 보낸다(`pages/order/custom-payment.tsx:16-19`). `pointEnabled`이면 빈 폭을 허용하도록 고친다
     (포인트가 아니면 지금처럼 숫자만). `docs/plans/store-action-bar-quote-always.md`가 추가하는 견적 초안 스키마도 같은
     `orderOptionsSchema`를 쓰므로 함께 풀린다.
   - `customOrderSummary`(`:212-244`): `pointEnabled`이면 "규격" 행을 빼고 "타이" 행에서 돌려묶기 표기를 뺀다. "원단" 행의
     `fabricProvided` 분기가 포인트보다 먼저 걸리지 않게 순서를 바꾼다(포인트면 "정해진 원단").
2. **주문서에서 숨긴다** — `apps/store/src/pages/custom-order/index.tsx`. `options.pointEnabled`일 때
   - 1단계 주문 방식(`:576-606`): "자수·필름"을 켜면 "원단 직접 제공"을 `disabled`로, "원단 직접 제공"을 켜면 "자수·필름"을
     `disabled`로 한다. `:600`의 "함께 고를 수 있다" 주석을 고친다.
   - 3단계 봉제(`:803-894`): "타이 종류"만 남기고 "봉제 옵션" 묶음(`:844`~, 딤플·돌려묶기·스포데라토·7폴드)을 숨긴다.
   - 4단계 사양(`:896-952`): 단계 전체를 숨긴다.
   - 5단계 마감(`:954-1023`): "심지" 묶음(`:957`~)을 숨기고 "마감 옵션"에서는 브랜드 라벨·케어 라벨만 남긴다.
   - 단계 번호가 3 → 5로 건너뛰지 않게 한다. 제목의 숫자("3. 봉제" 등)가 하드코딩이므로 보이는 단계 순서대로 번호를 매긴다.
   - 브랜드 라벨을 고르면 라벨 도안 칸이 나오는 지금 동작(`referenceParts`)은 그대로다.
3. **스토어 테스트** — `apps/store/src/features/custom-order/model/options.test.ts`.
   - `:35` "자수·열전사는 원단 없이 포인트만…" 케이스를 고친다: `fabric_provided`가 `false`로 나간다.
   - 추가: 울 심지·7폴드·딤플(자동)·폭 8을 골라 둔 상태에서 포인트를 켜면 `customOrderApiOptions`가 절차 1의 고정값을 내고,
     브랜드 라벨·자동 타이는 그대로 나간다. 폭이 빈 값이어도 `invalidCustomOrderSection`이 `null`이다.
   - `model/draft.test.ts`에 추가: 폭이 빈 포인트 주문 초안은 `parseCustomOrderDraft`를 통과하고, 폭이 빈 일반 주문 초안은 `null`이다.
   - `apps/store/src/pages/custom-order/index.test.tsx:220` "자수·필름 주문은 넥타이 칸 대신 로고 칸만…" 옆에 한 줄: 포인트를
     켜면 "넥타이 폭"·"심지"·"삼각 봉제"가 화면에 없고 "브랜드 라벨"·"타이 종류"는 있다.
4. **서버가 거절한다** — `apps/api/src/api/domains/orders/service.py`의 `calculate_custom_amounts`(`:626`). 기존 옵션 검증
   (`:635-648`) 바로 뒤에: `point`가 있는데 `interlining == "WOOL"`이거나 `triangle_stitch`·`side_stitch`·`bar_tack`·`fold7`·
   `spoderato`·`dimple`·`turn_knot` 중 하나라도 참이면 `DomainError(code="invalid_options")`(400).
   - 이 함수는 금액 계산(`router.py:77`)·견적서 메일(`router.py:90`)·주문 생성(`service.py:722`)이 모두 지나가므로 한 곳이면 된다.
   - `fabric_provided`·`size_type`·`tie_width`는 거절하지 않는다. 가격에 영향이 없고, 지금까지 스토어가 포인트 주문에
     `fabric_provided: true`를 보내 왔다(`apps/api/tests/test_orders_create.py:386`이 그 조합의 성공을 확인한다). 이 셋은 스토어가
     보내지 않는 것으로만 막는다.
5. **명세 갱신** — `docs/api-spec/money.md:51`. "원단 직접 제공·재주문과 함께 고를 수 있다"를 다음 뜻으로 고친다: 포인트 주문은
   타이 방식(`tie_type`)과 라벨(`brand_label`·`care_label`)·재주문만 함께 고를 수 있다. `interlining='WOOL'`과 bool 7종
   (`triangle_stitch, side_stitch, bar_tack, fold7, spoderato, dimple, turn_knot`)이 참이면 `invalid_options`. 원단 직접 제공은
   스토어가 함께 고르지 못하게 막고, 서버는 포인트 주문의 `fabric_provided` 값을 가격에 쓰지 않는다(과거 페이로드 호환).
   요청·응답 스키마는 그대로라 codegen 변화는 없다 — `pnpm codegen`으로 확인한다.
6. **서버 테스트** — `apps/api/tests/test_orders_create.py:382-404`.
   - 주석(`:382-383`)을 새 규칙으로 고친다. 기존 세 케이스(포인트 단독, `fabric_provided: True`, `reorder: True`)는 그대로 통과해야 한다.
   - 추가: 포인트 + `tie_type: "AUTO"` + `brand_label: True` → 200이고 봉제비에 자동 타이·라벨 값이 더해진다.
   - 추가: 포인트 + 금지 옵션 8가지 각각(`interlining: "WOOL"`, bool 7종) → 400 `invalid_options`.
7. **제작 기간 문구를 주 단위로 정리하고 포인트 주문 기간을 넣는다** — 서버와 무관한 문구 변경이라 절차 1~6과 따로 내도 된다.
   지금 숫자(28~42·21~28·7~14)는 전부 7의 배수라 달력 주 단위로 잡은 값에 "영업일"이 붙은 것으로 보인다(추정 — 근거 문서는
   없다). 글자 그대로 읽으면 실제 의도보다 길거나 짧게 읽히므로 "약 N~M주" 한 가지 표기로 통일한다. 영업일 숫자·"더 빨리 될 수
   있다" 같은 덧붙임은 넣지 않는다(운영자 방침 2026-11-18: 사이트에는 넉넉하게, 문구는 단순하게).

   | 주문 종류 | 지금 | 바꾼 뒤 | 확정 여부 |
   |---|---|---|---|
   | 일반 | 영업일 기준 28~42일 | 약 6~8주 | 운영자 확정 |
   | 포인트(자수·필름) | 일반과 같게 나옴 | 약 3~5주 | 운영자가 "영업일 15~25일"로 정한 것을 주로 환산 |
   | 재주문 | 영업일 기준 21~28일 | 약 4~6주 | 제안 — 실행 전 운영자 확인 |
   | 원단 직접 제공 | 영업일 기준 7~14일 | 약 2~3주 | 제안 — 실행 전 운영자 확인 |
   | 샘플 주문 | 28~42일("영업일" 없음) | 약 6~8주 | 제안 — 실행 전 운영자 확인 |

   "제안" 세 줄은 지금 표기(영업일)를 주로 환산해 짧아지지 않게 올림한 값이다. 확인을 못 받았으면 그 줄은 고치지 않고 위 두 줄만 고친다.
   - `apps/store/src/pages/custom-order/index.tsx:1187-1191` `productionPeriod`: 포인트 분기를 맨 앞에 추가하고(포인트 + 재주문도
     포인트 기간) 나머지 값을 표대로 고친다.
   - `apps/store/src/features/custom-order/ui/custom-order-service-guide.tsx`: `:135` 유의사항(괄호 안에 포인트 기간도 추가),
     `:156` 재주문 FAQ, `:197` 히어로 알약("제작 약 6~8주"), `:258` 가격 섹션 칸.
   - 샘플: `apps/store/src/features/sample-order/ui/sample-order-service-guide.tsx:12`, `apps/store/src/pages/sample-order/index.tsx:137`.
   - `docs/plans/home-redesign-yg3ke.md:70`은 "출처 문구와 다르면 출처 값을 따른다"고 적혀 있어 고치지 않는다.
   - 고친 뒤 `grep -rn "28~42\|21~28\|7~14" apps/store/src`가 (확인 못 받은 줄을 빼고) 비어야 한다.
8. **마무리** — 결과를 `docs/reviews/`에 기록하고 이 문서를 지운다.

## 검증

- `pnpm lint && pnpm typecheck && pnpm --filter store test`
- `uv run pytest apps/api/tests/test_orders_create.py apps/api/tests/test_estimate_email.py`, `uv run ruff check . && uv run pyright`
- `pnpm codegen` 뒤 `git status`에 `packages/api-client` 변경이 없다.
- 서버(api :8000, 사용자가 띄워 둔 경우만):
  `curl -s -X POST localhost:8000/orders/custom/calculate -H 'content-type: application/json' -d '{"options":{"point":"EMBROIDERY","fold7":true},"quantity":4}'`
  → 400 `invalid_options`. `fold7`을 빼고 `"brand_label":true`를 넣으면 200.
- 브라우저(store :3000 `/custom-order`, 사용자가 띄워 둔 경우만):
  - 울 심지·7폴드·삼각 봉제를 고른 뒤 "자수·필름"을 켠다 → 사양 단계와 심지·봉제 옵션이 사라지고 단계 번호가 이어진다.
    **예상 금액의 봉제 비용이 줄어든다**(고른 옵션 값이 빠진다 — 실패 모드 1 확인).
  - "자수·필름"을 끄면 골라 둔 값이 돌아오고 금액도 돌아온다.
  - "자수·필름"을 켠 상태에서 "원단 직접 제공"이 비활성이고, 반대도 그렇다.
  - 주문서의 "주문 전 확인해 주세요" 안내가 일반 "약 6~8주", "자수·필름"을 켜면 "약 3~5주"로 바뀐다.
  - 포인트 주문으로 구매하기 → **주문서로 되돌아오지 않고** 결제 페이지가 열리며 사양에 "규격" 행이 없다. 견적서 메일 → 엑셀 제작 사양에 규격·심지·추가 옵션 줄이
    없다(값이 비어 자동으로 빠진다 — `apps/api/src/api/domains/orders/estimate.py:86-100`. 코드 변경 없음).

## 되돌리는 법 / 상향 신호

- 배포 뒤 포인트 주문의 금액 계산이 400으로 실패한다는 문의·오류 로그(`invalid_options`)가 보이면 스토어가 금지 값을 보내고
  있다는 뜻이다(실패 모드 2). 절차 4의 검증 한 블록만 되돌리면 서버는 예전처럼 받는다. 스토어 변경은 그대로 둬도 된다.
- 배포 순간 주문서를 열어 둔 탭은 옛 화면이라 금지 옵션을 보낼 수 있다. 금액 계산 실패 안내가 뜨고 새로고침하면 풀린다.
  호환 처리는 넣지 않는다.

## 기각한 대안

- **포인트 주문 전용 페이지를 따로 만든다** — 화면이 단순해지지만 수량·첨부·임시 저장·요약·구매/견적/견적서 메일 버튼·결제 연결을
  두 벌 유지해야 하고 서버 계산은 어차피 하나다. 포인트 주문이 가격 체계나 안내 페이지까지 다른 독립 상품이 되면 재론한다.
- **서버가 금지 옵션을 거절하지 않고 조용히 무시한다** — 손님이 본 금액과 화면 선택이 어긋난 채 주문이 들어온다. 돈 경로는
  어긋나면 드러나야 한다.
- **포인트 + 원단 직접 제공을 서버에서도 거절한다** — 지금 스토어가 모든 포인트 주문에 `fabric_provided: true`를 보내고 있어
  배포 순서가 조금만 어긋나도 포인트 주문 전체가 막힌다. 가격에 영향이 없는 값이라 스토어에서만 막는다.
- **화면 state에서도 값을 지운다** — 포인트를 실수로 켰다 끄면 골라 둔 사양이 사라진다. 보내는 값만 정리한다.

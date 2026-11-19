# 관리자 UI 문구 정리 — 표시 버그 · 부연 설명 · 용어 통일 · 오류 문구

`apps/admin/src`의 화면 문구를 정리한다. 2026-11-19에 한글이 들어간 소스 줄 2,103줄(테스트·주석 제외)을
전부 읽고 고를 것을 골랐다. `docs/plans/admin-ui-cleanup.md` 6번 항목의 실행 목록이며, 그 플랜과
따로 실행해도 된다. 다만 같은 파일을 많이 건드리므로 두 플랜을 동시에 진행하지 말고 하나씩 끝낸다.

라인 번호는 2026-11-19 기준이다. 실행할 때는 라인이 아니라 **현재 문구로 grep**해 위치를 찾는다.

## 왜 필요한가

- 상태 코드가 한글 이름 없이 그대로 보이는 곳이 있다(아래 A). 문구 문제가 아니라 표시 버그다.
- 운영 방침은 "안내 한 줄·부연 설명은 넣지 말고 구조·라벨로 해결"이다. 화면 소개, 필터 모달의
  "…을 한 번에 적용합니다", 로딩 설명 같은 문장이 40곳 넘게 있다(B).
- 같은 대상을 화면마다 다르게 부른다. 수정 시각을 5가지, 이력을 5가지로 부른다(C).
  `packages/shared/docs/foundation/voice-and-tone.md`의 admin 규칙("기능·객체 명칭을 일관되게") 위반이다.
- 오류 문구 상당수가 "…하지 못했습니다"에서 끝난다. `writing.md`의 "원인 + 해결 행동" 규칙 위반이다(D).

실패 모드: 지우면 안 되는 문구까지 지우는 것. 돈·환불 제약과 실수하면 데이터가 틀어지는 규칙은
남긴다. 아래 "남기는 문구"는 지우지 않는다.

## 범위 밖

- 스토어 문구. 같은 상태 라벨 맵을 스토어가 쓰는지는 A-2에서 확인만 한다.
- 오류를 필드별로 나누는 등 폼 검증 구조 변경(예: `claims/detail.tsx:473`의 세 필드 오류 묶음).
- API가 돌려주는 오류 문구(`getErrorMessage`가 서버 메시지를 그대로 보일 때). 여기서는 앱 쪽 대체
  문구만 다룬다. 예외는 C-4의 "대사" 문구 하나다.

## 실행 조건

- 용어 결정은 2026-11-19에 끝났다(C-2~C-4). 언제든 실행해도 된다.
- A는 다른 항목과 무관하게 먼저 실행해도 된다.
- C-4는 api 코드를 건드린다. 결제 경로라 메시지 문자열 외의 로직은 바꾸지 않는다.

## 절차

### A. 표시 버그 — 먼저 실행

1. `pages/claims/detail.tsx:610` 클레임 정보의 "상태"가 `data.status` 원값을 그대로 보인다.
   목록·뱃지에서는 "처리 중"·"입고 대기"로 나오는 값이 여기서만 "처리중"·"발송대기"로 나온다.
   `formatStatus`를 거치게 하거나 `StatusBadge`로 바꾼다.
2. `shared/ui/status-badge.tsx`의 라벨 맵에 없는 원값이 그대로 노출된다. "답변대기"·"답변완료"(문의),
   "거부"(클레임)가 그렇다. 맵에 "답변 대기"·"답변 완료"를 추가하고, "거부"는 C-1 결정에 따른다.
   `pages/inquiries/list.tsx:27`의 필터 선택지 표시도 같은 라벨을 쓰게 한다.
3. `pages/inquiries/list.tsx:33-34` 문의 카테고리 "주문제작"·"샘플제작"은 API 원값이다. 표시할 때
   "주문 제작"·"샘플 제작"으로 매핑한다.
4. `pages/motifs/list.tsx:75-84`와 `motifs/detail.tsx:277` — 열 "메타데이터"에 scope·style 원값
   (whole·flat 등), 열 "소스"에 `source` 원값이 보인다. 열 이름을 "범위·스타일"과 "출처"로 바꾸고
   값은 한글로 매핑한다(템플릿/고객 업로드). 검색 라벨 `motifs/list.tsx:178` "ID·이름·소스 검색"도
   "ID·주제·출처 검색"으로 바꾼다.
5. `pages/dashboard.tsx:496·510` 연동 상태의 `{mode}`가 API 원값으로 보이는지 실제 응답으로 확인한다.
   원값이면 한글 라벨(예: 실제/테스트/미설정)로 매핑한다. 확인 전에는 고치지 않는다.
6. 이미지 정보에 MIME 원값(`image/png`)이 보인다 — `manual-orders/manual-order-form.tsx:165·466`,
   `manual-orders/detail.tsx:199`, `orders/detail.tsx:334·371`, `claims/detail.tsx:137`.
   확장자 대문자(PNG)로 표시한다.

### B. 부연 설명 삭제

규칙: 화면·카드가 무엇인지 되풀이하는 말, 필드 이름을 나열할 뿐인 말, 버튼이나 비활성 상태가 이미
전달하는 말은 지운다. "삭제"는 description prop이나 Text를 통째로 지운다는 뜻이다.

1. **페이지 제목 설명(화면 소개)** — 모두 삭제:
   `products/list.tsx:227`, `inquiries/list.tsx:152`, `quotes/list.tsx:141`, `reviews/list.tsx:187`,
   `motifs/list.tsx:137`, `motifs/detail.tsx:225`, `popups/list.tsx:162`, `manual-orders/list.tsx:144`,
   `manual-orders/new.tsx:21·27`, `design-examples/list.tsx:207`(시드 파일명 노출 포함),
   `generation/seamless-list.tsx:349`, `generation/seamless-detail.tsx:93·123·145`, `settings.tsx:328`,
   `products/new.tsx:62`, `login.tsx:78`.
2. **필터 모달의 "…을 한 번에 적용합니다"** — 모두 삭제:
   `inquiries/list.tsx:243`, `coupons/list.tsx:214`, `motifs/list.tsx:219`, `design-examples/list.tsx:250`,
   `incidents/list.tsx:255`, `products/list.tsx:398`, `quotes/list.tsx:222`, `generation/seamless-list.tsx:286`.
3. **로딩 중 설명("…불러오고 있습니다")** — 삭제. 로딩 표시는 `admin-ui-cleanup.md` 9번(Skeleton)에서
   바꾼다. 문구만 먼저 지울 때도 `RouteHeading` title은 남긴다(문서 제목·h1 포커스).
4. **카드·섹션 설명** — 삭제:
   `manual-orders/manual-order-form.tsx:614`, `pricing.tsx:263`, `settings.tsx:59·63·73`,
   `products/product-form.tsx:382·474`, `popups/form.tsx:127·147·371`,
   `generation/seamless-list.tsx:354·359`, `generation/seamless-detail.tsx:220·238`,
   `generation/shared.tsx:134`, `coupons/issued-history.tsx:216`, `coupons/operations.tsx:292·301`,
   `inquiries/detail.tsx:283`, `quotes/detail.tsx:351`, `dashboard.tsx:572`.
5. **빈 상태 설명** — 헤더에 생성 버튼이 있거나 다른 목록처럼 제목만으로 충분한 곳은 삭제:
   `coupons/list.tsx:165`, `motifs/list.tsx:168`, `design-examples/list.tsx:301`, `popups/list.tsx:204`,
   `claims/detail.tsx:197`.
6. **줄이기** — 지우지 않고 짧게:
   | 위치 | 지금 | 바꿀 문구 |
   |---|---|---|
   | `products/product-form.tsx:408` | 최대 20장까지 순서대로 표시됩니다. | 최대 20장 |
   | `manual-orders/manual-order-form.tsx:1182` | 시안·참고 사진을 N장까지 | 최대 N장 |
   | `products/product-form.tsx:506` | 옵션이 없습니다. 상품 단위 재고를 사용합니다. | 옵션 없음 |
   | `popups/form.tsx:179` | …있으면 확인 버튼이 「자세히 보기」로 바뀝니다. | /로 시작하는 스토어 경로 또는 https:// 주소 |
   | `popups/form.tsx:420` | 팝업을 등록했습니다. 활성 스위치를 켜면 스토어에 노출됩니다. | 팝업을 등록했습니다. |
   | `dashboard.tsx:290` | 조회 기간과 무관한 최신 5건 | 최신 5건 |
   | `generation/seamless-list.tsx:381` | 화면이 보일 때 새 로그를 30초마다 갱신합니다. | 30초마다 자동 갱신 |
   | `coupons/issued-history.tsx:278-279` | 현재 페이지에서 활성 발급 건 N건을 선택했습니다. | N건 선택 |
   | `coupons/operations.tsx:295` | 조회 전용 권한입니다. 고객군 일괄 발급은 관리자만 할 수 있습니다. | 관리자만 발급할 수 있습니다. |
   | `incidents/detail.tsx:163` | …관리자만 할 수 있습니다. 매니저는 조회만 가능합니다. | 관리자만 처리할 수 있습니다. |
   | `motifs/detail.tsx:93` | 매니저는 메타데이터를 조회만 할 수 있습니다. | 조회 전용 권한입니다. |
   | `protected-route.tsx:74` | 이 화면을 볼 권한이 없습니다. 필요하면 관리자에게 요청해 주세요. | 필요하면 관리자에게 요청해 주세요. (제목과 중복 제거) |
   | `design-examples/list.tsx:312` | …시드를 다시 실행하면 돌아옵니다. | 스토어 템플릿 목록에서 바로 사라집니다. |
   | `customers/detail.tsx:290` | 동의했지만 꺼 둠 | 동의·수신 꺼짐 |
   | `generation/seamless-detail.tsx:84` | …요청 ID로 워커 로그를 확인해 주세요. | …요청 ID로 서버 로그를 확인해 주세요. |
7. **플레이스홀더 "2자 이상 입력"** — 규칙이지 예시가 아니다. 13곳(목록 검색창 전부, `grep -rn "2자 이상 입력"`)에서
   지운다. 2자 미만은 `SubmittedMemorySearch`가 이미 오류로 알린다. 오류가 안 뜨는 화면이 있으면 그 화면만
   필드 오류를 붙인다. `manual-orders/list.tsx:199-200`은 라벨을 "이름·휴대폰 검색"으로 바꾸고
   플레이스홀더를 지운다.
8. **규칙을 담은 플레이스홀더** — 필드 description으로 옮긴다: `products/product-form.tsx:317`
   "비워 두면 자동 생성", `coupons/coupon-form.tsx:261` "비워 두면 제한 없음".

**남기는 문구** — 지우지 않는다: `coupons/coupon-form.tsx:183` "저장된 조건은 이후 발급 건부터 적용됩니다."
(돈), `popups/form.tsx:435`의 "등록 직후는 비활성" 규칙은 버튼 이름 "비활성으로 등록"(`:443`)이 이미
전달하므로 문장은 지우되 버튼 이름은 남긴다. `orders/detail.tsx:848` "상품·옵션·쿠폰은 주문 당시
정보로 표시합니다"는 금액 판단에 쓰이므로 "주문 당시 기준"으로 줄여 남긴다.
`manual-orders/manual-order-form.tsx:729-730`의 선택 제약(돌려묶기·딤플은 자동에서만)은 해당 선택지가
비활성일 때 이유가 보이는지 확인한 뒤, 보이면 지우고 안 보이면 남긴다.

### C. 용어 통일

1. **바로 통일** — 왼쪽 표현들을 오른쪽으로 바꾼다.
   | 대상 | 지금 쓰는 표현 | 통일 |
   |---|---|---|
   | 수정 시점 | 최근 수정 / 수정 시각 / 마지막 수정 / 마지막 저장 / 최근 변경 | 상세 화면 머리 줄은 "마지막 수정", 표·목록 열은 "수정 시각". 설정·가격의 값 변경은 "마지막 변경" |
   | 이력 | 상태 변경 이력 / 활동 이력 / 처리 이력 / 처리 타임라인 / 처리 기록 | 탭 "활동 이력", 카드 "처리 이력" (`claims/detail.tsx:227`의 로딩 카드 제목도 실제 카드와 맞춘다) |
   | 변경 이유 | 변경 사유 / 상태 변경 근거 / 변경 근거 | 변경 사유 |
   | 관리자 메모 | 관리자 메모 / 내부 메모(`quotes/detail.tsx:524`) | 관리자 메모 |
   | 상품 설명 | 상품 설명 / 상품 정보 문구(`products/detail.tsx:228·231`) | 상품 설명 |
   | 재고 무제한 | 무제한 / 재고 무제한 / 재고 수량 제한 없음 | 재고 무제한 |
   | 주문 구성 단위 | 품목 / 항목(`claims/detail.tsx:634·663·665`) | 품목, 단위는 "N개" |
   | 넥타이 | 넥타이 / 타이(`manual-order-form.tsx:302`, `orders/detail.tsx:166`) | 넥타이 |
   | 업체 발송 송장 | 회사 송장(`orders/detail.tsx:998`) / 업체 배송(`claims/detail.tsx:403`) | 발송 송장 (수선 입고 송장과 짝) |
   | 목록 복귀·이동 버튼 | 목록으로 / 상세로 / 상세로 돌아가기 / 디자인 렌더 로그 목록으로 돌아가기 | "목록으로"·"상세로". `admin-ui-cleanup.md` 5번의 머리 줄 링크로 바뀌면 그쪽 형식을 따른다 |
   | 편집 중단 | 수정 취소 / 입력 취소 | 수정 취소 |
   | 쿠폰 본체 | 쿠폰 정의 / 쿠폰 정보 / 쿠폰 요약 | 탭·카드 "쿠폰 정보", 요약 카드 "요약". 스낵바 "쿠폰 정의를 저장했습니다"(`coupons/edit.tsx:91`)는 "쿠폰을 저장했습니다" |
   | 쿠폰 필드 | 최대 할인 / 최대 할인액, 만료일 / 만료 시각, 표시 이름 / 고객 표시 이름, 등록 시각 / 등록일 | 최대 할인액, 만료일(발급 건은 "만료 일시"), 고객 표시 이름, 등록일 |
   | 주문 유형 custom | 주문제작 / 주문 제작 | 주문 제작 (`pricing.tsx:41·72-74` 포함) |
   | 주문 유형 sample | 샘플 / 샘플 제작 | 샘플 제작 |
   | 무늬 범위 | 전체 모티프 / 부분 모티프 / 모티프 범위 / 모두 | 화면 이름 "무늬·로고"에 맞춰 "통무늬"·"부분 무늬", 필터 라벨 "범위", 전체 선택지는 다른 필터처럼 "전체" |
   | 이미지 형식 | JPG, PNG, WebP / JPG·PNG·WebP | JPG·PNG·WebP |
   | 크기 없음 | 크기 미상 / 크기 정보 없음 | 크기 정보 없음 |
   | 재시도 안내 | 잠시 후 / 잠시 뒤 | 잠시 후 |
   | 개수 단위(페이지네이션) | 건 / 개 (`widgets/admin-table/pagination.tsx:66·75·81`) | 건 |
   | 설정 값 라벨 | 설정 값 / 설정 수량(`settings.tsx:76`) | 설정 값 |
   | 견적 배송지 | 거래 시점 배송지(`quotes/detail.tsx:454`) | 배송지 |
   | 담당자 없음 | 담당자 미상(`inquiries/detail.tsx:226`) | 담당자 확인 불가 |
   | 미리보기 alt | 디자인 안전 미리보기 / 모티프 안전 미리보기 | 디자인 미리보기 / {주제} 미리보기 |
   | 자동 갱신 상태 | 자동 갱신 일시정지됨 / 자동 갱신 켜짐 | 자동 갱신 꺼짐 / 자동 갱신 켜짐 |

2. **운영자가 정한 용어** (2026-11-19 확정)
   | 대상 | 지금 | 바꿀 표현 |
   |---|---|---|
   | 거절 상태 | 거부(클레임 원값) / 거절(rejected 라벨) | 거절. A-2의 라벨 맵, `claims/list.tsx:38` 필터 선택지 포함 |
   | 일반 판매 주문 유형 | 일반(`shared/lib/format.ts:65`) / 일반 주문 / 상품(`reviews/list.tsx:48`) | 일반 주문. 관리자 화면에서는 "상품"이 상품 메뉴와 헷갈린다. 스토어는 그대로 둔다 |
   | 수기 레코드 이름 | 수기 주문 / 작업지시서 | 화면·레코드는 "수기 주문". "작업지시서"는 이미지 저장 기능("작업지시서 이미지 저장")에만 쓴다. `manual-orders/list.tsx:144`, `manual-order-form.tsx:614·1249`, `detail.tsx:225·361·391` 등 |
   | 폴드 표기 | 7폴드 / 쓰리폴드 | 3폴드·7폴드. `pricing.tsx:61`, `products/product-attributes.ts:2`, 스토어에 같은 표기가 있으면 함께 확인한다(상품 속성값이면 표시 라벨만 바꾸고 저장 값은 그대로) |
   | 생성 로그 화면 이름 | 디자인 렌더 로그 / 생성 | 디자인 생성 로그. 메뉴(`shared/config/navigation.ts:57`)·페이지 제목·"목록으로" 버튼 모두. "렌더"는 단계별 소요 시간 라벨에만 남긴다 |

3. **수기 주문의 "확인" 체크 → "발송 완료"**
   - 현재 정의: 수기 주문에는 체크가 세 개 있다 — 접수(`is_received`), 결제(`is_paid`), 확인(`is_confirmed`)
     (`manual-orders/list.tsx:34-38`, `detail.tsx:316`). 코드(`db/src/db/models/commerce.py:633` 주석 "확인")와
     명세(`docs/api-spec/domains.md:86`) 어디에도 무엇을 확인하는지 적혀 있지 않다.
   - 운영자 설명(2026-11-19): 마지막 단계의 확인이며, 제작·수선이 끝나고 택배까지 보냈다는 뜻이다.
   - 바꿀 문구: 뱃지 "확인" → "발송 완료", 버튼 "확인 처리"/"확인 취소" → "발송 완료로 표시"/"발송 완료 해제",
     스낵바 "확인 상태를 변경했습니다" → "발송 완료 상태를 바꿨습니다", 폼 체크박스 라벨도 같게.
   - 화면 라벨만 바꾼다. 컬럼 이름 `is_confirmed`와 API는 그대로 둔다(이름 변경은 마이그레이션·codegen이
     필요해 이득이 작다). 대신 `commerce.py:633` 주석과 `domains.md:86`에 "발송 완료(제작·수선 후 택배 발송까지 끝남)"
     뜻을 적어 다음 사람이 다시 묻지 않게 한다.

4. **"대사" → 쉬운 말로**
   - 배경: 메뉴 "결제 이상"(`/incidents`)은 토스 결제 기록과 우리 주문 상태가 서로 안 맞을 때 쌓이는 목록이다.
     예: 결제는 됐는데 주문이 "결제 중"에 멈춤, 토스 대시보드에서 직접 부분 취소함. 시스템이 자동으로 못 맞춘 건만
     남는다(`docs/api-spec/money.md` §9 자동 대사). "대사(reconciliation)"는 두 기록을 대조해 맞춘다는 회계 용어로,
     운영자가 쓰지 않는 말이다.
   - 바꿀 문구:
     | 위치 | 지금 | 바꿀 문구 |
     |---|---|---|
     | `apps/api/src/api/domains/admin/payment_incidents.py:163·180` (액션 라벨, 화면 버튼으로 쓰임) | Toss 상태 대사 | 토스 결제 상태 반영 |
     | `incidents/detail.tsx:92` 카드 제목 | 대사 근거 | 실제 카드 제목에 맞춘다(C-1 이력 행 참고) |
     | `incidents/detail.tsx:131` 스낵바 | 결제 상태를 대사했습니다. | 토스 결제 상태를 반영했습니다. |
     | `incidents/detail.tsx:253` | 대사·해결은 관리자만… | B-6대로 "관리자만 처리할 수 있습니다." |
     | `apps/api/src/api/domains/payments/service.py:172·184·195·207·252·281·294` 오류 메시지 | …대사가 필요합니다 | …결제 상태 확인이 필요합니다 (예: "결제 승인 결과를 확인할 수 없어 관리자 확인이 필요합니다") |
   - `service.py`의 오류 메시지는 결제 승인 응답이라 **스토어 고객에게 그대로 보일 수 있다**. 스토어
     (`apps/store/src/features/checkout/model/use-payment-confirm.ts`)가 서버 메시지를 그대로 띄우는지 확인하고,
     띄운다면 고객용 문구는 스토어 쪽 코드별 매핑으로 처리한다(이 경우 범위 밖의 스토어 문구를 이 항목에서만 예외로 다룬다).
   - api 문자열만 바뀌고 스키마는 그대로라 codegen은 필요 없다. api 테스트가 라벨·메시지를 문자열로 비교하면
     함께 고친다(`uv run pytest apps/api/tests -k "incident or payment"`로 해당 테스트만).
   - 코드·명세 안의 "대사"(주석, `money.md`, `operation_journal.py` 독스트링)는 개발 용어라 그대로 둔다.

   수선 분류명 "자동수선·폭수선·복원수선"은 고유 분류명으로 보고 붙여 쓴 채 둔다.

### D. 오류 문구

1. **대체 오류 문구에 해결 행동 붙이기** — "…하지 못했습니다."로 끝나는 앱 쪽 대체 문구 끝에
   "다시 시도해 주세요."를 붙인다. 대상: `design-examples/list.tsx:103·113`, `reviews/list.tsx:91`,
   `manual-orders/detail.tsx:259·284·357`, `orders/detail.tsx:737`, `manual-orders/manual-order-form.tsx:471`,
   `products/upload.ts:45`, `products/product-form.tsx:203`, `popups/upload.ts:44`, `popups/form.tsx:97·427·469`,
   `popups/list.tsx:67·77`. 실행 전에 `grep -rn "하지 못했습니다\.\"" apps/admin/src`로 빠진 곳을 찾는다.
   이미 재시도 버튼이 바로 옆에 있는 `ContentPlaceholder` 오류는 제외한다.
2. **"주소를 확인하거나 다시 시도해 주세요"** → "링크를 확인하거나 다시 시도해 주세요." 배송 주소와
   헷갈린다. `customers/detail.tsx:217`, `incidents/detail.tsx:167`, `orders/detail.tsx:530`,
   `claims/detail.tsx:326`, `motifs/detail.tsx:229`("ID를 확인하거나…"도 같이), `popups/form.tsx:488`.
3. **서명 URL 사정을 설명하는 이미지 오류** — `orders/detail.tsx:340·377`, `claims/detail.tsx:143`의
   "만료되었거나 이 주문에 속하지 않은 이미지입니다" 류를 "이미지를 불러오지 못했습니다. 새로고침해 주세요."로
   바꾼다(`manual-orders/detail.tsx:205`와 같은 문구).
4. **폼 검증 문구를 행동형으로**:
   | 위치 | 지금 | 바꿀 문구 |
   |---|---|---|
   | `popups/popup-form-model.ts:126` | 종료일은 시작일보다 앞설 수 없습니다. | 종료일을 시작일 이후로 입력해 주세요. |
   | `popups/popup-form-model.ts:130` | 링크는 /로 시작하는 내부 경로 또는 https:// 주소만 가능합니다. | 링크를 /로 시작하는 경로나 https:// 주소로 입력해 주세요. |
   | `popups/popup-form-model.ts:169` | 이벤트 팝업은 링크가 필요합니다. | 링크를 입력해 주세요. |
   | `products/product-form-model.ts:177` | 이미 있는 옵션 이름입니다. | 이미 있는 옵션 이름입니다. 다른 이름을 입력해 주세요. |
   | `manual-orders/manual-order-form.tsx:321` | 올바른 휴대폰 번호를 입력해 주세요. | 휴대폰 번호 10~11자리를 입력해 주세요. |
   | `dashboard.tsx:485` | {연동} 관련 작업이 실패합니다. | {연동} 관련 작업이 실패합니다. 개발팀에 알려 주세요. |
5. **파괴적 다이얼로그 버튼에 대상 붙이기** — "삭제" → "템플릿 삭제"(`design-examples/list.tsx:314`),
   "후기 삭제"(`reviews/list.tsx:363`), "팝업 삭제"(`popups/list.tsx:216`).

### E. 맞춤법

- `shared/ui/custom-option-items.tsx:90` "아니오" → "아니요".
- `shared/lib/format.ts:87` "문 앞에 놔주세요." → "문 앞에 놔 주세요." 스토어가 같은 원문을 쓰면 스토어도 같이 바꾼다
  (배송 요청 문구는 고객이 고른 값이라 양쪽이 같아야 한다).
- `incidents/list.tsx:94` "기대 / 확인 금액" → "기대·확인 금액".
- `manual-orders/manual-order-form.tsx:951`, `manual-orders/detail.tsx:107`, `orders/detail.tsx:204`의 "[폭] 폭" →
  "[폭] 목표 폭".

## 검증

- `pnpm lint`, `pnpm typecheck`, `pnpm --filter admin test`. 테스트가 바뀐 문구로 요소를 찾으면 테스트도
  같은 문구로 고친다. 문구를 지운 곳의 테스트는 해당 assertion을 지운다.
- A는 화면으로 확인한다: 클레임 상세의 상태 칸, 문의 목록 상태 필터·뱃지, 무늬·로고 목록의 범위·출처 열.
- 끝난 뒤 `grep -rn "한 번에 적용합니다\|불러오고 있습니다\|2자 이상 입력\|주문제작\|쓰리폴드\|대사\|렌더 로그" apps/admin/src`가
  테스트·주석 외에는 비어 있어야 한다. `grep -rn "대사가 필요\|상태 대사" apps/api/src`도 비어 있어야 한다.
- 수기 주문 목록·상세에서 체크 뱃지가 "접수·결제·발송 완료"로 보이는지 화면으로 확인한다.
- `docs/reviews/`에 남긴 문구·지운 문구 개수를 기록한다.

## 기각한 대안

- **"(KST)" 표기 삭제** — 날짜 경계가 한국 시간 기준이라는 건 집계 숫자를 읽는 데 필요하다. 필터 라벨에만
  남기고, 같은 말을 반복하는 `dashboard.tsx:572`만 지운다.
- **로그아웃 실패 문구(`admin-header.tsx:24`) 단순화** — 서버 로그아웃 실패는 다른 기기 세션이 남는다는
  보안 정보라 남긴다.
- **견적 상태 변경 확인 문구(`quotes/detail.tsx:583`)를 목록으로 재구성** — 문구가 아니라 다이얼로그 구조
  변경이라 이 플랜에서 뺀다. 읽기 어렵다는 말이 나오면 재론한다.
- **수선 분류명 띄어쓰기("자동 수선")** — 고유 분류명이고 운영자가 종이 작업지시서에서 쓰는 이름이라
  그대로 둔다.

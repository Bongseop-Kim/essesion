# 관리자 UI 정리 — 모바일 레이아웃 · 버튼 배치 · 안내 문구 · 로딩 상태

관리자(`apps/admin`)의 UI를 한 번에 정리한다. 중심은 휴대폰(390px 기준) 사용성이다. 하단 safe area,
제목과 카드 제목의 이중 구조, 상세 화면의 카드 중첩, 제목 줄에 몰린 버튼을 고친다. 같은 작업에서
PC에도 적용되는 정리 세 가지를 함께 한다: 탭 넘침, 안내 문구, 로딩 상태. 항목은 위에서부터 실행하고,
각 항목은 따로 커밋·검증할 수 있다.

## 왜 필요한가

- **safe area** — `apps/admin/index.html:5` viewport 메타에 `viewport-fit=cover`가 없다. 스토어는
  2026-11-18에 같은 문제를 고쳤다(`docs/reviews/store-safe-area-bottom-bar-2026-11-18.md`). 관리자
  하단 고정 요소인 `apps/admin/src/shared/ui/edit-mode-shell.tsx:19-20`의 저장 바(`bottom="x3"`)는
  inset을 더하지 않는다. 그래서 cover를 켜는 것만으로는 부족하고, 저장 바 식도 함께 고쳐야 한다.
  이 바를 쓰는 화면은 상품·쿠폰·수기 주문 폼, 가격, 설정이다.
- **탭 넘침(추정)** — shared `TabList`(`packages/shared/src/components/tabs.tsx:112-117`)는 가로
  스크롤 처리 없이 `flex`만 쓴다. 견적 상세(`apps/admin/src/pages/quotes/detail.tsx:411-415`)는 탭이
  5개라 트리거 폭 합이 약 530px로 추정된다. 390px 화면의 콘텐츠 폭(358px)을 넘으므로 글자가
  눌리거나 줄바꿈될 것으로 본다. 실행 전에 390px에서 실제로 확인한다. 주문(4개)·클레임·가격 상세도
  같은 컴포넌트를 쓴다.
- **이중 제목** — 목록 12개 화면이 `RouteHeading`("주문 관리") 바로 아래에
  `PaginatedAdminTableCard`(`apps/admin/src/widgets/admin-table/paginated-admin-table-card.tsx:72`)를
  둔다. 이 카드도 자기 제목("주문 목록")을 단다. 제목이 같은 말을 두 번 하고, 모바일에서는 카드
  테두리와 안쪽 여백(`x4`)이 페이지 거터(`x4`) 안쪽에 겹쳐 표 폭이 32px 줄어든다.
- **카드 중첩** — `AdminCard`(`apps/admin/src/shared/ui/admin-card.tsx:22-26`)는 26개 파일에서 226번
  쓴다. 상세 화면 하나에 3~11개다(견적 11, 클레임 9, 주문 8). 모바일에서는 카드마다 테두리와 여백이
  반복돼 세로 길이만 늘고, 회색 바탕(`bg.layer-basement`) 위 흰 카드 사이 간격 때문에 한 화면에
  보이는 정보가 적다.
- **버튼** — 상세 화면은 제목 줄 오른쪽 `HStack wrap`에 상태 뱃지, 상태 변경 액션 N개,
  보조 작업, "목록으로"를 한꺼번에 넣는다. 주문 상세(`apps/admin/src/pages/orders/detail.tsx:715-745`)는
  모바일에서 이 줄이 3~4줄로 접혀 본문을 밀어낸다. 같은 줄에 `criticalSolid`와 `neutralOutline`을
  섞고 4개 넘게 나열해 `packages/shared/AGENTS.md` ActionButton 행의 "한 줄에 4개+ 나열,
  Solid+Outline 혼용" 금지에 걸린다. "목록으로"는 17군데에서 손으로 넣고, 컴포넌트
  (`BackToListButton`)를 쓰는 곳과 직접 `ActionButton`을 쓰는 곳(`products/detail.tsx:151`)이 섞여 있다.
- **안내 문구** — 페이지 제목 아래 설명 대부분이 화면이 무엇인지 다시 말한다(예:
  `products/list.tsx:227` "상품과 옵션의 가격·재고를 관리합니다.", `inquiries/list.tsx:152`
  "고객 문의에 답변합니다."). 운영 방침은 "안내 한 줄·부연 설명을 넣지 말고 구조·라벨로 해결"이다.
  모바일에서는 이 줄들이 첫 화면을 차지한다. 화면 코드의 `description="…"` 고정 문자열은 104개다.
- **로딩 상태** — 상세·편집 11개 화면이 로딩 중에 제목 설명이나 `ContentPlaceholder`로
  "…불러오고 있습니다" 문구를 띄운다(예: `orders/detail.tsx:519-520`, `products/detail.tsx:76-78`).
  shared 규칙상 모양을 아는 초기 로딩은 `Skeleton`이고, `ContentPlaceholder`는 빈 상태·에러 전용이다.
  같은 화면 안에서도 섞여 있다(주문 상세는 본문은 문구, 일부 영역은 Skeleton).
- **저장 바(모바일)** — `EditModeShell`은 왼쪽에 "변경 없음"/"저장하지 않은 변경이 있습니다", 오른쪽에
  버튼을 둔다(`product-form.tsx:631` 등). 390px에서는 두 줄로 접혀 화면 아래를 더 가린다(추정).

실패 모드: "모바일만 바꾼다"는 항목(4·5·7·8)에서 공통 컴포넌트를 고치다 PC 화면까지 바꾸는 것.
해당 항목은 md 이상의 렌더 결과가 바뀌지 않았는지 확인한 뒤에만 끝난 것으로 본다.

## 범위 밖

- 필터 UI(`CompactFilterToolbar`, 모바일 필터 모달)와 표의 모바일 행(`compactRow`). 표가 있는 20개
  화면이 이미 `compactRow`로 모바일 목록을 그린다.
- 사이드바·헤더 메뉴 구조, 정보 구조(어느 페이지에 무엇이 있는지), 대시보드 차트 구성.
- 가로 모드 좌우 safe area. 스토어 리뷰의 후속 항목과 같은 조건(노치에 가릴 때만)으로 미룬다.
- 결제·환불 제약 같은 필수 고지 `Callout`. 6번 문구 정리에서도 남긴다.

## 실행 조건

- 언제든 실행해도 된다. 1·2번은 다른 항목과 무관하게 먼저 해도 된다.
- 4번 이후는 화면 모양이 바뀌므로, 실행 전에 운영자에게 390px 시안 한 장(주문 목록 + 주문 상세)을
  보여주고 방향을 확인받는다. 시안은 코드로 만든다(로컬 스택을 묻지 않고 켜지 않는다).
- 실행 중 shared 컴포넌트에 없는 것(예: 아이콘 전용 버튼, 페이지 헤더)이 필요하면 앱에서 임의 값으로
  우회하지 말고 멈추고 shared 추가를 제안한다(`packages/shared/AGENTS.md` 규칙 0).

## 절차

효과 ÷ 난이도 순이다.

1. **safe area** — 효과 큼, 난이도 낮음
   - `apps/admin/index.html:5` viewport 메타에 `viewport-fit=cover`를 더한다. 스토어와 같은 값이다.
   - `apps/admin/src/shared/ui/edit-mode-shell.tsx:20` `bottom="x3"`을
     `calc(var(--spacing-x3) + env(safe-area-inset-bottom, 0px))`로 바꾼다. 스토어
     `apps/store/src/shared/ui/content-layout.tsx:146`과 같은 식이다.
   - `apps/admin/src/widgets/admin-shell/admin-shell.tsx`의 `LayoutContent` 아래쪽 여백에도 inset을
     더해, 저장 바가 없는 화면의 마지막 콘텐츠가 홈 인디케이터에 닿지 않게 한다.
   - 모바일 메뉴(shared `Header` → `SidePanel`) 하단의 로그아웃 버튼이 홈 인디케이터에 걸치는지
     실기기로 본다. 걸치면 `packages/shared/src/components/side-panel.tsx` 하단 여백에 inset을 더한다.
     shared 변경이므로 스토어 메뉴도 같이 확인한다.

2. **탭 넘침** — 효과 중간(실제 깨짐이면 큼), 난이도 낮음
   - 390px에서 견적 상세 탭을 먼저 본다. 넘치지 않으면 이 항목은 건너뛰고 건너뛰었다고 기록한다.
   - 넘치면 `packages/shared/src/components/tabs.tsx:112-117` `TabList`의 `role="tablist"` 요소를
     `ScrollFog`로 감싸 가로 스크롤하게 하고, 트리거에 `shrink-0`·`whitespace-nowrap`을 준다.
     shared 규칙 10이 가로 스크롤은 `ScrollFog`만 쓰라고 정한다.
   - 선택된 탭이 화면 밖이면 보이게 스크롤한다(`scrollIntoView({ inline: "nearest" })`). URL로 탭을
     복원하는 화면(주문 상세 `?tab=`)에서 필요하다.
   - shared 변경이므로 스토어의 탭 화면도 같이 본다.

3. **목록 화면의 카드 제목 제거** — 효과 중간, 난이도 낮음
   - `paginated-admin-table-card.tsx`의 `title`을 받지 않는다(12개 호출부에서 `title` 삭제). 카드
     머리 줄에는 건수(`description`)를 왼쪽에, "새로고침"을 오른쪽에 둔다. 페이지 제목은
     `RouteHeading` 하나만 남는다.
   - 한 페이지에 표가 둘 이상이라 카드 제목이 필요한 화면이 있으면 그 화면만 `AdminCard`로 감싸
     제목을 준다. 실행 전에 12곳을 확인해 목록을 이 항목에 적는다.
   - 표 `label`(접근성 이름)은 그대로 둔다.

4. **AdminCard 모바일 평탄화** — 효과 큼, 난이도 낮음(파일 1개), 영향 범위 넓음
   - `apps/admin/src/shared/ui/admin-card.tsx:22-26`에서 md 미만일 때 카드 바탕·테두리·라운드·안쪽
     여백을 없앤다. 제목(`title3`)과 action 줄은 그대로 둔다. md 이상은 지금과 같다.
   - 같은 항목에서 모바일 셸 바탕을 `bg.layer-default`로 바꾼다(`admin-shell.tsx`의 `Layout bg`를
     반응형 값으로). 회색 바탕에 카드만 없애면 내용이 회색 위에 뜨기 때문이다.
   - 섹션 사이는 페이지가 이미 주는 `gap`(x5~x6)으로 구분하고, 그걸로 부족하면 섹션 위에 `Divider`
     하나를 둔다. 판단은 시안을 보고 한다.
   - 근거: 사용처 226곳을 하나씩 고치지 않고 한 곳에서 바꾼다. 상세 화면의 "카드 안 카드" 문제도
     이 항목으로 함께 사라진다.
   - 주의: 주문 상세의 작업지시서 PNG(`orders/detail.tsx` `captureRef`)는 카드 모양을 캡처한다.
     모바일에서 저장하면 카드 없는 이미지가 나온다. PC에서만 쓰는 기능인지 운영자에게 확인하고,
     모바일에서도 쓴다면 캡처 영역만 카드 모양을 유지하게 한다.

5. **페이지 머리 줄 규칙과 공통 컴포넌트** — 효과 큼, 난이도 중간
   - `apps/admin/src/shared/ui/route-heading.tsx`를 확장하거나 같은 폴더에 `PageHeader`를 만든다.
     받는 값은 `title`, `description`, `backTo`(목록 경로), `badges`, `actions`다. 지금 각 페이지가
     `HStack justify="space-between" wrap`으로 손수 조립하는 머리 줄을 이걸로 바꾼다.
   - "목록으로"는 버튼 줄에서 빼고 제목 위 작은 링크("‹ 주문 관리")로 옮긴다. 모든 화면 크기에서
     같은 자리다. `back-to-list-button.tsx`는 이 컴포넌트에 흡수하고 17곳을 바꾼다.
   - 상태 뱃지는 버튼 줄이 아니라 제목 옆(또는 description 줄)에 둔다.
   - `actions` 규칙: 눈에 보이는 버튼은 최대 2개(핵심 1개 + 보조 1개)다. 나머지는 shared `Menu`의
     "더보기"로 넣는다. 내보내기·새로고침 같은 상시 보조 작업은 항상 메뉴로 간다.
     shared 색인상 `Menu`는 모바일에서도 같은 컴포넌트를 쓰도록 되어 있다.
   - 이 규칙을 `apps/admin/AGENTS.md`의 "Admin 의미 계약"에 한 단락으로 추가해 다음 화면도 따르게 한다.

6. **문구 정리** — 효과 중간, 난이도 낮음, 양이 많음
   - 별도 플랜 `docs/plans/admin-ui-copy.md`로 실행한다. 2026-11-19에 문구 전체(2,103줄)를 읽고 만든
     목록으로, 상태 원값 노출 같은 표시 버그·부연 설명 삭제·용어 통일·오류 문구를 담고 있다.
   - 그 플랜의 A(표시 버그)는 이 플랜과 무관하게 먼저 실행해도 된다. 나머지는 3·5번과 같은 파일을
     건드리므로 이 플랜의 5번까지 끝낸 뒤 실행한다.

7. **상세 화면 버튼 정리 (주문·클레임·견적부터)** — 효과 큼, 난이도 중간. 5번 이후 실행
   - 주문 상세 `orders/detail.tsx:615-626` 상태 변경 액션(`admin_actions`)은 2개 이하면 버튼으로,
     3개 이상이면 "상태 변경" 메뉴 하나로 묶는다. 막힌 액션 사유는 지금처럼 제목 아래 caption으로
     둔다(`:756-768`). 메뉴 항목의 `title` 툴팁은 모바일에서 보이지 않기 때문이다.
   - 되돌릴 수 없는 액션(`destructive`)은 메뉴 안에서도 critical 색을 쓰고, 지금처럼 고른 뒤
     검토 단계를 거친다. 버튼을 메뉴로 옮겨도 확인 흐름은 바꾸지 않는다.
   - "작업지시서 이미지 저장"은 "더보기" 메뉴로 옮긴다.
   - 클레임(`claims/detail.tsx`), 견적(`quotes/detail.tsx`), 상품(`products/detail.tsx:144-160`) 순으로
     같은 규칙을 적용한다. 나머지 상세 화면은 5번 컴포넌트로 바꾸면서 함께 맞춘다.

8. **저장 바 모바일 압축** — 효과 중간, 난이도 낮음
   - `edit-mode-shell.tsx`에서 md 미만이면 상태 문구를 화면에서 숨기고(스크린리더용으로는 남김)
     버튼만 한 줄로 둔다. 저장 버튼은 변경이 없으면 이미 비활성이라 상태가 버튼으로 드러난다.
   - md 이상은 그대로다. 가격·설정 화면의 상태 문구가 변경 건수처럼 정보를 담고 있으면
     (`pricing.tsx:324`, `settings.tsx:340`) 모바일에서도 그 화면만 남긴다.

9. **로딩 상태 통일** — 효과 작음~중간, 난이도 중간
   - "…불러오고 있습니다"를 쓰는 11개 화면(`settings`, `pricing`, `customers/detail`, `products/detail`,
     `products/edit`, `motifs/detail`, `inquiries/detail`, `quotes/detail`, `manual-orders/detail`,
     `manual-orders/edit`, `orders/detail`)의 초기 로딩을 `Skeleton`으로 바꾼다. 제목 자리는 제목
     크기의 Skeleton, 본문은 섹션 모양의 Skeleton이다. `RouteHeading`에 로딩 문구를 description으로
     넣는 패턴은 없앤다.
   - 문서 제목(`document.title`)과 h1 포커스는 로딩 중에도 유지해야 하므로 `RouteHeading`의 title은
     고정 문구("주문 상세")로 둔다. 시각적으로만 Skeleton을 보인다.
   - 이미 Skeleton을 쓰는 화면(쿠폰·클레임·사고 상세 등)의 모양을 기준으로 맞춘다.

10. **목록 화면의 검색 버튼** — 효과 작음, 난이도 낮음
    - `products/list.tsx:296-318`처럼 검색창 옆에 "검색"과 "검색 초기화"를 따로 두는 화면이 있다.
      목록 13곳이 이미 `AppliedFilterBar`를 쓰므로, 적용된 검색어가 그 바에 칩으로 나오고 거기서
      지울 수 있으면 "검색 초기화" 버튼은 지운다. 바에 검색어가 안 나오는 화면은 그대로 둔다.
    - "검색" 버튼은 Enter 제출이 되므로 남겨도 되지만, 모바일에서 한 줄을 차지하면 TextField suffix로
      옮기는 것을 검토한다. 아이콘 전용 버튼이 shared에 없으면 멈추고 제안한다.

## 검증

- `pnpm lint`(하네스 검사 포함), `pnpm typecheck`, `pnpm --filter admin test`. 2번은
  `pnpm --filter @essesion/shared test`도 돌린다.
  3·5·6·7·9번은 `route-heading.test.tsx`, `paginated-admin-table-card.test.tsx`와 각 화면 테스트가
  제목·설명·버튼 이름·로딩 문구로 요소를 찾으므로 깨진 테스트를 함께 고친다. 로딩 문구로 찾던 테스트는
  Skeleton이나 `aria-busy`로 찾게 바꾼다.
- `pnpm architecture:check` — 공통 컴포넌트를 추가·이동했으면 실행한다.
- 브라우저 실측: `apps/admin/AGENTS.md` 확인 범위대로 390·767·768·1024·1440px에서 주문 목록, 주문
  상세, 견적 상세(탭), 상품 폼(저장 바), 설정을 본다. 4·8번은 768px 이상이 바꾸기 전과 같아야 한다.
- 아이폰 실기기(Safari·Chrome)에서 상품 수정 화면의 저장 바와 모바일 메뉴 로그아웃 버튼이 홈
  인디케이터 위에 있는지 본다. 스토어 때처럼 운영자 확인으로 갈음할 수 있다.
- 키보드: "더보기" 메뉴를 열고 닫은 뒤 focus가 트리거로 돌아오는지, 머리 줄의 목록 링크가 탭 순서상
  제목보다 앞에 오는지, 가로 스크롤되는 탭에서 화살표 키로 이동할 때 선택 탭이 화면 안에 들어오는지
  확인한다.

## 되돌리는 법

- 1번: 메타에서 `viewport-fit=cover`만 지우면 inset이 0이 되어 이전과 같아진다.
- 4번: `admin-card.tsx`의 반응형 값을 단일 값으로 돌리고 셸 바탕을 되돌린다. 신호는 운영자가
  "섹션 경계가 안 보인다"고 하는 것이다. 이때는 되돌리기 전에 `Divider`를 먼저 시도한다.
- 6번: 운영자가 "이 화면에서 뭘 해야 할지 모르겠다"고 하면 그 화면만 필드 description 수준으로 되살린다.
  페이지 설명으로는 되돌리지 않는다.

## 기각한 대안

- **모바일 전용 상세 화면을 따로 만든다** — 화면 수가 두 배가 되고 로직이 갈라진다. 같은 컴포넌트의
  반응형 값으로 충분하다. 반응형으로 표현할 수 없는 화면이 나오면 그 화면에 한해 재론한다.
- **PC에서도 카드를 없앤다** — PC는 넓은 화면에서 섹션을 묶어 주는 카드가 실제로 읽기를 돕고,
  운영자가 PC는 괜찮다고 했다. PC 불만이 나오면 재론한다.
- **상태 변경 폼을 Modal로 연다** — shared 규칙상 임시 폼의 기본 패턴은 Modal이다. 하지만 Modal은
  바깥을 누르면 닫혀 입력한 사유 메모가 사라진다. 지금의 "제목 아래 펼침 + 탭 잠금 + 이탈 차단"이
  더 안전하다. Modal에 dirty 상태 닫기 확인이 생기면 재론한다.
- **모바일에서 상태 변경 버튼을 하단 고정 바로 뺀다** — 주문 상태 액션은 화면을 읽은 뒤 드물게
  누르는 작업이라 상시 노출할 이유가 약하고, 저장 바(`EditModeShell`)와 자리가 겹친다. 7번을 적용한
  뒤에도 버튼을 찾기 어렵다는 말이 나오면 재론한다.
- **모바일 탭을 셀렉트(드롭다운)로 바꾼다** — 지금 어느 탭인지와 다른 탭이 무엇인지가 한눈에 안 보인다.
  가로 스크롤 탭으로 충분하다. 탭이 7개를 넘는 화면이 생기면 재론한다.
- **PC 폼에 최대 폭을 둔다** — 상품·쿠폰 폼은 이미 md 이상에서 2열 그리드라 넓은 화면에서도 입력 칸이
  지나치게 늘어나지 않는다. 1열 폼이 1440px에서 읽기 어렵다는 말이 나오면 재론한다.

# store-local UI 하네스

이 디렉터리는 `@essesion/shared` 프리미티브를 store 페이지 용도로 조합한 컴포넌트만 둔다. 도메인 조회·금액 계산·라우팅 상태는 소유하지 않는다.

## 레이아웃 선택

위에서 처음 맞는 항목을 사용한다.

1. 화면 전체를 사용하는 처리 중·성공·실패 같은 **독립 결과 페이즈**인가? → `ResultPageLayout`
2. 브레드크럼, 본문, 우측 사이드바, 모바일 하단 CTA 중 하나가 필요한 **일반 콘텐츠 페이지**인가? → `ContentLayout`
3. 둘 다 아닌 단순 페이지인가? → `LayoutContent`와 shared 프리미티브를 페이지에서 직접 조합한다.

`ContentLayout` 안에 `ResultPageLayout`을 넣거나 그 반대로 중첩하지 않는다.

### 집중형 단일 화면

- `/login`처럼 짧은 단일 작업 화면은 `AppLayout`에서 헤더를 유지하고 푸터를 숨긴다. 페이지 루트가 남은 높이를 채우고 콘텐츠를 중앙 정렬한다.
- 인증 화면이 하나뿐인 동안은 별도 `AuthPageLayout`을 만들지 않는다. 두 번째 인증 폼이 추가될 때 공통 레이아웃을 추출한다.
- 로그인 인트로는 결과가 아니므로 `ResultSection`·`ResultEmoji`를 재사용하지 않는다. 장식 애니메이션은 페이지 로컬에서 진입 시 한 번만 실행하고 모션 감소 설정을 따른다.

### ContentLayout

사용:

- 상품 상세·장바구니·주문서처럼 일반 Header/Footer 셸 안에서 스크롤하는 페이지.
- PC에서 본문+우측 요약 컬럼이 필요할 때 `sidebar`.
- PC 사이드바 하단·모바일 화면 하단에 같은 핵심 CTA가 필요할 때 `actionBar`.
- 본문 뒤 설명·추천·가이드가 필요할 때 `detail`.

계약:

- PC(`lg` 이상)는 본문 `2fr` + 사이드바 `1fr`, 사이드바는 sticky다.
- 모바일·태블릿은 본문→사이드바→상세 순서이며 `actionBar`는 safe-area를 고려해 하단 고정된다.
- `actionBar`가 있으면 페이지의 핵심 CTA는 그 슬롯에만 둔다.
- 서버 데이터 페이지는 로딩·빈·에러 상태를 페이지가 직접 처리한다.

사용하지 않음:

- 결제 성공/실패·가입 완료 같은 독립 결과 화면 → `ResultPageLayout`.
- 디자인 캔버스처럼 고정 높이·전용 좌표계를 쓰는 화면.
- 사이드바나 하단 CTA가 필요 없다는 이유만으로 모든 단순 페이지를 감싸지 않는다.

### ResultPageLayout

사용:

- 결제 확인 중, 결제 성공·실패처럼 사용자가 한 작업의 독립적인 결과를 확인하는 화면.
- 일반 페이지 흐름보다 결과 메시지와 다음 행동 하나에 집중해야 하는 화면.

계약:

- 남은 viewport 높이를 채우고 콘텐츠 폭은 `density="low"`로 제한해 중앙 정렬한다.
- 브레드크럼·사이드바·상세 슬롯을 두지 않는다.
- 최종 결과는 `ResultSection`, 형태 없는 처리 중은 `ProgressCircle`을 우선한다.
- 최종 결과의 장식 에셋은 `ResultEmoji` 1개만 사용한다.
- 모바일 전체 너비 CTA는 페이지가 직접 배치하고 safe-area 밖으로 내보내지 않는다.
- Header/Footer 노출은 이 컴포넌트가 아니라 `AppLayout`의 라우트 셸 규칙이 소유한다. 현재 `/order/payment/*`는 모바일 Header와 전 기기 Footer를 숨기고 PC Header는 유지한다.

사용하지 않음:

- 일반 페이지 안의 목록 0건·섹션 오류 → `ContentPlaceholder`.
- 주문서처럼 입력·선택·요약을 함께 다루는 진행 화면 → `ContentLayout`.
- 단지 콘텐츠가 적다는 이유로 전체 화면 결과 레이아웃을 사용하지 않는다.

### ResultEmoji

- `public/fonts/TossFaceFontMac.ttf`의 Toss Face 글리프를 결과 화면의 장식 이모지 1개로 표시한다.
- 제목이 결과 의미를 전달하므로 이모지는 `aria-hidden`인 보조 표현으로만 쓴다.
- Motion의 `LazyMotion` 경량 기능으로 spring 진입 후 4초 주기의 짧은 펄스를 적용하며, 주기의 대부분은 정지 상태를 유지한다.
- 애니메이션은 opacity·transform만 사용하고 `useReducedMotion`이 참이면 진입·반복 모두 생략한다.
- 일반 본문 이모지·아이콘 대체·한 화면 복수 이모지에는 사용하지 않는다.

## 결제 UI 조각

| 컴포넌트 | 사용할 때 | 사용하지 않을 때 |
|---|---|---|
| `SummaryCard` | 주문·결제 사이드바에서 라벨/금액 행과 최종 합계를 표현 | 데이터 조회·할인 계산·일반 정보 카드 |
| `PaymentActionBar` | 결제 예정 금액을 포함한 단일 결제 CTA를 `ContentLayout.actionBar`에 배치 | 일반 저장/다음 버튼·복수 액션 |

### SummaryCard

- 표시 전용이다. 계산된 값을 props로 전달하고 내부에서 합계·할인·배송비를 계산하지 않는다.
- 조합 순서는 `Root` → `Section` → `Row` 반복 → `Total`을 기본으로 한다.
- 할인처럼 의미 있는 값만 `tone="informative"`로 강조한다.
- 데이터 표나 범용 카드가 필요하면 shared의 `Box`·`Grid`·`List`를 사용한다.

### PaymentActionBar

- `amount`, `disabled`, `loading`, `helperText`만으로 결제 CTA 상태를 표현한다.
- 배송지·약관·결제 위젯 준비 여부 판단은 호출 페이지가 소유한다.
- 결제 처리 중에는 `loading`, 결제 불가 조건에는 `disabled`를 사용하며 별도 중복 클릭 로직을 넣지 않는다.
- 화면당 핵심 CTA 1개 규칙을 지킨다.

## 추가 규칙

- 두 페이지 이상에서 실제로 쓰이거나 확정된 체크아웃 패밀리 재사용 계약이 있을 때만 이 디렉터리에 추가한다. 그 외 단일 페이지 조각은 해당 `pages`나 `features`에 둔다.
- store와 admin 모두 필요해지면 구현을 복사하지 말고 `packages/shared` 승격을 제안한다.
- `@essesion/shared`에 이미 있는 컴포넌트를 앱 로컬에서 다시 만들지 않는다.
- 시각값은 토큰만 사용하고 `pnpm lint`의 하네스 검사를 통과해야 한다.

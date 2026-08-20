# 디자인 페이지 다듬기 + 대시보드 수기주문 합산

2026-08-21 사용자 실사용 피드백 7건을 실행하는 플랜. 대상은 store 디자인 페이지(잔액 오류·입력창 정렬·히스토리/타일 배율·타일 흰 선·포커스 링·실사화 모달 짜임 이미지)와 admin 대시보드(수기주문 합산). 각 항목은 독립 실행·검증 가능하며 효과 ÷ 난이도 순으로 정렬했다 — 위에서부터 실행한다.

## 왜 필요한가

- **잔액 조회 오류(실측 재현 완료)**: `GET /tokens/balance`가 400 `token_cost_not_configured`로 실패했다. 원인은 DB `admin_settings`에 `design_finalize_cost` 행 부재 — 실사화 과금 도입(#72, `docs/reviews/finalize-sync-token-pricing-2026-08-19.md`) 후 시드 미재실행 환경은 잔액 조회 전체가 죽는다. **로컬은 2026-08-21 시드 재실행으로 복구 완료(200 확인)** — 남은 것은 재발 방지와 배포 환경 절차다.
- **프론트가 오류를 숨김**: 잔액 쿼리에 에러 분기가 전혀 없어 실패 시 "0토큰 / —"로 조용히 렌더된다(`apps/store/src/features/design/ui/token-pill.tsx:80-84`). 사용자가 본 "오류"는 이 침묵 실패다.
- **수기주문 집계 누락**: 대시보드 집계는 전부 `orders`/`order_items`만 스캔하고 `manual_orders`는 조인·UNION이 0건이다(`apps/api/src/api/domains/admin/orders.py:373-574`, `grep ManualOrder` 결과 라우터 외 참조 없음). 무통장·전화 접수 매출이 지표에서 통째로 빠진다.
- 나머지(정렬·배율·흰 선·포커스 링·짜임 이미지)는 아래 각 항목에 근거를 적었다.

**실패 모드 한 줄**: 배율·정렬 같은 시각 항목을 브라우저 실측 없이 상수만 바꾸고 끝내는 것 — 모든 시각 항목은 Aside 실측이 완료 조건이다. 대시보드 항목의 실패 모드는 매출일 매핑(아래 2번)을 임의로 바꿔 기존 지표와 시계열이 불연속되는 것.

## 범위 밖 (non-goals)

- 수기주문을 `orders` 파이프라인·상태머신에 통합하지 않는다(별도 장부 유지, `db/src/db/models/commerce.py:638` 주석이 설계 의도).
- 프롬프트바 auto-grow의 `field-sizing: content` 전환(기존 `ponytail:` 주석, 별건).
- 포커스 링 전면 제거·색 변경 — 접근성 기본이므로 하지 않는다(6번은 "모달 열릴 때 자동 링"만).

## 실행 조건

- 시각 항목(3·4·5·7)은 store dev 서버(:3000)와 Aside 브라우저 실측이 가능할 때만 실행한다. 실측 없이 상수만 바꾸지 말 것.
- 2번(대시보드)은 API 응답 스키마가 바뀌므로 `pnpm codegen` + 생성물 동커밋(CI drift 검사)과 `docs/api-spec/domains.md` 갱신을 같은 항목에서 끝낸다(대원칙).

## 절차

### 1. 잔액 조회 오류 — 재발 방지

로컬 복구는 끝났다. 남은 두 가지:

1-a. **배포 환경 설정 시드 보장** — `.github/workflows/deploy.yml`에는 `bootstrap_admin.py seed-config` 실행이 없다(grep 0건). `infra/README.md:253-261`이 수동 절차로만 두고 있어, feat/reform 배포 직후 prod에서 같은 400이 재현된다. 배포 워크플로의 마이그레이션 단계 뒤에 `seed-config`(overwrite=False — 운영자 조정값 보존, `apps/api/src/api/config_defaults.py:86-91`) 실행을 추가하거나, 최소한 이번 배포 체크리스트에 명시한다. 근거: `config_defaults.py` 자체가 "빈 DB는 여기 값으로 먼저 채운다"를 정본 선언.

1-b. **프론트 에러 표면화** — `apps/store/src/pages/design/index.tsx:106`의 `balanceQuery`에 `isError` 분기를 추가해 TokenPill 자리에 실패 상태(재시도 가능)를 보여준다. "0토큰"으로 위장하지 않는 것이 목적. 침묵 실패는 사용자가 토큰이 없다고 오인해 결제로 이어질 수 있는 돈 경로 UX다.

### 2. admin 대시보드에 수기주문 합산

매출일 매핑을 먼저 고정한다: **`is_paid = true`인 수기주문만, `order_date`(KST date)를 매출일로 집계**한다. `ManualOrder`에는 `paid_at`이 없고(`db/src/db/models/commerce.py:638-660`) `order_date` + `is_paid`뿐이므로 이것이 유일한 합리적 매핑이다. 금액은 `amount + shipping_fee` — 기존 `Order.total_price`가 배송비 포함이므로(`apps/api/src/api/domains/orders/service.py:598`) 동일 기준.

2-a. `apps/api/src/api/domains/admin/orders.py:373-421`(`dashboard_summary`)·`:429-508`(`dashboard_timeseries`)에 `manual_orders` 집계를 합산한다. `order_type` 필터에 `manual` 값을 추가하고, `manual` 선택 시 수기주문만/기존 타입 선택 시 기존 주문만/`all`이면 합산.
2-b. `recent_orders`(`orders.py:559-574`) 응답에 수기주문을 병합하되 행에 구분 필드를 넣어 admin UI(`apps/admin/src/pages/dashboard.tsx:560-581`)가 "수기" 뱃지를 표시하고 상세 링크를 `/manual-orders/{id}`로 보낸다.
2-c. `apps/admin/src/pages/dashboard.tsx:209-216` 타입 필터에 "수기" 옵션 추가.
2-d. **명세 갱신** — `docs/api-spec/domains.md` "10. admin 기타"에 대시보드 집계 기준(기존 주문 `paid_at`, 수기주문 `order_date`+`is_paid`)과 필터 시맨틱을 명문화한다. 현재 명세에 대시보드 항목 자체가 없다(공백).
2-e. `pnpm codegen` 후 `packages/api-client` 생성물 동커밋.
2-f. 집계 테스트는 testcontainers(실제 Postgres)로 — `apps/api/tests/test_admin_manual_orders.py` 옆에 대시보드 합산 케이스 추가(is_paid=false 제외 확인 포함).

인기 상품 TOP5는 합산하지 않는다 — 수기주문 items(JSONB)에는 product_id가 없고, 기존 표도 "커스텀·수선 제외"를 명시하고 있어 일관적이다.

### 3. 실사화 모달 원단 짜임 — 텍스트 → 이미지 스와치

3-a. **스와치 에셋 생성** — 워커 짜임 텍스처(`apps/worker/src/worker/render/assets/fabric/*.png`, 7종이 `FabricWeave` 옵션과 1:1)를 원본 그대로 쓰지 말 것(1.9–7.3MB). `apps/worker/src/worker/render/photoreal.py:101-107`(`weave_reference_png`)과 같은 방식으로 **중앙을 작게 크롭해 확대 효과를 내고** 256px 내외로 리사이즈한 웹용 파일을 `apps/store/public/images/weaves/<weave>.png`로 생성하는 일회성 스크립트를 스크래치에서 돌린다(레포에는 결과 파일만 커밋). 크롭 비율은 실측으로 정하되, 흰 원단이라 잘 안 보인다는 피드백이 출발점이므로 텍스처 결이 뚜렷해질 때까지 좁힌다(추정 시작점: 원본의 1/4 변).
3-b. `apps/store/src/features/design/ui/finalize-dialog.tsx:57-81` `WEAVES`에 이미지 경로를 추가하고, `SelectBoxItem`(`packages/shared/src/components/select-box.tsx:124-127` — `label`/`description`이 ReactNode)의 `description`에 스와치(Box + CSS background-image, 장식 이미지라 하네스 허용) + 기존 설명 텍스트를 함께 넣는다. shared 컴포넌트 변경 없이 조합으로 해결 — 하네스 사다리 ②.
3-c. `columns`를 이미지에 맞게 조정(`{ base: 2, sm: 2 }` 추정)하고 Aside로 모바일 폭 실측.

### 4. 타일 보기 흰 선 (모바일 포함)

원인 추정: `packages/shared/src/components/tie-canvas.tsx:78-83`의 `backgroundSize`가 컨테이너 폭의 %라 타일 폭이 거의 항상 소수 px → `background-repeat`가 반복마다 반올림하며 서브픽셀 틈으로 부모 배경(밝은 회색)이 비친다. `backgroundPosition: center`가 반칸 오프셋을 더해 비정수 에지를 보장한다.

4-a. repeat 모드의 타일 폭을 **정수 px로 스냅**한다 — 컨테이너 폭을 측정(ResizeObserver, `prompt-bar.tsx:66-76`에 기존 패턴)해 `Math.round(width × tileFraction × tileScale)`px로 `backgroundSize`를 지정. `background-position`도 정수로.
4-b. `tie-canvas.tsx:100-107` repeat 박스의 `transition-all duration-100`이 background-size 중간값(소수)을 잠깐 그린다 — background 속성은 전환 대상에서 제외.
4-c. Aside 모바일(390) + PC에서 타일 경계 확대 스크린샷으로 흰 선 소멸 확인.

### 5. 히스토리 박스·모바일 타일 배율 확대

5-a. **히스토리 썸네일** — `apps/store/src/features/design/model/svg-preview.ts:36-46`의 `size = min(62 × scale, 100)%`가 84px(모바일)·152px(PC) 박스 어디서든 같은 %라, 작은 박스일수록 타일이 물리적으로 작아진다. %를 버리고 **px 기반**(타일 1장 = `svgWidthMm × K`px, K는 실측 튜닝 상수)으로 바꾸면 작은 박스가 자동으로 "더 확대"되어 PC·모바일 요구를 한 번에 충족한다. 상한은 기존 주석의 의도(타일 1장이 박스보다 커지면 단색으로 보임)를 살려 박스 폭 이하로 캡. `history-card.tsx:121-134`·`history-modal.tsx:79-90`·`session-list-modal.tsx:138`이 같은 함수를 쓰므로 한 곳 수정으로 전파된다.
5-b. **모바일 타일 보기** — `apps/store/src/features/design/ui/design-canvas.tsx:64-77`의 모바일 전용 full-bleed `TieCanvas` 호출에 `tileScale` 배수(추정 시작점 ×1.5)를 곱해 확대. PC 캔버스는 건드리지 않는다.
5-c. Aside 실측: PC/모바일 히스토리 카드, 히스토리 모달 그리드, 모바일 타일 보기 각각 스크린샷으로 배율 확정. 상수(K·배수)는 실측 후 결정하며 이 문서의 수치는 추정이다.

### 6. 페이지 진입 시 파란 포커스 링 억제

파란 링(#5e98fe)의 근원: 첫 방문 시 온보딩 모달이 열리며(`apps/store/src/pages/design/index.tsx:86-88`) 네이티브 `dialog.showModal()`(`packages/shared/src/components/internal/use-dialog.ts:73`)이 첫 포커서블인 닫기 버튼(`modal.tsx:116`)을 자동 포커스하고, 브라우저가 이를 `:focus-visible`로 취급해 링을 그린다. 기능(키보드 포커스 이동)은 정상이고 시각만 문제다.

6-a. `use-dialog.ts`의 open 처리에서 `showModal()` 직후 포커스를 다이얼로그 패널(tabIndex −1)로 옮긴다 — 포커스는 모달 안에 갇히고(접근성 유지) 비인터랙티브 요소라 링이 그려지지 않는다. Modal·AlertDialog 공용 훅이므로 한 곳 수정.
6-b. **포커스 링 자체는 제거하지 않는다** — 키보드 사용자 식별 수단(`docs/foundation/inclusive-design`). 텍스트 입력 autoFocus는 이미 없음(store 전체에서 `autoFocus`는 `finalized-gallery.tsx:155` 확대 뷰 뒤로가기 버튼뿐, 로드 시 아님)이라 조치 불요.

### 7. 프롬프트 입력창 수직 정렬

`apps/store/src/features/design/ui/prompt-bar.tsx:90-103` 래퍼가 `alignItems="flex-end"` + `minHeight 48`인데 한 줄 상태 textarea 콘텐츠 높이는 약 31px(text-t4 19px + py-x1_5 12px)라 위쪽에 ~7px 죽은 공간이 생겨 텍스트가 아래로 처져 보인다.

7-a. 래퍼를 `alignItems="center"`로 바꾸고, 여러 줄로 자란 상태에서 우측 버튼(h-36px) 위치가 어색하면 버튼에만 `alignSelf="flex-end"`를 준다.
7-b. Aside로 한 줄/여러 줄/최대 높이(200px 스크롤) 세 상태 실측.

## 검증

- 1번: 시드 없는 DB에서 `curl -H "Authorization: Bearer <token>" :8000/tokens/balance` → seed-config 후 200. 프론트는 API를 끈 상태로 디자인 페이지 진입 → 실패 상태 노출 확인.
- 2번: testcontainers 테스트 + admin 대시보드에서 수기주문 1건(is_paid=true) 생성 후 주문 금액·건수·추이·최근 주문 반영 실측. is_paid=false 건은 미반영 확인. `pnpm architecture:check`(명세 문서 링크)와 CI codegen-drift 통과.
- 3·4·5·7번: Aside(:3000, 로그인 `store-staff-login-reveal` 메모 참조) PC·모바일 스크린샷. 4번은 타일 경계 확대 캡처로 흰 선 부재 확인.
- 6번: 시크릿 창 첫 진입(온보딩 모달 자동 오픈) 시 파란 링 없음 + Tab 키를 누르면 닫기 버튼에 링이 정상적으로 나타남(키보드 접근성 유지 확인).

## 기각한 대안

- **`get_cost`가 코드 기본값으로 폴백**(1번): 서버측 하드 에러가 "설정 없이 과금 시작" 사고를 막는 방어선이라는 기존 설계(`ledger.py:73`)를 유지. 시드 절차 보장이 맞는 층위. 폴백이 재론되려면 money.md 정본 갱신이 선행돼야 한다.
- **수기주문에 `paid_at` 컬럼 추가**(2번): 수기주문은 종이 장부의 디지털화라 결제 시각 개념이 없다. `order_date`+`is_paid` 매핑으로 충분하며, 실결제 시각이 필요해지는 순간(예: 정산 연동) 재론.
- **`svgTileStyle`에 반응형 파라미터 추가**(5-a): inline style이라 media query가 안 먹고 호출부마다 matchMedia를 끌어와야 한다. px 기반 크기가 박스 크기에 자동 반비례하므로 더 단순.
- **전역 `:focus-visible { outline: none }`**(6번): 접근성 기본 파괴. 재론 없음.
- **짜임 스와치를 워커 에셋 직참조/빌드 복사**(3번): 2–7MB 원본을 그대로 서빙하게 되거나 빌드 파이프라인이 늘어난다. 커밋된 소형 파생 파일이 가장 단순. 원본 텍스처가 바뀌면 스크립트 재실행.

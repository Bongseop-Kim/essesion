# 디자인 페이지 다듬기 + 대시보드 수기주문 합산 — 2026-08-21 실행

`docs/plans/design-page-polish-and-dashboard-manual-orders.md` 실행 기록. 사용자 실사용 피드백 7건 전부 반영.
브라우저 실측은 Aside(store :3000 / admin :3001, viewport 1440×900)로 했고, 모바일 폭은 리사이즈가
안 되므로 DOM에 폭을 주입해 계산값만 확인했다.

## 1. 잔액 조회 오류 (400 `token_cost_not_configured`)

**원인**: `admin_settings`에 `design_finalize_cost` 행 부재. 실사화 과금 도입(#72) 후 행을 넣는 경로가
수동 `seed-config`뿐이었고, `ledger.get_cost`가 하드 에러를 내면 `GET /tokens/balance` **전체**가 죽는다.

- **재발 방지는 Alembic 데이터 마이그레이션으로** — `db/migrations/.../a3f7d94c1e28`가
  `on conflict do nothing` INSERT를 한다. migrate job이 배포마다 자동 실행하므로 수동 절차에 의존하지 않는다.
  선례는 `f1c6a80b5d29`(값 변경 UPDATE); 이번은 신규 키 INSERT 패턴. 규칙을 `config_defaults.py`
  독스트링과 `infra/README.md`에 적었다. **deploy.yml·terraform은 건드리지 않았다** — 기존 migrate job이
  이미 자동 훅이므로 새 Cloud Run job이 필요 없다.
- **프론트 침묵 실패 제거** — `TokenPill`에 `failed`/`onRetry`. 실패를 "0토큰"으로 그리면 잔액이 없다고
  오인해 불필요한 결제로 이어지는 돈 경로였다. 이제 "잔액 확인 불가" + 메뉴에 "다시 불러오기".
- **실측**: 행을 지워 400을 재현 → pill이 "잔액 확인 불가", 메뉴 "잔액을 불러오지 못했어요" 노출 →
  시드 복구 후 "다시 불러오기" 클릭 → 23토큰 복귀. 콘솔 오류 0.

## 2. admin 대시보드 수기주문 합산

수기 주문은 `manual_orders`(별도 장부, `Order` 상태머신과 무관)라 기존 집계가 100% 누락하고 있었다.

- **매출 인정 기준을 명세로 확정** — `is_paid = true`인 행만, `order_date`(이미 KST date)를 매출일,
  금액은 `amount + shipping_fee`(`Order.total_price`가 배송비 포함이라 같은 기준). `paid_at`이 없으므로
  이 매핑이 유일한 선택지다. `docs/api-spec/domains.md` §10에 기재.
- `dashboard_summary`·`dashboard_timeseries`에 합산. 인기 상품 TOP-N은 제외(품목이 JSONB, product_id 없음).
- **필터 타입을 분리** — `DashboardOrderTypeFilter`(= 기존 6종 + `manual`)를 새로 두고 대시보드 3개
  엔드포인트에만 적용. `OrderTypeFilter`(주문 목록)에 `manual`을 넣으면 `Order.order_type == "manual"`로
  0건을 조용히 반환하므로 넣지 않았다. `manual` 선택 시 `recent-orders`는 빈 페이지.
- **최근 내역은 별도 표** — `AdminOrderSummaryOut`에는 주문번호·상태·고객 uuid가 필수인데 수기 주문엔
  없다. 억지로 끼우는 대신 **이미 있는 `GET /admin/manual-orders`를 대시보드에서 재사용**해
  "최근 수기 주문" 카드를 추가했다(API 변경 0).
- **실측**: 결제 40,000+4,500 / 미결제 99,000 두 건 투입 → 주문 금액 ₩44,500 · 주문 수 1건(미결제 제외),
  매출 추이 축 6만으로 갱신, 최근 수기 주문 표 2건. `type=manual`은 ₩44,500 + 최근 주문 표 비움,
  `type=sale`은 ₩0. 검증 데이터는 삭제했다.
- api-client 재생성 동커밋(대시보드 3개 표면의 enum만 변경).

## 3. 실사화 모달 원단 짜임 — 텍스트 → 이미지 스와치

워커가 실제 렌더에 쓰는 `worker/render/assets/fabric/*.png` 7종이 옵션 값과 1:1이라 그걸 그대로 쓴다.
원본은 1.9–7.3MB이고 평균 235·표준편차 5–14의 **거의 흰 이미지**라 축소하면 결이 사라진다.

- `apps/worker/scripts/export_weave_swatches.py`(신규, 재실행 가능): 중앙 1/4 크롭(4배 확대) +
  콘트라스트 스트레치(목표 표준편차 22, gain 상한 3.5 — solid까지 끌면 평직에 없는 음영이 생긴다) +
  224px 그레이스케일 → `apps/store/public/images/weaves/`. 7장 합계 **260KB**.
- 표시는 72px 박스에 `backgroundSize` 144px(2배)로 한 번 더 확대. 총 8배.
- `SelectBoxItem`에 `media` 슬롯을 추가했다(shared). `description`에 넣으면 `<Text>`(span) 안에 Box가
  들어가 무효 중첩이 된다 — 하네스 사다리 ③.
- **실측**: 날염 2종·선염 7종 모두 결이 구분된다(체크 격자, 헤링본 V, 자카드 입체, 핀도트 점, 솔리드 평직,
  트윌 직선/사선).

## 4·5. 타일 흰 선 + 배율

원인 후보 중 유일하게 통제 가능한 것은 **소수 px 타일 폭 + center의 반칸 오프셋**이었다. 둘 다 제거했다.

- `TieCanvas` repeat 모드: ResizeObserver로 폭을 재고 `round(폭 × 0.28 × scale)`px 정사각 + 원점 정렬.
  `tie` 모드는 손대지 않았다 — 내려받기(`tie-image.ts`)와 같은 기하를 유지해야 한다(repeat는 export 경로에 없다).
  background 전환도 제거(중간 소수 크기가 그려진다).
- `svgTileStyle`: `62% auto` → `min(100%, ${116 × scale}px)` 정사각 + 원점. 두 분기 모두 이음매가 없다
  (px 분기는 정수, 100% 분기는 타일 1장이 박스를 정확히 채움). **px는 박스가 작을수록 상대적으로 더
  확대돼 보여** 반응형 분기 없이 "모바일 > PC" 요구가 충족된다.
- 모바일 풀블리드 타일 보기는 `MOBILE_TILE_ZOOM = 1.5`.
- **실측**: PC 타일 캔버스 719px → `201px 201px / 0px 0px`. 폭 390 주입 시 `164px 164px`(이전 109.2px).
  PC 히스토리 썸네일 126px 박스 → 116px 타일(1.09장, 이전 1.61장).
- **한계 — 흰 선 자체는 재현하지 못했다.** DPR 1·1440 뷰포트에서는 변경 전에도 "크림보다 흰" 픽셀이
  0개였다(픽셀 스캔). Aside는 뷰포트 리사이즈가 안 돼 사용자가 본 모바일 조건을 만들 수 없었다.
  다만 신구 A/B에서 **소수 배율의 재래스터라이즈 노이즈가 확인됐다**: 같은 화면 PNG가 450KB → 93KB로
  줄고, 확대 크롭에서 모티프 윤곽이 흐릿→선명으로 바뀐다. 흰 선의 유력 기제가 이 소수 경계 블렌딩이고,
  그 입력을 전부 제거했다. **사용자 기기에서 재확인이 필요하다.**

## 6. 모달 자동 포커스 링

`showModal()`이 첫 포커서블(닫기 버튼)을 자동 포커스하고 브라우저가 이를 `:focus-visible`로 취급해
파란 링(#5e98fe)을 그리던 것. `useDialog`에서 `showModal()` 직후 포커스를 dialog 자신(`tabIndex -1`)으로
옮긴다. `[autofocus]`가 있으면 존중한다. Modal·AlertDialog·SidePanel 공용 훅이라 한 곳 수정으로 전파.

**포커스 링 자체는 제거하지 않았다** — 키보드 사용자의 유일한 위치 표시다.
**실측**: 이력 모달·실사화 모달 열림 직후 `activeElement`=DIALOG, `:focus-visible` false, `outline-style: none`.
Tab 1회 → 닫기 버튼에 `rgb(94,152,254)` solid 링 정상 복귀.

텍스트 입력창의 로드 시 autofocus는 원래 없었다(store 전체 `autoFocus`는 완성본 확대 뷰 뒤로가기 1곳,
로드 시점 아님) — 조치 불필요.

## 7. 프롬프트 입력창 수직 정렬

래퍼가 `alignItems="flex-end"` + `minHeight 48`인데 한 줄 textarea 콘텐츠 박스는 31px(t4 19px + py 12px)라
행 여유 38px 안에서 아래로 붙어 글자가 테두리 중앙보다 약 4.5px 처져 있었다. `center`로 변경.
**실측**: form 중심 856 = textarea 중심 856(정확히 일치).

건너뛴 것: 여러 줄로 자랐을 때 버튼을 하단 고정하는 처리. 한 줄 상태가 압도적으로 흔하고 중앙 정렬이
글자·버튼 중심을 모두 맞춘다 — 200px까지 자란 상태에서 버튼 위치가 어색하다는 피드백이 오면 그때 넣는다.

## 검사

`pnpm lint`(check-harness OK) · `pnpm typecheck` · `pnpm build` · `pnpm test`(store 238 / admin 237 /
shared 69) · `pnpm architecture:check`(5 contracts kept) · `uv run ruff check .` · `uv run pyright apps/api/src` ·
`uv run pytest` 대상 파일 111 passed. 커밋·푸시는 하지 않았다(대원칙).

# 대시보드 취소 주문 표시·집계와 부분 환불 금액 — 실행 기록 (2026-11-20)

플랜 `docs/plans/admin-dashboard-cancelled-orders.md`(삭제)를 실행했다. 취소 클레임이 완료된 주문이
대시보드에서 살아 있는 주문처럼 보이고 매출·주문 수에 잡히던 문제를 고쳤고(1~3), 의도한 부분 환불이
결제 이상으로 뜨지 않게 환불 금액을 클레임에 먼저 적는 흐름을 넣었다(4).

## 원인

- 취소 클레임을 `완료`해도 주문 `status`는 그대로다(`claims/service.py` `admin_update_status`).
  주문 목록·상세는 클레임 뱃지로 알리는데 대시보드 '최근 주문'만 뱃지를 안 그렸다.
- 매출 집계가 `paid_at`만 봤다. "결제 후 취소는 차감하지 않는다"가 코드와 테스트에 적힌 의도였다.
- 환불은 Toss 관리자 화면에서 직접 하므로, 부분 취소 웹훅이 오면 의도한 환불인지 알 길이 없어
  무조건 `partial_cancel` 이상을 열었다.

## 한 일

- **1** `apps/admin/src/pages/dashboard.tsx` — 최근 주문의 상태 칸을 주문 목록과 같은 조합
  (`StatusBadge` + `ClaimStatusBadge`)으로 바꿨다.
- **2** `apps/api/src/api/domains/admin/orders.py` — 요약·추이는 `status = '취소'` 주문을 빼고,
  취소 클레임이 완료된 주문은 `total_price − 환불 금액`을 매출로 잡는다(0이면 주문 수에서도 뺀다).
  금액이 안 적힌 예전 클레임은 전액 환불로 본다. 인기 상품은 품목별 환불 배분 근거가 없어
  취소 클레임이 완료된 주문을 통째로 뺀다.
- **4-입력** `claims/schemas.py`·`claims/router.py`·`claims/service.py` — 취소 클레임의
  `접수→처리중`에서 `refund_amount`를 받는다(생략 = 전액, `0 < 금액 ≤ total_price`, 아니면 400
  `invalid_refund_amount`). `claims.refund_data = {"amount": n}`에 저장하고 `처리중→접수` 롤백 시
  지운다. 스키마 변경은 없다(있던 빈 컬럼).
- **4-웹훅** `payments/service.py` — `PARTIAL_CANCELED`의 취소 누계가 결제 묶음 전체의 `처리중`·`완료`
  취소 클레임 금액 합과 정확히 같고 `paymentKey`·총액이 일치하면 이상을 열지 않는다
  (`partial_cancel_expected`). 그 외는 전과 같이 이상을 연다.
- **4-화면** `apps/admin/src/pages/claims/detail.tsx` — 처리중으로 올리는 액션 폼에 `NumberField`
  (천 단위 콤마, 기본값 주문 금액 전액)를 넣고, 적힌 금액을 주문 정보의 '환불 금액'으로 보여 준다.
- **명세** `docs/api-spec/domains.md` §4·§10, `docs/api-spec/money.md` §9. api-client 재생성
  (`refund_amount` 추가).

## 플랜과 달라진 점

- 플랜은 환불 금액 칸을 "확인 창"에 넣는다고 했지만, 처리중으로 올리는 액션은 확인 창 없이
  헤더 아래 액션 폼(메모 입력 카드)에서 바로 실행된다. 그래서 그 폼에 넣었다.

## 검증

- `uv run pytest apps/api/tests/test_claims.py apps/api/tests/test_payments.py
  apps/api/tests/test_admin_orders.py apps/api/tests/test_admin_phase_d.py` — 75 passed.
  기존 `test_dashboard_summary_and_recent_orders`는 "결제 후 취소도 매출에 넣는다"를 기대하고 있어
  새 기준으로 고쳤다.
- `pnpm --filter admin test claims/detail dashboard` — 18 passed. `pnpm lint`, admin `typecheck`,
  `ruff`, `pyright` 통과.
- 브라우저 실측은 하지 않았다. 개발 DB의 `ORD-20260811-008`(주문 `발송확인중` + 취소 클레임 `완료`)이
  운영 증상과 같은 데이터라는 것만 psql로 확인했다.

## 운영 순서

클레임 `처리중`으로 올리며 환불 금액 입력 → Toss 관리자에서 그 금액 환불 → 클레임 `완료`.
Toss를 먼저 누르면 전과 같이 결제 이상이 뜬다(`토스 결제 상태 반영` → `이상 해결`로 닫는다).

## 남은 것

- **환불을 admin에서 실행(`toss.cancel` 호출)** — 보류. 위 흐름을 2~3주 써 보고도 Toss 화면을
  오가는 게 번거로우면 붙인다. 금액이 이미 클레임에 있고 웹훅 대조도 있어서 `완료` 버튼이 그
  금액으로 취소를 부르면 된다. 붙일 때는 응답 유실 시 중복 환불 방지(Toss 멱등 키 지원 여부는
  미확인)를 먼저 확인한다.
- **명세 불일치** — `domains.md` §4는 수선 취소 클레임을 `{대기중,결제중}`에서만 허용한다고 적지만
  코드(`orders/status_machine.py`)와 `money.md` §8은 `발송대기·발송중·발송확인중`도 허용한다.
- **반품·교환 클레임의 환불 금액** — 이번에 건드리지 않았다. 매출 집계도 취소 클레임만 본다.
- **이미 완료된 예전 취소 클레임** — 금액이 없어 전액 환불로 집계된다. 2026-11-19 부분 환불 건
  (`ORD-20261119-002`)도 여기에 해당해 남긴 금액이 매출에서 빠진다.

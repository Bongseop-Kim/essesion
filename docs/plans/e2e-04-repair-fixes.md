# e2e-04 수선 결과 후속 수정 플랜

> `docs/reviews/e2e-04-repair-2026-08.md`의 FAIL 2건을 다룬다. 나머지 13건은 전부 PASS.
> FAIL 1은 API 결제 confirm의 멱등 판정 결함, FAIL 2는 store 발송 폼의 stale closure
> 덮어쓰기다. 둘 다 원인을 코드에서 확정했다.

## 1. 결제 success 새로고침 409 — confirm 멱등 판정 확대 (FAIL 1, API)

**원인**: `/payments/confirm`의 멱등 사전체크
(`apps/api/src/api/domains/payments/service.py:168`)는 주문 상태가 **결제 직후 상태**
(`_post_status` — repair는 `발송대기`)와 정확히 같을 때만 payment_key를 대조해 DONE을
돌려준다. R7은 성공 화면의 발송 자동 등록이 몇 초 안에 `발송대기→발송중`으로 상태를
전진시키므로, 새로고침 재confirm 시 사전체크에 걸리지 않고 `not_payable` 409로 떨어진다.
프론트는 이미 멱등 재confirm에 대비돼 있다(`features/repair-shipping/model/post-confirm.ts:22`
— `발송대기`가 아니면 `submitted` 화면) — API만 고치면 된다.

이건 수선만의 문제가 아니다: admin이 상태를 전진시킨 뒤(판매 `진행중→배송중` 등) success
URL을 다시 열면 어떤 주문 유형이든 같은 409가 난다. e2e-01 S9가 통과한 건 상태가 아직
결제 직후였기 때문이다.

- 멱등 판정 기준을 "결제 직후 상태 일치"에서 **"결제가 이미 적용됨"**(`paid_at` 존재)으로
  바꾼다: 그룹 전 주문이 `paid_at`을 가지면 payment_key 대조 후 `_done_response` —
  이후 상태가 어디까지 전진했든 같은 응답. 키 불일치 409(`payment_key_mismatch`)와
  일부만 결제된 그룹의 `payment_reconciliation_required` 409는 유지한다.
- 같은 검사가 lock 이후(`service.py:204`)에도 반복되므로 두 곳 모두 바꾼다.
  `_post_status`는 확정 시 상태 기록용으로 그대로 둔다.
- `not_payable`은 미결제 주문(대기중·결제중 아님 + `paid_at` 없음)에만 남는다.
- 테스트(`apps/api/tests/test_payments.py`): confirm → 상태 전진(발송 등록·admin 진행) →
  같은 키 재confirm 200 DONE / 다른 키 409 / 미결제 취소 주문 409.
- 응답 스키마 변경 없음 — api-client 재생성 불필요, store 무수정. 새로고침 시
  `planRepairOutcome`이 `submitted`를 돌려줘 R10 기대 화면("발송 정보까지 등록되었습니다")이
  그대로 복원된다.

## 2. 업로드 완료가 입력 중인 메모를 덮어씀 (FAIL 2, store)

**원인**: stale closure. `RepairShipmentFields`의 `set`
(`features/repair-shipping/ui/repair-shipment-fields.tsx:20`)은 렌더 시점의 `state`를 스프레드해
`onChange({...state, ...patch})`로 폼 **전체**를 교체한다. 사진 업로드는 비동기 큐
(`shared/lib/use-photo-upload-queue.ts:62`)라, 완료 시점에 호출되는 `onChange` 클로저는
**파일 선택 당시의** `state`(메모 입력 전)를 들고 있다. 업로드 중 입력한 메모가 완료 렌더에서
빈 값으로 되돌아가고, 그대로 결제되면 receipt `memo`가 null로 저장된다 — RA4 관측과 일치.
(receipt `reason`은 송장 없는 접수 전용 필드라 R7에서 null이 정상이다 — 버그는 memo뿐.)

- `RepairShipmentFields`의 `onChange` 계약을 전체 교체에서 **patch 전달**로 바꾸고, 부모가
  functional setState로 병합한다: `setShipForm((form) => ({ ...form, ...patch }))`.
  비동기 완료가 언제 오든 최신 폼 위에 photos만 얹힌다.
- 소비처 두 곳 갱신: 주문서(`pages/order/order-form.tsx:551`)와 발송 확인 전용 페이지
  (`pages/order/repair-shipping.tsx`) — 전용 페이지도 같은 컴포넌트라 같은 경쟁이 잠재한다.
- 테스트: 업로드 진행 중 메모 변경 → 업로드 완료 후 메모 유지 (컴포넌트 테스트).

## 검증

- `uv run pytest` + `pnpm turbo build typecheck test` 통과.
- Aside 재현 (R10 재판정): 송장·사진 입력 결제 → `발송 정보까지 등록되었습니다` → 새로고침 →
  같은 화면, API 로그 200·중복 주문 0. admin에서 상태를 더 전진시킨 뒤 재방문도 정상.
- Aside 재현 (RA4 재판정): 사진 업로드 중 메모 입력 → 완료 후 메모 유지 → 결제 →
  DB receipt `memo` 저장·admin 발송 접수 카드 표시.

## 상태 — 계획

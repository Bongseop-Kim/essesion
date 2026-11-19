# 수선 발송 확인 페이지: 입력 폼 바로 노출 — 실행 기록 (2026-11-19)

플랜 `docs/plans/repair-shipping-form-direct.md`(삭제)를 실행했다. `/order/:orderId/repair-shipping`에서
"수선품을 발송했습니다." 선택 박스를 없애고 입력 폼을 바로 보여 주며, 제출 버튼을 모바일 하단에 고정했다.

## 한 일

- `apps/store/src/shared/ui/content-layout.tsx` — 데스크톱에서 `sidebar` 없이 `actionBar`만 있으면 본문 아래에
  그린다. `actionBar`를 넘기는 기존 9곳은 모두 `sidebar`도 넘겨 화면이 바뀌지 않는다.
- `apps/store/src/pages/order/repair-shipping.tsx` — `confirmedShipment` 상태와 `SelectBox`를 지우고
  `RepairShipmentFields`를 항상 렌더한다. 버튼은 `actionBar`로 옮기고 라벨을 "발송 완료 알리기"로 바꿨다.
  주문이 로드됐을 때만 `actionBar`를 넘긴다.

## 검증

- `pnpm lint`, 스토어 typecheck·test 통과.
- 로컬 스토어에서 `발송대기` 수선 주문으로 확인했다.
  - 들어가자마자 입력칸이 보이고 선택 박스가 없다.
  - 390×844에서 버튼이 하단에 고정되고, 1280폭에서는 입력칸 아래에 보인다.
  - 택배사만 고르면 버튼이 비활성이고 "송장번호를 입력해 주세요."가 보인다.
  - 택배사·송장번호를 넣고 제출하면 주문 상세로 이동하고 발송 정보가 표시된다.

## 확인하지 않은 것

- 빈 폼 제출. 로컬에 `발송대기` 주문이 하나뿐이라 송장 입력 제출에 썼다. 빈 폼에서 버튼이 활성인 것까지는
  봤고, 빈 폼이 유효한 draft인 것은 `shipment.test.ts`가 확인한다.
- 주문서에서 "이미 발송했어요"로 넘어온 prefill. prefill을 폼에 채우는 코드는 바꾸지 않았다.
- 사진 업로드.

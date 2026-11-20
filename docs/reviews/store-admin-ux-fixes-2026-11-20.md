# 스토어·관리자 사용성 수정 4건 — 실행 기록 (2026-11-20)

플랜 `docs/plans/store-admin-ux-fixes-2026-11-20.md`(삭제)를 실행했다. 휴대폰 인증 모달의 고정 안내문을
걷어내고(A), 클레임 요청 버튼을 화면 폭에 맞추고(B), 상세 화면의 사진을 눌러 크게 볼 수 있게 하고(C),
토스페이먼츠 관리자 센터의 주문번호로 관리자 주문을 찾을 수 있게 했다(D).

## 한 일

- **A** `apps/store/src/features/my-page/ui/phone-verify-modal.tsx` — `Modal`의 `description`과 하단
  "5분 유효·60초 후 재전송" 캡션을 지웠다. "이미 인증번호를 보냈습니다" 콜아웃은 그대로다.
- **B** `apps/store/src/features/claims/ui/claim-form-modal.tsx` — footer 버튼에 `width="full"`.
  버튼은 원래부터 하단 고정이었고(`Modal`의 `footer`) 폭만 빠져 있었다.
- **C** `packages/shared/src/components/zoomable-image.tsx` 신규(`ZoomableImage` — `ImageFrame` + 확대
  `Modal`). 붙인 곳: 스토어 주문 상세(`pages/order/detail.tsx`의 `SignedOrderImage` — 주문 참고 이미지·
  수선 발송 사진), 스토어 견적 요청 상세, 스토어 후기 목록(썸네일 600, 확대 1200), 관리자
  `shared/ui/private-asset-preview.tsx`(주문·수기 주문·견적·클레임 상세의 고객 첨부).
  `packages/shared/AGENTS.md` 색인 표에 행 추가.
- **D** `apps/api/src/api/domains/admin/orders.py` — 주문 목록 검색어가 UUID면 `payment_group_id`
  (= Toss `orderId`) 정확 일치도 결과에 넣는다. 관리자 검색창 라벨을 "주문번호·토스 주문번호 검색"으로
  바꾸고, 주문 상세 "결제·클레임" 탭에 "토스 주문번호" 행을 추가했다. `docs/api-spec/domains.md` §10에
  검색 규칙 한 줄 추가. 스키마·OpenAPI 변경 없음.

## 검증

- `uv run pytest apps/api/tests/test_admin_orders.py`(묶음 결제 검색 테스트 추가, 23건), `@essesion/shared`
  테스트(`zoomable-image.test.tsx` 추가, 75건), 영향받는 스토어·관리자 테스트, `pnpm lint`,
  `pnpm typecheck`, ruff, pyright, `pnpm architecture:check` 통과.
- 브라우저 확인. 떠 있던 API(8000)가 옛 코드였고 3000번은 다른 프로젝트가 쓰고 있어, API 8010·스토어
  3010·관리자 3011을 따로 띄워 봤다.
  - A — 375×667에서 모달 높이 310px, 번호·발송 버튼·인증번호·"인증 완료"가 스크롤 없이 한 화면.
  - B — 375폭에서 "취소 요청하기"가 좌우 24px 여백을 뺀 327px. 본문을 끝까지 스크롤해도 버튼 위치가 같다.
  - C — 스토어 주문 상세의 수선 발송 사진(149px 칸)을 누르면 모달 폭(327px)으로 뜨고 Esc로 닫힌다.
    관리자 주문 상세에서는 280px 미리보기가 512px로 뜬다.
  - D — 토스 UUID로 검색하면 해당 주문 한 건이 나오고, `ORD-` 부분 검색은 전과 같다. 주문 상세에 UUID 표시.

## 확인하지 않은 것

- 실기기. 키보드가 올라왔을 때 A의 입력칸·B의 버튼이 가려지는지는 보지 못했다. 가려지면 모달 높이 상한
  (`--size-modal-max-height`)이 키보드를 반영하는지부터 본다.
- C의 후기 목록(로컬에 사진 있는 후기가 없다)과 견적 상세(로컬 견적이 보관 기간이 지나 사진 주소를 받지
  않는다 — 버튼이 비활성으로 나오는 것까지 확인). 둘 다 주문 상세와 같은 컴포넌트다.
- C에서 서명 URL(15분)이 만료된 뒤 확대했을 때. 썸네일과 같은 URL이라 브라우저 캐시로 풀릴 것으로 보지만 추정이다.
- D에 토스 관리자 센터에서 실제로 복사한 값. 하이픈 없는 형식이면 UUID로는 해석되지만, 앞뒤에 다른
  글자가 붙으면 빈 결과가 된다.
- 로컬 fake-gcs 버킷이 비어 있어, 확인용으로 E2E 수선 주문·견적의 객체 키 세 개에 저장소의 PNG를 올렸다.

## 하지 않기로 한 것 (재론 조건)

- 공용 `Modal` footer 구분선 — B 이후에도 "고정인지 모르겠다"가 나오면.
- 공용 `Modal`의 `description`을 본문과 함께 스크롤 — 다른 모달에서 긴 `description` 제보가 나오면.
- 모달 안의 사진 확대(후기 보기 모달, 관리자 후기 삭제 확인창) — "모달 위 모달 금지".
- 상품 상세 이미지·관리자 후기 목록 썸네일·주문 제작 참고 슬롯의 확대, 핀치 줌·넘기기 — 요청이 나오면
  `ZoomableImage`로 붙인다.
- 토스 `orderId`를 주문번호로 바꾸기, `orderName`에 주문번호 넣기 — 돈 경로 계약이고 묶음 결제는 주문번호가
  여러 개다. 검색으로도 대조가 번거롭다는 제보가 나오면 `orderName`부터 재론한다.

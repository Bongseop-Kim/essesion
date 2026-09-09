# 관리자 수기 주문: 확인 처리 버튼 + 수선 품목 "키·넥타이 길이" 표기 (2026-09-09)

플랜 `docs/plans/admin-manual-repair-confirm-and-tie-length.md`(실행 완료 후 삭제)를 그대로 실행했다.
관리자(admin)만 바뀌었고 스토어(고객용) 화면·스키마는 건드리지 않았다.

## 한 것

- **API** `apps/api/src/api/domains/admin/manual_orders.py`
  - `PATCH /admin/manual-orders/{id}/status` — `is_confirmed`만 갱신. 낙관적 잠금은 PUT과 동일(`expected_updated_at` 불일치 시 409 `stale_resource`).
  - `ManualAutomaticSpec.wearer_height_cm: float | None` 선택 필드 추가. `total_length_cm`(넥타이 길이)은 필드명 유지·필수 유지. 품목은 JSONB라 Alembic 없음.
  - `docs/api-spec/domains.md` 수기 주문 문단에 한 줄 추가. `pnpm codegen`으로 api-client 재생성.
- **admin 수기 주문 상세** `apps/admin/src/pages/manual-orders/detail.tsx` — "확인 처리 / 확인 취소" 토글 버튼(수정 버튼 앞). 성공 시 상세 캐시 교체 + 목록 invalidate, 409면 재조회. "[자동] 총장" → "[자동] 넥타이 길이", 키가 있으면 "[자동] 키" 행 추가.
- **admin 수기 수선 폼** `manual-order-form.tsx` — "[자동] 키"(선택) + "[자동] 넥타이 길이"(필수). 키 입력 시 `recommendedTieLengthCm`로 길이를 자동 채우고(덮어쓰기), 이후 수정 가능.
- **환산 함수** `apps/admin/src/shared/lib/tie-length.ts` — `Math.round(0.4 × 키 − 19)`. 스토어 reform 안내표(150→41 … 190→57)와 일치하는지 테스트가 9행 전부 고정.
- **admin 스토어 수선 주문 상세** `apps/admin/src/pages/orders/detail.tsx` — "[자동] 착용자 키" → "[자동] 키", 그 아래 "[자동] 넥타이 길이 Ncm (키 기준 권장)" 표시.

## 검증

- `uv run pytest apps/api/tests/test_admin_manual_orders.py` 11 passed (PATCH 정상·409 케이스 추가).
- admin vitest 250 passed(상세 확인 버튼 테스트, 키→길이 자동 채움·수정 테스트, 환산표 테스트 추가), `pnpm --filter admin typecheck`, `pnpm lint`, `ruff`, `pyright` 클린. codegen 드리프트 없음.
- 브라우저(Aside, localhost:3001): 수기 수선 상세에서 "확인 처리" 클릭 → 버튼 "확인 취소"로 전환·수정시각 갱신·스낵바, 다시 클릭해 원복. 수정 화면에서 키 172 입력 → 넥타이 길이 50 자동 입력 → 48로 수정 유지. 스토어 수선 주문 상세에 "[자동] 키 175cm", "[자동] 넥타이 길이 51cm (키 기준 권장)". 콘솔 오류 없음.

## 남긴 것

- 접수·결제 배지 토글은 만들지 않았다. 필요하면 `ManualOrderStatusPatch`에 필드만 추가.
- 스토어 수선 주문의 길이는 키 기준 권장값 표시만 — 관리자가 덮어쓰는 저장 필드는 없다.
- 안내표와 환산식이 따로 살아 있다. 표를 바꾸면 `tie-length.test.ts`가 먼저 깨진다.

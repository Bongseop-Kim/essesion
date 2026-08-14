# 로컬 Aside 전체 점검 후속 조치 — 2026-08-14

## 판정

`PASS` — 전체 점검에서 발견한 B1·B2·D2·F1 네 결함을 수정하고 관련 자동 검사와 로컬 Aside 재검증을 통과했다.

## 수정 결과

| Finding | 결과 | 수정·확인 |
|---|---|---|
| B1 seed 상품 `option_label` | PASS | 옵션 seed 상품에 `길이`를 지정하고 빈 기존 행만 멱등 보정한다. admin에서 재고 2→0 저장 후 store 품절, 0→2 원복 후 구매 가능 상태를 확인했다. |
| B2 focus 복귀 갱신 | PASS | store/admin 공통 query 정책을 fresh 여부와 무관한 focus refetch로 변경했다. 예시 게시 on↔off, 구성 수정 단가 2↔3, 상품 재고 2↔0, 토큰 933↔934를 reload 없이 갱신하고 모두 원복했다. |
| D2 예시 session 생성 | PASS | 기존 Alembic head DB에 남은 `recraft_used`를 모델의 `motif_generation_used`로 보정하는 revision을 추가하고 안전한 사용자 오류 문구를 적용했다. `와이드 사선 스트라이프`와 `정규 격자` 모두 이력 `1 / 1`을 만들었고 토큰은 933으로 유지됐으며 `Failed to fetch`가 노출되지 않았다. |
| F1 modal 키보드·semantics | PASS | shared modal에 명시적 이름 있는 dialog semantics와 `aria-modal`을 보장하고, 조건부 unmount에서도 열기 전 trigger로 focus를 복원한다. store 쿠폰 선택과 admin 토큰 조정 modal에서 Escape 닫힘·중첩 없음·focus 복귀를 확인했다. |

## 자동 검사

- API: seed·design example 관련 8 tests PASS
- migration: 빈 PostgreSQL base→head와 model drift 검사 PASS, 로컬 기존 DB `c7a8d2f1b604 (head)`, `alembic check` PASS
- store: query 정책·design error/page 관련 31 tests PASS
- admin: provider query 정책 1 test PASS
- shared: 전체 64 tests PASS, store/admin/shared typecheck PASS
- 대상 Python ruff·pyright, 대상 Biome, `git diff --check` PASS

## Aside 환경과 제한

- URL: store `http://localhost:3000`, admin `http://localhost:3001`, api `http://localhost:8000`, worker `http://localhost:8001`
- store/admin console error 0, pageerror 0
- Aside의 여러 탭은 모두 `document.visibilityState=visible`로 유지된다. 실제 사용자의 탭 복귀와 동일한 TanStack Query 경로를 검증하기 위해 `window.visibilitychange`를 발생시킨 뒤 reload 없이 결과를 대조했다.
- claim·quote는 완료 상태가 비가역이라 기존 데이터를 재전이하지 않았다. 이 query들도 예외 없는 공통 `refetchOnWindowFocus: "always"` 정책을 사용한다.
- Aside가 실제 viewport 변경을 지원하지 않아 390×844 F2는 기존과 같이 미판정이다. 승인 없는 유료 authoring과 그 종속 lane도 실행하지 않았다.

`[E2E] 대상: 전체 점검 후속 4건 | 결과: PASS | 미실행:유료 authoring, 실제 390×844 viewport, 외부 provider/staging`

# 로컬 Aside 화면·흐름 점검 — 2026-08-13

## 판정

`FAIL` — B1 fresh seed 상품 편집 회귀가 재현되어 fail-fast로 종료했다.

- 실행 ID: `PREDEPLOY-20260813-1809`
- 실행 시간: 2026-08-13 18:09–18:47 KST
- 대상: `feat/cal` / `0df35ce5e0e3218e8a95fe5a6ce61dda07038f09`
- 시작 시 작업 트리: clean, 실행 중 플랜 문서만 수정
- URL: store `http://localhost:3000`, admin `http://localhost:3001`, api `http://localhost:8000`, worker `http://localhost:8001`
- 화면 크기: 브라우저 실제 content viewport 2280×1241, 실패 증거 1440×900
- provider mode: Toss `dry_run`, Solapi `dry_run`, worker `local`, finalize `inline`
- 외부 호출: OpenAI authoring 0, GPT Image 0, 실 Toss 0, DryRun Toss 0, 실 Solapi 0, DryRun Solapi 0

## 실행 결과

| Phase/lane | 결과 | 증거 |
|---|---|---|
| A1 실행 대상 | PASS | CI·lint·build·typecheck는 사용자 요청에 따라 범위 밖으로 두고 로컬 작업 트리를 기록했다. |
| A2 환경 | PASS | 모든 포트 응답 정상, Alembic `b9e4f61a2c73 (head)`, 무료 시드 3종 성공. |
| A3 Aside | PASS | Aside 로그인·MCP 연결 정상, store/admin 탭에 오류 listener 연결. |
| B1 fresh seed 상품 편집 | FAIL | `3F-SEED-002`의 옵션 묶음 이름이 비어 있어 재고 변경 저장이 클라이언트 validation에 막혔다. |
| B2–F | 미실행 | B lane 하나라도 실패하면 후속 lane을 중단한다는 fail-fast 규칙 적용. |

## Finding

### E2E-B1 — 옵션이 있는 seed 상품을 admin에서 저장할 수 없음

- 심각도: High
- 배포 차단: 예
- 조치 필요: 예
- 재현:
  1. `apps/api/scripts/seed.py`를 실행한다.
  2. admin 상품 관리에서 `3F-SEED-002`를 열고 수정한다.
  3. 옵션 재고를 `2`에서 `0`으로 바꾸고 `상품 변경 저장`을 누른다.
- 기대: 옵션 묶음 이름이 채워져 있고 상품 변경이 저장된다.
- 실제: `옵션 묶음 이름을 입력해 주세요.`가 나타나 저장 요청이 나가지 않는다.
- 영향: fresh seed 환경에서 해당 상품의 가격·재고·옵션을 admin으로 관리할 수 없다.
- 원인 근거: seed는 `ProductOption` 행을 만들지만 `Product.option_label`을 지정하거나 기존 seed 상품에 backfill하지 않는다.
- 증거: [B1 실패 화면](assets/pre-deploy-aside-e2e-2026-08-13-b1.png)

저장 요청 전 validation 실패였으므로 DB 재고는 바뀌지 않았다. 변경 취소 후 옵션 재고 `2`가 복원된 것을 확인했다. 수집 시점의 store/admin console error, pageerror, 예상하지 않은 4xx/5xx는 모두 0건이었다. Aside 세션이 마지막 logout 호출 전에 종료되어 admin logout만 확인하지 못했다.

## 결론

`[E2E] 대상: 로컬 Aside 화면·흐름 점검 | 결과: FAIL(1건) | 실패:B1 seed 상품 option_label 누락으로 저장 불가 | 후보:0df35ce`


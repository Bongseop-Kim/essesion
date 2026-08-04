# 디자인 플로우 E2E 후속 조치 결과 — 2026-08-04

`docs/reviews/design-flow-e2e-2026-08-04.md`의 발견 7건 처리. 회귀 3건은 고쳤고, 나머지는
시드 보정 1건·플랜 편입 1건·문서 정정 2건이다. 새 테이블·새 로그 타입은 만들지 않았다.

## 조치

| # | 발견 | 결과 | 변경 |
|---|---|---|---|
| 1 | 온보딩 `닫기`가 완료를 저장 안 함 | 고침 | `design-overlays.tsx` — 닫힘 경로 전체에서 `completeDesignOnboarding()` |
| 2 | 현재 세션 삭제 후 다른 세션 자동 선택 | 고침 | `pages/design/index.tsx` — `openSession(null, true)` |
| 3 | 열린 store 탭이 admin 단가 변경을 반영 안 함 | 고침(잔액 한정) | `queries.ts` — 토큰 잔액 쿼리만 `staleTime: 0` + `refetchOnWindowFocus` |
| 4 | Recraft 생성의 세션 상관 불가 | 기존 컬럼 노출 | `MotifDetailOut`에 `ingested_user_id`·`ingested_session_id`, admin 모티프 상세에 2행 |
| 5 | 시드 고객 토큰 원장 0건 | 고침 | `seed.py` — `_ensure_initial_tokens` (멱등) |
| 6 | lattice가 페이즐리 모티프를 잃음 | 편입 | `docs/plans/few-shot-reverse-eval.md` P2에 S3b 프롬프트 1건 추가 |
| 7 | A5 산출물 키 확인 불가 | 문서 정정 | 아래 "다음 E2E 기준" |

### 4번을 새 generation log로 만들지 않은 이유

`seamless_generation_logs.input_type`의 CHECK가 `prompt|intent`라 `motif_generation` 행을
추가하려면 마이그레이션 + 워커 기록 + admin 라벨 + codegen 4단 변경이 된다. 필요한 정보는
이미 `motifs.ingested_user_id`·`ingested_session_id`에 기록되고 있었고 노출만 없었다
(레포 전체 grep 0건). 노출만 했다 — DDL 변경 없음.

### 3번을 전역으로 켜지 않은 이유

store `queryClient`는 `refetchOnWindowFocus: false` + `staleTime: 5분`이 기본이다. 실제 피해는
`design_edit_cost` 오표시(금액) 하나이고 그 값은 토큰 잔액 응답에 실려 온다. 디자인 예시
갤러리 게시 순서(A6)는 금액이 아니라 그대로 뒀다.

## 검증

| 검사 | 결과 |
|---|---|
| `pnpm lint` | PASS (biome + check-harness) |
| `pnpm turbo typecheck test` | PASS — store 51파일 207테스트, admin 전체 |
| `uv run pytest` | PASS — 1218 passed (7분 41초) |
| `uv run ruff check .` / `uv run pyright` | PASS / 0 errors |
| 시드 멱등 | 임시 DB `seedcheck`에 마이그레이션 후 `seed.py` 2회 → `design_tokens` 1행·30토큰 |

추가한 테스트 2건(온보딩 닫기 저장, 세션 삭제 후 빈 캔버스)은 **수정 전 코드에서 실제로 실패**하는지
되돌려 확인했다. admin은 api 상세 응답 단언 1건과 메타데이터 행 집합 갱신.

`pnpm turbo build`는 `VITE_API_BASE_URL` 미설정으로 admin에서 실패한다 — 이 변경과 무관한
기존 로컬 환경 조건이다.

### 브라우저 확인 (Aside, localhost)

- `admin :3001 /motifs/recraft-d9464afeac8b` — 실제 E2E Recraft 모티프(재봉틀)에서
  `최초 요청자` 링크(`/customers/eb099f8f-…`)와 `최초 요청 세션`(`ff39a5a2-…`)이 표시됐다.
  console error 0.
- `store :3000 /design` — 온보딩 X로 닫은 뒤 `localStorage["design:onboarding:v1"] === "1"`,
  reload 후 재노출 없음. console error 0.
- 2번(세션 삭제)은 브라우저로 확인하지 않았다 — 로컬 E2E 세션을 실제로 삭제해야 해서
  단위 테스트(수정 전 실패 확인 완료)로 갈음했다.
- 3번의 포커스 리페치는 Aside 세션에서 `page.on("request")`가 전혀 잡히지 않아 네트워크로
  관측하지 못했다. Vite가 서빙하는 모듈에 옵션이 반영된 것까지만 확인했다.

## 다음 E2E 기준 (플랜 드리프트 정정)

- **A5**: finalize 상세는 보안상 GCS 객체 키를 숨긴다. 확인 항목은 "산출물 키 원문"이 아니라
  **결과 객체 존재 + 공개 링크 열림**.
- **S14**: 세션 개수 기대치를 고정 숫자로 쓰지 말 것 — S3b가 새 세션 2건을 만든다. 직전 단계까지
  생성한 수를 그 자리에서 세어 기준으로 삼는다.
- **S1**: 5번 조치 후 시드 고객의 시작 잔액은 30으로 고정된다. Toss 테스트 결제 보정 불필요.

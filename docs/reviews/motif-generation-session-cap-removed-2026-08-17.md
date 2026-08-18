# 모티프 생성 세션 상한(3회) 제거 — 2026-08-17

`design_motif_generation_budget=3`은 구 seamless-tile LangGraph 세션 예산의 잔재였다
(`worker-pipeline.md`가 "재구현에서 세션 계층 전체 미승계"라고 적어 둔 그 예산). 같은 문장의
finalize 10회는 계정당 24시간 쿼터 + `admin_settings`로 갈아탔는데 모티프 생성만 세션 카운터로
남아 있었다.

토큰 모델에서 근거가 없다. `money.md §6`의 손익 가드가 이미 서 있고 그 방어선 3종
(`DEFAULT_QUALITY="low"`, 워커 `motif_generate_per_request_limit`, 100토큰 단가)에 세션 3회는
들어 있지 않다. 게이트가 둘이면 "토큰은 있는데 더 못 만드는" 상태만 생겼고, 이 값만
`admin_settings`가 아닌 env라 운영자가 못 바꿨다.

**워커의 `MotifGenerationBudget`은 남긴다** — 이름만 비슷한 요청 범위 provider 호출 상한이고
`money.md §6`이 지목한 실제 원가 방어선이다.

컬럼 드랍은 revision `d4e9a71c3b58`. 잔재를 남기지 않기로 해서 api 설정·게이트·보상 환급,
`motif_generation_used`·`motif_generation_remaining` 응답 필드, store의 prop 체인과 문구,
`docs/api-spec/` 4개 문서를 함께 지웠다.

## 부수 정정

`domains.md`와 `worker-pipeline.md`는 이 경로를 **0토큰**으로 적고 있었다. 실제 코드와
`money.md §6`은 `design_motif_generate_cost`를 차감한다 — 세 문서 중 둘이 낡아 있었다.

과거 review 2건(`motif-adapter-gpt-image-transition-2026-08-12.md`,
`pre-deploy-e2e-followups-2026-08-14.md`)에 이 카운터가 언급된 채 남아 있다 — 그때의 작업
기록이라 고치지 않았다. 살아 있는 계약은 `docs/api-spec/`이 정본이다.

## 검증

`test_motif_generate_budget_exhaustion`(3회 후 409)을 `test_motif_generate_has_no_per_session_cap`
으로 교체했다 — 같은 세션 4회 연속 200, 잔액이 마르면 409가 아니라 400 `insufficient_tokens`.
alembic 왕복, `ruff`·`pyright`·`biome`·`typecheck`·`architecture:check`, `test_design.py` 78
passed, store 222 passed, `pnpm codegen` 재생성.

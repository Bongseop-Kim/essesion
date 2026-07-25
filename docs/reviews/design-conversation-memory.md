# 디자인 대화 메모리 실행 리뷰

실행일: 2026-07-24  
원 지시서: `docs/plans/design-conversation-memory.md` (완료 후 제거)

## 결과

- `DesignSession`의 `current_plan`, `context_version`, active generation ID·시각과 턴 role/active pair/context version DB check constraint를 미배포 단일 베이스라인 `dadd999bf858`에 포함했다.
- 생성 시작은 세션 lock 안에서 active run 확인, run-scoped 토큰 차감, 사용자 턴·첨부 저장을 원자 커밋한 뒤 worker를 호출한다. 성공·실패는 같은 run ID로 assistant 턴을 남기고 active 상태를 해제하며, 실패는 실제 차감 bucket을 멱등 환불한다.
- stale generation은 기존 finalize stale window를 재사용해 만료 뒤에만 회수한다. 회수 시 환불·오류 턴을 기록하고, 동시 요청과 context version race는 외부 호출 전에 거부한다.
- 일반 생성에서 client 제공 intent를 제거했다. `session_id` 소유권을 확인해 마지막 선택의 `current_plan`/`current_intent`와 선택된 성공 턴 최대 6쌍만 `ConversationContext`로 구성한다. 실패·미선택 결과, SVG, 후보 응답, provider 오류, 과거 사진 binary는 제외한다.
- 후보 선택을 `/design/sessions/{id}/select` 서버 액션으로 바꿨다. 최신 성공 run의 candidate ID를 generation log에서 찾아 후보별 intent와 concrete motif ID로 동결된 plan을 함께 원자 커밋한다. 클라이언트의 기존 patch+turn 2단계 쓰기는 제거했다.
- 공개 턴 추가 API는 UI 표시용 finalize 턴만 받는다. 생성 결과와 선택 턴은 서버 액션만 기록할 수 있어, 클라이언트가 가짜 선택 턴으로 다음 문맥을 오염시키는 우회도 닫았다.
- `다시 만들기`는 `/design/sessions/{id}/reroll`로 분리해 서버의 선택된 intent만 사용한다. pending prompt·첨부는 variation에 섞이지 않는다.
- worker 초기 저작은 모든 plan이 같은 canonical motif source 집합인지 하드 가드로 검사한다. motif 정체성도 structural fingerprint에 포함해 색만 다른 후보뿐 아니라 주제가 바뀐 후보를 구조 변주로 인정하지 않는다.
- refine은 현재 design을 권위 블록으로 전달하고 `DesignPlanV3` 하나를 전체 재저작한다. 요청 범위 밖 palette·motif·stripe·motif geometry는 결정론적 preserve 가드가 원복하고, 단일 compiled intent는 엔진이 최대 4후보로 팬아웃한다.
- 선택 plan은 soft-drop 뒤 살아남은 layer와 resolved concrete motif ID를 `catalog_ref` carrier로 스냅샷한다. Gemini 전송 직전에만 `current_motif_N` alias로 치환하므로 private/content-hash ID와 과거 사진을 provider에 다시 보내지 않는다.
- Store는 새 select/reroll API와 run ID를 사용하고 provider 실패 턴을 대화 피드에 계속 표시한다. OpenAPI와 `packages/api-client`를 함께 재생성했다.
- 선행 motif-generation 작업의 generate-on-miss 공유 budget과 이번 canonical source-set guard가 결합되어 T-M3도 추가 작업 없이 충족했다.
- Ponytail 정리(2026-07-25): 미사용 세션 PATCH, turn payload 재검증 registry, 공개 `generation_log_id`·`intents`, Store의 레거시 후보 추론을 제거했다. worker `run_id`는 필수로 고정했고, 최신 성공 턴은 JSONB 조건으로 한 행만 조회하며 refine layer 병합은 한 번만 순회한다.
- Ponytail 후속 리뷰(2026-07-25): 보존어를 직접 연결된 범주에만 적용하고 motif 정체성·기하·색상 권한을 레이어 필드별로 분리했다. Store는 최신 성공 run만 선택 가능하게 했고 worker의 `refine` 진단 모드를 API client와 Admin까지 노출했다. 대화 상태와 motif 메타데이터 migration은 미배포 정책에 맞춰 단일 베이스라인으로 다시 합쳤다.

## 결정한 열린 질문

- refine 후보 축은 모델 재호출이 아니라 기존 엔진 `generate_candidates`의 seed/layout/colorway 변주, 최대 4개로 정했다.
- preserve 범위는 최신 요청의 색·motif·stripe·geometry 키워드를 좁게 분류하고 미허용 section을 현재 plan에서 복원하는 화이트리스트 방식으로 정했다.
- concrete motif snapshot은 `DesignPlanV3`의 `source="catalog"` + 실제 ID `catalog_ref`로 저장하고 provider 경계에서 요청 로컬 alias로 치환한다.

## 검증

- Alembic 단일 베이스라인 `head → base → head` 왕복과 model drift 검사 — 통과
- `uv run pytest` — 915 passed, 188 subtests passed
- worker 전체 테스트 — 446 passed
- worker authoring/motif resolver/API 집중 테스트 — 109 passed
- API 디자인 통합 테스트 — 69 passed (실제 testcontainers Postgres)
- `uv run ruff check .` — 통과
- `uv run pyright` — 0 errors
- `pnpm codegen` — 통과, OpenAPI/api-client 재생성
- 검증용 공개 환경값을 주입한 `pnpm turbo build typecheck test` — 11 tasks 통과, Vitest 512 passed
- Git 추적 파일 기준 Biome 513개 및 `check-harness.mjs` — 통과

Ponytail 정리 후 `pnpm codegen`, 관련 Python 통합 테스트 90개, worker generate·adapter 계약 테스트 65개, `pnpm turbo typecheck test`(9 tasks, Vitest 509개), `uv run ruff check .`, `uv run pyright`를 다시 통과했다.

`pnpm lint`의 원형 명령은 Git에서 무시되는 개인 파일 `.claude/settings.local.json`의 기존 포맷 차이로 중단됐다. 해당 파일은 수정하지 않았고, 같은 Biome 검사를 Git 추적 파일 전체에 적용한 뒤 harness를 별도로 통과시켰다.

후속 리뷰 반영 뒤 `uv run pytest` 920개, `pnpm turbo build typecheck test --concurrency=1` 11 tasks, Git 추적 파일 Biome 523개, harness, Ruff, Pyright, codegen과 Alembic 단일 베이스라인 왕복·drift 검사를 통과했다.

## 남은 운영 작업

코드 작업은 완료했다. 스테이징 배포, 실제 provider 경로의 대화 refine E2E, 모니터링은 기존 `docs/CHECKLIST.md`의 배포·리허설 항목에서 진행한다.

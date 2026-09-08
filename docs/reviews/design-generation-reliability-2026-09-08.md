# 디자인 생성 복구·잔액·조회 오류 개선

실행일: 2026-09-08

상태: 완료 (플랜 `docs/plans/design-generation-reliability.md` 6항목 전부 — 실행 후 플랜 삭제).

## §1 유료 액션 종료 후 잔액 갱신

- `use-motif-search.ts` `generate`의 `finally`에 `getTokenBalanceQueryKey()` 무효화 추가 —
  성공(차감)·실패(환불) 모두 잔액이 움직이므로 같은 화면의 pill을 맞춘다. 기존
  `listUserMotifs` 갱신은 유지.
- `use-design-output.ts` finalize mutation에 `onSettled`로 잔액 무효화 추가. 기존
  `onSuccess`의 세션·턴·완성본 갱신은 성공에서만 돈다(실패에 불필요한 재요청을 만들지 않는다).

## §2 세션 복원 실패와 빈 디자인의 구분

`pages/design/index.tsx`:

- 세션 목록·단건·이력 세 쿼리의 `isError`를 모아 `restoreFailed`를 만들고, **캔버스에 그릴
  게 없을 때만**(`!history.currentSvg`) `restoreLost`로 승격한다. 즉 "데이터가 없다"가 아니라
  "화면에 지킬 게 없다"가 판정 기준이다. 첫 조회 실패든 재조회 실패든 같은 규칙을 쓴다.
- `restoreLost`: 캔버스 자리에 shared `ContentPlaceholder`(다시 시도 / 새로 시작)를 그리고
  입력창을 잠근다. "새로 시작"은 `freshSession=true`라 그 즉시 잠금이 풀린다 — 명시적인 새
  작업 시작은 허용한다는 규칙.
- 그림이 남아 있는 실패: 캔버스·이력을 그대로 두고 페이지 상단 공지 한 줄(다시 시도)만 띄운다.
- 기존 "진행 중이던 생성이 있어요" 배너를 로컬 `PageNotice` 컴포넌트로 뽑아 세 경우(복원 실패 /
  대기 상한 초과 / 다른 세션의 pending)가 우선순위대로 한 자리를 쓴다 — 페이지 공지는 1개 규칙.

## §3 진행 중 생성의 서버 상태 복원

- `queries.ts`: `designSessionQueryOptions`에 `refetchInterval` 추가. `active_generation_id`가
  있는 동안만 2초(`ACTIVE_GENERATION_POLL_MS`)로 재조회하고, 조회가 실패한 쿼리는 **스스로 다시
  돌지 않는다**(안내 + 수동 재시도로 넘긴다).
  - 플랜에 없던 추가: api의 worker 대기 상한(`worker_timeout_seconds` 180s)을 넘긴
    4분 이후에는 30초로 내린다. 2초 × 상한 75분은 세션 GET 2,250회라 Cloud Run 요청 과금이
    무의미하게 커진다. 상한 자체는 플랜대로 api의 `STALE_GENERATION_JOB_AFTER`(75분)와 맞췄다.
- `use-active-generation.ts`(신규 훅): 세션 단건 응답만 보고
  `{recovering, expired}`를 만든다. 상한 초과는 경과 시간을 매 렌더 계산하는 대신 남은 시간만큼의
  `setTimeout` 1개로 전환한다(폴링이 리렌더를 보장하지 않으므로).
  - `recovering`이면 `busy`에 합류해 편집·모티프 교체·되돌리기·내려받기·새 세션을 잠근다.
  - 진행 중 → 종료가 관찰되면 이력·잔액·세션 목록을 무효화하고 복구 표시를 지운다.
  - 이미 완료된 세션은 한 번의 조회로 끝난다(진행 중을 본 적 없으면 재조회하지 않는다).
  - 세션을 바꾸면 관찰 상태를 리셋해 이전 세션의 종료를 새 세션에 적용하지 않는다.
  - 상한 초과에서는 잠금을 풀고 "다시 확인" 공지를 낸다. 성공·환불 판정은 하지 않는다.
- `use-generate.ts`: pending 표시를 **서버가 응답했을 때만** 지운다. 새 헬퍼
  `isServerRejection()`(errors.ts)이 api 오류 본문 계약 `{code, detail}`로 판정한다 — fetch가
  끊긴 실패는 서버가 완료했을 수 있으므로 표시를 남겨 복구 조회가 잇는다.
- `openSession()`은 같은 세션을 다시 열어도 세션 단건 쿼리를 명시적으로 무효화한다.
- 자동 재전송은 없다 — 서버가 진행 중이면 관찰만 한다.

## §4 미완료 차감 기록 (`token_works`)

- 새 표 `token_works`(리비전 `b7f4c2e18d05`): `work_id`(PK, 원장 멱등 키와 같은 값) · `user_id` ·
  `kind`(`motif_generate|design_finalize`) · `status`(`pending|succeeded|refunded`) ·
  `started_at` · `deadline_at` · `finished_at` · `result_id`. 프롬프트·이미지·intent는 넣지 않는다.
  `user_id` FK는 NO ACTION이라 탈퇴가 증거를 지우지 않는다(원장과 같은 규칙 — `_has_history`가
  `type='use'` 원장을 이미 이력으로 취급하므로 하드 삭제와 공존할 수 없다).
- 새 모듈 `api/domains/tokens/work.py`: `start`(차감과 같은 트랜잭션에 pending 추가) ·
  `claim`(사용자 advisory lock → 행 `FOR UPDATE`, 상태·기한 재검사) · `finish` ·
  `release`(원장 반전 + refunded 전환을 한 트랜잭션, 이미 종결이면 no-op).
- 모티프 생성: 차감 + pending을 한 커밋으로. 성공은 라이브러리 링크와 succeeded 전환을 한
  트랜잭션으로 커밋하고, 그 커밋이 실패하면 종결만 다시 커밋한다 — `saved=false` 성공 계약을
  지키면서 성공한 생성이 환불 대상으로 남지 않게 한다.
- 실사화: 차감 + pending을 한 커밋으로. `GenerationJob` INSERT와 succeeded 전환을 한
  트랜잭션으로. 실패는 `token_work.release`로 반전 + refunded를 한 트랜잭션으로.
- refunded 위에는 결과를 게시하지 않는다 — `motif_generate_expired`(409) ·
  `finalize_expired`(409). 두 코드는 `detail` 한글 문구를 그대로 쓰므로 프론트 변경이 없다.
- `_shielded`는 그대로 두되 강제 종료 복구 수단으로 보지 않는다. 공개 보관함은 여전히 성공한
  `GenerationJob`만 반환하고 worker는 `token_works`를 읽지도 쓰지도 않는다.

## §5 복구 배치

- `POST /batch/recover-token-works` — `status='pending' AND deadline_at < now` 최대 100건,
  기한 순. 건별로 `token_work.release(deadline_before=now)`를 부르며 한 건의 실패는 로그만
  남기고 다음 배치로 넘긴다.
- `deadline_at = started_at + 15분`. `worker_timeout_seconds` 하나를 총 상한으로 보지 않았다 —
  httpx 타임아웃은 단계별이고 뒤에 결과 조회·라이브러리 저장·완성본 INSERT가 붙는다. 배치가
  5분 주기이므로 실제 환불은 기한 + 최대 5분.
- `infra/scheduler.tf`에 `recover-token-works = "*/5 * * * *"` 추가(기존 OIDC 패턴 그대로,
  배치 4종 → 5종).
- 기록 없는 오래된 차감은 자동 환불하지 않는다. 외부 호출을 재실행하지 않으며 회수 불가능한
  provider 비용은 서비스가 부담한다.

## §6 명세·클라이언트

- `worker-pipeline.md` §5: "환불 지점은 동기 경로뿐"을 정정하고 `token_works` 경유 복구를 명시.
  worker는 과금 상태를 읽지도 쓰지도 않는다는 문장 보강.
- `money.md` §6에 `token_works`(필드·기한·종결·복구 배치·늦은 완료 거절) 절 추가, §7 배치 목록에 한 줄.
- `domains.md` §11에 "미완료 차감 복구" 문단, `ARCHITECTURE.md` §7.4 배치 4종 → 5종.
- `pnpm codegen` 재실행 — 변화는 새 batch 엔드포인트 1개뿐(재실행 시 추가 차이 없음).

## 검증

| 항목 | 결과 |
|---|---|
| `pnpm --filter store test src/features/design src/pages/design` | 20 파일 · 118 통과 |
| `pnpm test` (전체 JS) | store 275 · admin 247 · shared 69 통과 |
| `uv run pytest apps/api/tests/test_design.py` | 80 통과 (신규 5) |
| `uv run pytest apps/api/tests/test_batch.py` | 14 통과 (신규 4) |
| `uv run pytest apps/api/tests/test_tokens.py test_token_adjustment_safety.py` | 23 통과 |
| `uv run pytest apps/api/tests/test_users_domain.py test_authz.py test_contract.py` | 234 통과 |
| `uv run pytest tests/test_migrations.py` | 2 통과 |
| `uv run alembic -c db/alembic.ini check` | 드리프트 없음 |
| `pnpm lint` · `pnpm typecheck` · `pnpm architecture:check` | 통과 (contracts 5 kept) |
| `pnpm build` | 통과 (`VITE_API_BASE_URL` 필요 — 로컬 env 미설정 시 admin 빌드가 먼저 실패) |
| `uv run ruff check .` · `uv run pyright` | 변경 파일 전부 통과 |

api 테스트는 전부 실제 Postgres(testcontainers)이며 DB·인가·원장을 mock하지 않았다.
외부 provider만 fake worker로 제어했다.

신규 백엔드 테스트가 덮는 조건:

- 차감과 pending 기록이 한 트랜잭션으로 남고 성공 시 `result_id`와 함께 succeeded로 닫힌다.
- 워커 실패는 환불 + refunded 전환.
- **차감 직후 프로세스 중단**: `except Exception` 보상 경로를 타지 않는 `BaseException`
  스탠드인으로 재현 → pending만 남고 환불 없음 → 기한 경과 후 배치가 정확히 한 번 환불(2회
  호출 시 두 번째는 0건).
- **늦은 성공과 복구의 경합**: worker 응답 중에 배치가 먼저 환불하도록 만들면 요청은 409
  `finalize_expired`로 끝나고 `GenerationJob` 행이 남지 않으며 환불은 한 번뿐이다.
- 기한 이내 pending·이미 종결된 기록·기록 없는 차감은 배치가 건드리지 않는다.
- 배치 인증 없이는 401.

### 브라우저 실측 (Aside)

`:3000`을 다른 프로젝트의 `next-server`가 점유하고 있어 store를 `:3010`으로,
api를 `FRONTEND_ORIGIN`·`CORS_ORIGINS`를 3010으로 덮어써서 띄우고 확인했다.
오류 주입은 **브라우저 안에서 `globalThis.fetch`를 감싸는 방식만** 썼다 — 서버 상태를 바꾸지
않고, 유료 provider도 부르지 않는다(api-client는 요청마다 `globalThis.fetch`를 재해석하므로
런타임 패치가 그대로 먹는다). 확인 뒤 패치는 새로고침으로 해제하고 3010·8000·8001을 다시 내렸다.

| 관찰 | 결과 |
|---|---|
| 세션 응답에 `active_generation_id`를 주입 | 입력창·실사화가 잠긴다 |
| 폴링 간격 | 5초 동안 세션 GET 2회 (≈2초 간격) |
| 주입을 끄면(서버가 종료 응답) | 잠금이 풀리고 이후 3초간 세션 GET 증가 0 — 폴링이 멈춘다 |
| 세션 단건 GET을 503으로 주입 + 같은 세션 다시 열기 | 넥타이 미리보기·이력 썸네일이 그대로 남고 상단 공지 "최신 상태를 불러오지 못했어요 … 다시 시도"만 뜬다(자리 표시로 바뀌지 않는다) |
| "다시 시도" | 공지가 사라지고 디자인이 유지된다 |
| 모티프 생성을 502로 주입(환불 경로) + 잔액 응답 변경 | pill이 5k → 4.3k로 갱신되고 포커스는 다이얼로그에 그대로 있다 |
| 콘솔·페이지 오류 | 전 과정 0건 |

E2E는 e2e-test-harness 기준상 실행 대상이 아니다(핵심 결제 경로 변경 없음, 계약 변경은 내부
batch 엔드포인트 1개).

로컬 dev DB에는 `alembic upgrade head`로 `b7f4c2e18d05`를 적용해 두었다.

## 남은 제한

- 상한(75분) 안에서 실제로 멈춘 생성은 프론트가 30초 간격으로 계속 조회한다 — 최악 약 150회.
  더 줄이려면 api가 stale 회수 시각을 응답에 실어 프론트가 그걸 보고 멈추는 편이 낫다.
- 디자인 생성(`/design/generate`)은 `token_works`를 쓰지 않는다 —
  `active_generation_id` + `STALE_GENERATION_JOB_AFTER` 회수가 이미 있고, 그 회수는 사용자가
  같은 세션에서 다시 생성할 때만 돈다. 다시 접속하지 않는 사용자의 생성 차감은 여전히
  복구되지 않는다. 통합하려면 두 기계를 하나로 합치는 별도 작업이 필요하다.
- `token_works` 행은 정리하지 않는다(성공·환불 이력이 계속 쌓인다). 부피가 문제가 되면
  종결 후 N일 경과분을 지우는 배치를 추가할 것.
- 이 변경 전에 이미 생긴 미완료 차감은 대상이 아니다(기록이 없다 — 플랜의 기각 대안대로
  원장만 보고 자동 환불하지 않는다).
- `db/README.md`의 리비전 체인 서술은 이 작업 전부터 5개 리비전만큼 낡아 있다(범위 밖).
- `apps/worker/scripts/eval_design_accuracy.py`(이 작업과 무관한 미추적 파일)에 ruff 오류 4건이
  남아 있다 — `uv run ruff check .`가 이 4건으로 실패한다.

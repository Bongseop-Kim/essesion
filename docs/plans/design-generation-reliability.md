# 디자인 생성 복구·잔액·조회 오류 개선

2026-09-08 코드 리뷰에서 발견한 네 가지 신뢰성 문제를 해결한다. 현재는 **미실행 제안**이다.
디자인 생성·모티프 생성·실사화의 동기 HTTP 구조를 유지하고, 서버 중단 시 과금 복구와
클라이언트의 결과 재조회만 보강한다. 아래 줄 번호는 리뷰 시점 기준이므로 실행 전 심볼을 다시 찾는다.

## 왜 필요한가

| 우선순위 | 코드 근거 | 문제와 발생 조건 |
|---|---|---|
| 높음 | [router.py](../../apps/api/src/api/domains/design/router.py):1979, 2398 | 실사화·모티프는 차감을 먼저 커밋하고 요청 내부 예외 처리에서 환불한다. 그 사이 프로세스가 종료되면 결과와 환불이 모두 없는 차감이 남을 수 있다. 프로세스 강제 종료 재현은 아직 하지 않았으며, 코드 경로에 근거한 위험 판단이다. |
| 높음 | [use-generate.ts](../../apps/store/src/features/design/model/use-generate.ts):121, [queries.ts](../../apps/store/src/features/design/model/queries.ts):23 | 통신 실패에도 pending 표시를 지우고 한 번만 재조회한다. 생성 중 새로고침하거나 재조회 이후 서버가 완료하면 화면에 결과가 자동 반영되지 않는다. |
| 중간 | [use-motif-search.ts](../../apps/store/src/features/design/model/use-motif-search.ts):408, [use-design-output.ts](../../apps/store/src/features/design/model/use-design-output.ts):102 | 유료 모티프·실사화 이후 잔액 캐시를 무효화하지 않아 같은 화면에서 이전 잔액을 계속 볼 수 있다. |
| 중간 | [index.tsx](../../apps/store/src/pages/design/index.tsx):129 | 세션·이력 조회의 로딩만 처리한다. 조회 실패를 빈 작업과 구분하지 않아 기존 디자인이 사라진 것처럼 보일 수 있다. |

리뷰 당시 생성·pending·쿼리 관련 기존 프론트 테스트 3개 파일, 13개는 통과했다.
이 결과는 위 실패 조건의 재현이나 해결을 증명하지 않는다.

이미 완료된 [잔액 조회 실패 UI·설정 시드 보강](../reviews/design-page-polish-and-dashboard-manual-orders-2026-08-21.md)은 제외한다.
[실사화 동기 전환](../reviews/finalize-sync-token-pricing-2026-08-19.md)도 재실행하지 않는다.
해당 전환에서 제거한 실행 큐와 별개로, 이번에는 미완료 차감의 대조 기록만 추가한다.

## 범위 밖

LLM·모티프 검색·패턴 품질·렌더 알고리즘·단가는 변경하지 않는다. 작업 큐, 워커 자동 재실행,
취소 API, 전체 화면 개편, 기존 원장의 일괄 소급 환불은 추가하지 않는다.

## 실행 조건

- 실행 전 현재 코드와 위 근거를 대조하고, 이미 해결된 항목은 제외한다.
- 과금 변경은 [money.md](../api-spec/money.md) §6와 [worker-pipeline.md](../api-spec/worker-pipeline.md) §5를 먼저 갱신한다.
  스키마는 [db/README.md](../../db/README.md)에 따라 Alembic으로만 변경한다.
- 실제 PostgreSQL을 쓰는 격리 테스트에서 중단·동시 완료·중복 환불을 검증할 수 있어야 한다.
  이 조건이 없으면 서버 과금 변경은 실행하지 말고 기다린다. 독립적인 프론트 항목은 진행할 수 있다.
- 운영 프로세스를 강제 종료하거나 유료 provider를 호출해 장애를 재현하지 않는다.
  별도 테스트 프로세스와 제어 가능한 worker 응답으로 재현한다. 사용자 로컬 서버도 임의로 종료하지 않는다.

## 절차

1. **유료 액션 종료 후 잔액을 갱신한다.**
   [use-motif-search.ts](../../apps/store/src/features/design/model/use-motif-search.ts):391과
   [use-design-output.ts](../../apps/store/src/features/design/model/use-design-output.ts):102의 종료 처리에
   `getTokenBalanceQueryKey()` 무효화를 추가한다. 성공과 실패 모두 적용하고 기존 라이브러리·완성본 갱신은 유지한다.
   근거: 동일 화면에서 사용자가 실제 차감·환불 결과를 볼 수 있어야 한다.
   성공·실패 각각 잔액이 갱신되는 작은 훅 테스트를 추가한다.

2. **세션 복원 실패를 빈 디자인과 구분한다.**
   [index.tsx](../../apps/store/src/pages/design/index.tsx):129에서 세션 목록·단건·이력 조회 실패를 처리한다.
   최초 조회 실패는 shared `ContentPlaceholder`와 해당 쿼리 재시도로 표시한다.
   기존 데이터가 있는 재조회 실패는 캔버스를 유지하고 재조회 실패 안내를 표시한다.
   복원 실패 중 새 세션 생성·편집·실사화 버튼은 잠그되 명시적인 새 작업 시작은 허용한다.
   근거: 서버 조회 실패가 작업 유실이나 신규 작업으로 오인되어서는 안 된다.
   [index.test.tsx](../../apps/store/src/pages/design/index.test.tsx)에 목록·단건·이력 실패와 재시도 성공을 검증한다.

3. **진행 중 생성의 서버 상태를 복원한다.**
   [queries.ts](../../apps/store/src/features/design/model/queries.ts):23,
   [use-generate.ts](../../apps/store/src/features/design/model/use-generate.ts):121,
   [index.tsx](../../apps/store/src/pages/design/index.tsx):140을 변경한다.
   단건 세션 응답의 `active_generation_id`가 있는 동안만 2초 간격으로 재조회하고 편집·교체·되돌리기를 잠근다.
   진행 중에서 종료로 바뀌면 이력·잔액·세션 목록을 갱신하고 복구 표시를 해제한다.
   근거: 원래 mutation을 잃은 새로고침 이후에도 서버 완료를 관찰할 수 있어야 한다.
   - 통신 오류는 완료 여부가 불명확하므로 pending 표시를 보존한다. 정상 응답 또는 서버 종료 확인 후에만 지운다.
   - 같은 세션을 다시 여는 경우에도 명시적으로 재조회한다. 세션이 이미 완료된 경우에는 한 번의 조회로 복구를 끝낸다.
   - 조회 오류·404·세션 전환·로그아웃·컴포넌트 해제에서 무한 재조회나 이전 세션 결과 적용이 없도록 처리한다.
     네트워크 오류에는 안내와 수동 재시도를 제공한다. 서버가 진행 중이면 새 생성 요청을 자동 재전송하지 않는다.
   - 기존 stale 생성 회수 시간과 맞춰 대기 상한을 정하고, 상한 이후에는 대기를 멈추고 재확인 안내를 제공한다.
     프론트가 시간 경과만으로 성공·환불을 단정하지 않는다.
   - 지연 응답을 사용해 새로고침 후 완료, 요청 실패 후 서버 성공, 세션 전환을 검증한다.

4. **모티프·실사화에 미완료 차감 기록을 추가한다.**
   [router.py](../../apps/api/src/api/domains/design/router.py):1969, 2383과
   [design.py](../../db/src/db/models/design.py):121 인근 모델 구성을 기준으로,
   API 소유의 내부 작업 기록을 추가한다. 이 기록은 worker 실행 큐나 공개 완성본이 아니다.
   근거: 차감 원장만으로는 모티프 생성이 완료됐는지 판별할 수 없다.
   - 기록은 고유 `work_id`, 사용자, 종류, 시작·기한·종료 시각, `pending/succeeded/refunded` 상태와 최소 결과 식별자만 가진다.
     생성 프롬프트·이미지·intent를 중복 저장하지 않는다. 사용자·세션 삭제가 미완료 과금 증거를 지우지 않게 한다.
   - 차감과 pending 기록을 한 트랜잭션으로 커밋한다. 선차감 후 기록을 따로 INSERT하지 않는다.
   - 실사화의 완성본 INSERT와 succeeded 전환은 원자적으로 커밋한다.
     모티프는 결과 확인·라이브러리 저장 처리 후 결과 ID와 succeeded를 기록한다.
     기존 `saved=false` 성공 계약을 보존하고, 라이브러리 저장 실패만으로 생성 실패 환불을 하지 않는다.
   - 일반 실패에서는 원장 반전과 refunded 전환을 같은 트랜잭션으로 처리한다.
     `_shielded`는 유지하되 강제 종료 복구 수단으로 간주하지 않는다.
   - 공개 보관함은 계속 성공한 `GenerationJob`만 반환한다. worker는 과금 상태를 읽거나 쓰지 않는다.

5. **미완료 차감의 제한된 복구 배치를 추가한다.**
   [batch/router.py](../../apps/api/src/api/domains/batch/router.py):19와
   [ledger.py](../../apps/api/src/api/domains/tokens/ledger.py):287을 기준으로 내부 batch 엔드포인트를 추가한다.
   [scheduler.tf](../../infra/scheduler.tf)의 기존 인증 패턴으로 5분마다 최대 100건을 처리한다.
   근거: 사용자가 다시 접속하지 않아도 프로세스 중단 후 차감이 복구돼야 한다.
   - 복구 대상은 신규 내부 기록의 pending이며 기한이 지난 행으로 제한한다.
     기한은 worker 호출 전체 대기와 API 완료 처리의 상한보다 길게 정한다.
     [config.py](../../apps/api/src/api/config.py):85의 timeout 값 하나만 총 실행 상한으로 간주하지 말고 실제 호출 경로를 확인한다.
   - 잠금 순서는 기존 돈 경로와 같은 사용자 advisory lock → 작업 행이다. 잠금 아래 상태·기한을 다시 검사한다.
     성공 완료와 배치가 경쟁해도 한 terminal 상태만 커밋하게 한다.
   - 기한이 지난 미완료 기록은 기존 원장 반전 함수로 정확히 한 번 환불한다.
     늦게 돌아온 요청은 refunded 상태에 성공 결과나 라이브러리 링크를 뒤늦게 게시하지 않는다.
     외부 호출은 재실행하지 않으며 회수 불가능한 provider 비용은 서비스가 부담한다.
   - 배치 반복 호출, 환불 트랜잭션 실패 후 재시도, 완료와 복구의 경합을 실제 PostgreSQL로 검증한다.
     이전 기록 없는 차감은 자동 환불하지 않는다.

6. **계약과 생성 클라이언트를 함께 정리한다.**
   [worker-pipeline.md](../api-spec/worker-pipeline.md):105의 “환불 지점은 동기 경로뿐”인 계약을 수정하고,
   [money.md](../api-spec/money.md) §6에 중단·기한·늦은 완료·멱등 환불을 명시한다.
   [domains.md](../api-spec/domains.md)와 [ARCHITECTURE.md](../../ARCHITECTURE.md)에 복구 배치를 반영한다.
   새 batch 엔드포인트의 OpenAPI 변경 후 `pnpm codegen`을 실행한다.
   근거: 실행 코드·돈 경로 정본·생성 API 클라이언트가 같은 계약을 가져야 한다.

## 검증

- 프론트: `pnpm --filter store test src/features/design/model src/pages/design/index.test.tsx`.
  잔액 갱신, 조회 오류 재시도, 생성 도중 새로고침·통신 오류 이후 서버 완료를 검증한다.
- 백엔드: `uv run pytest apps/api/tests/test_design.py apps/api/tests/test_tokens.py apps/api/tests/test_batch.py`.
  차감 직후·worker 응답 후 완료 커밋 전 프로세스 중단, 배치 재실행, 늦은 성공, 정상 성공 무환불을 검증한다.
  외부 provider만 제어하고 DB·인가·원장 검증은 mock하지 않는다.
- 마이그레이션: `uv run pytest tests/test_migrations.py`. 사용자 DB를 초기화하지 않고 격리 DB에서 검증한다.
- 정적 검사: `pnpm lint`, `pnpm typecheck`, `pnpm architecture:check`, `uv run ruff check .`, `uv run pyright`.
  API 변경 후 `pnpm codegen` 재실행 시 추가 차이가 없어야 한다.
- 브라우저 검증은 Aside 하네스를 읽고 실행한다. 기존 :3000·:8000·:8001 서버 존재를 먼저 확인한다.
  오류 주입은 격리 환경에서 수행하고, 잔액이 포커스 이동 없이 바뀌며 기존 디자인이 오류 때문에 사라지지 않는지 확인한다.
  E2E 실행 여부는 e2e-test-harness에 따라 변경 완료 체크포인트에서 결정한다.
- 완료하면 결과·검증·남은 제한을 `docs/reviews/`에 기록하고 이 플랜을 제거한다. 커밋·푸시는 사람이 한다.

## 되돌리는 법 / 상향 신호

정상 작업 환불, 이중 환불, refunded 이후 성공 게시가 한 건이라도 나오면 복구 스케줄러를 먼저 중지한다.
신규 기록과 원장은 삭제하지 않고 대조한다. 배치·늦은 완료 가드를 수정한 뒤 격리 경합 테스트를 재통과시킨다.
서버 코드를 되돌릴 때도 이미 생긴 pending 기록을 처리할 복구 수단을 남기고, 복구 완료 전 스키마를 downgrade하지 않는다.
프론트 항목은 독립적으로 되돌릴 수 있으며 원장에 영향을 주지 않는다.

**실패 모드:** 정상 진행 중인 작업을 만료로 오판하거나, 환불과 늦은 완료를 따로 커밋해 결과와 과금이 어긋나는 것이다.

## 기각한 대안

- 생성 전체를 큐로 전환: 이번 문제는 완료 대조의 부재이므로 과도하다. 동기 처리 시간 자체가 한계에 도달하면 재검토한다.
- 모든 세션을 상시 폴링: 활성 생성이 있는 단건만 재조회하면 된다. 동시 다중 세션 관찰 요구가 생기면 재검토한다.
- 오래된 차감 원장만 보고 자동 환불: 특히 모티프 성공 여부를 입증할 연결이 없다. 기존 작업의 성공·실패 증거를 확보한 경우에만 별도 이관을 검토한다.

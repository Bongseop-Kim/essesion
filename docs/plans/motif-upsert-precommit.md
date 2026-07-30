# 모티프 upsert 선커밋 — 실패 요청의 Recraft 비용 회수 플랜

> 2026-07-30 Recraft 활성화 검증(`docs/reviews/design-recraft-activation-2026-07-30.md`)에서
> 저장 모티프 4종 대비 실제 과금 호출 7회+가 측정됐다. 주범은 **요청 실패 시
> 트랜잭션 롤백**: Recraft 생성이 성공해도 이후 단계(색 바인딩·렌더 등)에서
> 요청이 죽으면 모티프 upsert가 함께 사라지고, 재시도가 같은 소재를 다시
> 과금 생성한다. 이 플랜은 모티프 upsert를 요청 트랜잭션에서 분리(선커밋)해
> 실패한 요청이 만든 모티프를 카탈로그 자산으로 살리고, 재시도가 카탈로그
> 히트(무료)로 재사용하게 한다.

## 1. 코드 기준 현행 동작 (실행 전 숙지)

- `/generate`의 모든 DB 작업은 요청 세션 하나에서 진행되고, 성공 시 마지막에
  생성 로그와 함께 일괄 커밋된다(`routes.py` `generate` 말미 `session.commit()`).
- 실패 시 `_logged_generation` 래퍼가 `session.rollback()`으로 **요청 세션의
  모든 미커밋 변경(모티프 upsert 포함)을 되돌린 뒤** 같은 세션에 오류 로그만
  다시 커밋한다. 오류 로그의 `diagnostics.recraft_calls`(2026-07-30 추가)는
  살아남지만 과금의 결과물인 모티프는 버려진다.
- upsert 지점은 `resolver.py resolve_spec` 한 곳: Recraft 생성 →
  `store.upsert_motif`(content-hash id, 멱등) → 신규 멀티슬롯이면
  `label_slots`(Gemini) 후 슬롯 메타데이터 2차 upsert.
- 모티프 안전성 판정(`_screen_facets`, unsafe facet 거부)은 생성 **이전**에
  실행된다 — 저장되는 모티프의 안전 기준은 요청 성패와 무관하게 동일하다.
- 같은 파일에 분리 세션 선례가 이미 있다: 예시 검색은
  `request.app.state.sessionmaker()`로 별도 세션을 열어 쓴다(`routes.py`의
  `retrieval_session`).

## 2. 설계

`resolve_spec`의 upsert(1차 + 라벨 2차)만 전용 세션에서 즉시 커밋한다.

- `resolve_motifs`/`resolve_spec`에 선택 인자 `upsert_sessionmaker`
  (`async_sessionmaker | None`)를 추가한다. 값이 있으면 두 `upsert_motif`
  호출을 `async with upsert_sessionmaker() as s: ... await s.commit()`으로
  감싸고, 없으면 현행(요청 세션, 커밋은 호출자 소관)을 유지한다 — 시드
  스크립트·기존 테스트·worker `/motifs/generate` 경로는 무변경.
- `/generate` 라우트만 `request.app.state.sessionmaker`를 넘긴다.
- 가시성: Postgres 기본 read committed에서 커밋된 행은 요청 세션의 이후
  조회(`get_motifs`, 다음 플랜의 카탈로그 래더)에 바로 보인다 — 요청 내
  재사용 동작 불변.
- 멱등·동시성: id가 content-hash이고 upsert는 기존 행을 덮지 않으므로 재시도·
  동시 요청 모두 안전. 같은 subject의 신규 변형은 기존처럼 `variant_group`으로
  묶인다.
- 결정론 계약: 재시도에서 생성이 카탈로그 정확 매치로 바뀌는 것은 오늘도
  요청 내 재사용에서 일어나는 동일 동작이다. 같은 intent+seed → byte-identical
  계약은 모티프 id가 intent에 박힌 뒤의 이야기이므로 영향 없다.

## 3. 구현 순서

1. `apps/worker/src/worker/motifs/resolver.py` — `resolve_spec`·`resolve_motifs`에
   `upsert_sessionmaker` 선택 인자 추가, upsert 2곳(생성 직후 + 라벨 2차)을
   전용 세션 커밋으로 전환. 라벨 2차 upsert 실패가 1차 저장을 해치지 않도록
   두 upsert는 각각의 트랜잭션으로.
2. `apps/worker/src/worker/api/routes.py` — `/generate`의 `resolve_motifs`
   호출에 `upsert_sessionmaker=request.app.state.sessionmaker` 전달.
3. 회수 지표: 이미 있는 `diagnostics.recraft_calls`와 신규 저장 모티프 수를
   대조하면 절감이 보인다. 추가 지표는 만들지 않는다.

## 4. 검증

- [ ] 단위: 해석 성공 직후 인위적 예외(색 바인딩 실패 등)로 요청을 죽여도
      `motifs`에 `source='recraft'` 행이 남는 테스트
      (testcontainers `db_session` — 픽스처가 TRUNCATE 정리 방식이라 분리
      세션 커밋과 충돌 없음, `conftest.py` 확인 완료).
- [ ] 단위: 같은 spec 재시도가 Recraft를 호출하지 않고(`recraft.calls == 0`)
      선커밋된 모티프를 exact 매치로 재사용.
- [ ] 시드 스크립트·`/motifs/generate` 경로 무변경 회귀 (`uv run pytest`).
- [ ] 로컬 E2E: 실패 유도 후 같은 프롬프트 재실행 → 성공 로그의
      `diagnostics.recraft_calls = 0`, admin 상세 "Recraft 호출 0회" 확인.
- [ ] 완료 후 결과를 `docs/reviews/`에 기록하고 본 플랜 제거.

## 5. 리스크·관찰

- 실패 요청의 모티프가 카탈로그에 남는 것은 의도된 자산화다. 품질이 낮은
  변형이 쌓이면 admin Motif SVG 화면에서 정리 가능하고, provenance
  (`ingested_user_id`/`ingested_session_id`)로 출처 추적이 된다. 정리 정책이
  필요해지면 별도 플랜으로.
- 전용 세션은 커넥션을 짧게 하나 더 쓴다 — worker `db_pool_size` 기본 2 +
  `max_overflow` 0이라 동시 생성 요청이 몰리면 풀 대기 가능. 구현 시
  `db_max_overflow` 상향(예: 2) 여부를 부하 관점에서 함께 판단할 것.

## 상태 — 계획

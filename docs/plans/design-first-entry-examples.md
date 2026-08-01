# 지시서 — 디자인 첫 진입: 예시에서 시작

목업: https://claude.ai/code/artifact/ee2f449b-f072-4d36-b01d-2952de926144 (첫 진입 제안 v1, 4샷)

## 결정

- `/design` 첫 진입의 빈 캔버스를 **큐레이션 예시 갤러리**로 바꾼다. 예시를 고르면 그 디자인이 **토큰 과금 없이** 새 세션의 시작점이 되고, 사용자는 곧바로 편집(프롬프트 수정)부터 시작한다.
- 모티프 선택은 첫 단계로 열지 않는다 — 지금처럼 디자인이 생긴 뒤의 편집 도구로 유지.
- 프롬프트 직접 입력 경로는 그대로 병행 (placeholder만 "직접 만들 수도 있어요 —" 톤으로).

## 핵심 설계

세션 상태는 전부 `SeamlessGenerationLog`(run)에서 파생된다(`_resolve_design_run`). 따라서 예시 시작은 **렌더·워커 호출·SVG 복사 없이**:

1. 새 `DesignSession` 생성 (user_id = 요청자)
2. 예시가 가리키는 run을 `_resolve_design_run`으로 복원 → `current_intent/plan/seed/colorway/registry_version` 설정
3. 턴 2개 append: assistant `generate`(status=succeeded, run_id, summary=예시 이름) + user `activate`(run_id, seed, colorway_id)

이러면 store의 `readDesignHistory`·턴 응답 파이프라인(`_design_turn_outs`가 run 로그에서 SVG를 붙임)·모티프 패널이 **프론트 변경 없이** 그대로 동작한다. 갤러리 UI만 새로 만들면 된다.

## 작업 순서

### 1. 스키마 (db/ — Alembic 경유만)

`design_examples` 테이블:

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid pk | |
| run_id | uuid FK → seamless_generation_logs.id, RESTRICT | unique |
| name | text | 갤러리 카드 이름 (예: "미드나잇 웨이브") |
| ordinal | int | 노출 순서 |
| published | bool, default false | |
| created_at / updated_at | | TimestampMixin |

인덱스: `(published, ordinal)`.

> ⚠ 로컬 실행 DB는 baseline 스쿼시와 드리프트 상태(orphan rev) — 마이그레이션 검증은 파괴적 리셋이 필요할 수 있음. `db/` 리비전만 추가하고 실제 적용은 리셋 여부를 사용자와 확인.

### 2. API (apps/api/src/api/domains/design/)

**공개 조회** — 도메인 규칙상 상품과 같은 공개 조회 성격:

- `GET /design/examples` → published만 ordinal 순. `[{id, name, preview_svg}]`. preview_svg는 `log.design.svg` 그대로(세션 이력도 SVG 통짜로 내려가므로 동일 정책, 목록은 큐레이션이라 십수 개 상한).

**세션 시작** — 인증 필요:

- `POST /design/sessions/from-example` `{example_id}` → `DesignSessionOut` (201)
  - published 예시 조회 실패 시 404.
  - `_resolve_design_run` → 위 "핵심 설계"대로 세션·턴 생성. **토큰 차감 없음.**
  - `_ensure_intent_motif_access`는 호출하되, 등록 시점 검증(아래) 덕에 통과가 정상.

**admin** — 기존 관리자 역할 의존성 재사용:

- `POST /admin/design/examples` `{run_id, name, ordinal?}` — run 존재+`status in (success, partial)` 확인. **intent의 모티프 중 `source='user_upload'`가 있으면 409** (비공개 모티프는 공개 예시로 노출 불가 — `_intent_motif_ids` 재사용).
- `GET /admin/design/examples` (published 무관 전체)
- `PATCH /admin/design/examples/{id}` `{name?, ordinal?, published?}`
- `DELETE /admin/design/examples/{id}`

### 3. api-client 재생성

`pnpm codegen` — 생성물은 api 변경과 같은 커밋에 (CI codegen-drift).

### 4. store (apps/store)

- `StarterGallery` (features/design/ui/): 캔버스 중앙, `!hasDesign && !busy`일 때 기존 빈 상태 자리에 렌더. 목업 01 참고 — 제목 + 부제("고르면 토큰 없이 바로 캔버스에 올라와요…") + 카드 그리드(preview_svg + 이름).
- examples 쿼리는 비로그인에도 조회(공개 GET).
- 카드 클릭: `requireAuth` → `from-example` 호출 → `setSessionId(응답 id)` + `snackbar("'{name}'에서 시작했어요 · 토큰은 쓰지 않았어요")`. 기존 세션 쿼리 invalidate.
- 예시 0개(또는 조회 실패)면 지금의 빈 상태 문구로 폴백.
- 모바일(base)은 2열 그리드 — 목업 04.
- UI는 shared 사다리 준수(카드=프리미티브+토큰, 스크롤 필요 시 ScrollFog).

### 5. admin (apps/admin)

- 예시 관리 페이지: 목록(썸네일=preview_svg, 이름, 순서, 게시 Switch), run_id 입력 등록 폼, 삭제.
- v2로 미루는 것: 스토어 디자인 화면에서 "이 스텝을 예시로 등록" 버튼(admin 계정 한정). v1은 run_id 수동 입력으로 충분 — admin이 자기 세션의 로그 뷰어에서 run_id를 얻는다.

### 6. 테스트

- **API (testcontainers — 인가 테스트 mock 금지)**:
  - from-example 성공: 세션 생성, 턴 2개(generate succeeded + activate), `current_intent/seed/colorway` 세팅, **토큰 잔액 불변**, `GET turns` 응답에 design.svg 포함.
  - 미게시/존재하지 않는 예시 → 404, 비로그인 → 401.
  - admin 등록: user_upload 모티프 포함 run → 409, 성공 케이스, 비관리자 → 403.
  - 공개 GET: published만 노출.
- **store**: 갤러리 렌더, 카드 클릭 → 세션 시작, 0개 폴백 — `pages/design/index.test.tsx` 패턴.

### 7. 마무리

- `docs/CHECKLIST.md` 갱신, 이 지시서는 실행 완료 시 `docs/reviews/`에 결과 기록 후 삭제.

## 수용 기준

1. 비로그인으로 `/design` 진입 시 예시 갤러리가 보인다 (조회는 공개).
2. 카드 클릭(로그인 상태) → 캔버스에 해당 디자인이 뜨고, 이력에 스텝 1개, 모티프 패널 채워짐, 토큰 잔액 그대로.
3. 이후 프롬프트 수정은 기존 edit 플로우·과금 그대로.
4. admin에서 등록·게시·순서·삭제 관리 가능, user_upload 모티프 포함 run은 등록 거부.
5. `pnpm lint`·`pnpm turbo build typecheck test`·`uv run pytest`·codegen-drift 통과.

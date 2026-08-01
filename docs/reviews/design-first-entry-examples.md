# 디자인 첫 진입 — 예시에서 시작

실행일: 2026-08-01

범위: `docs/plans/design-first-entry-examples.md` 전체. `/design` 첫 진입의 빈 캔버스를 큐레이션
예시 갤러리로 바꾸고, 예시를 고르면 **토큰 과금·워커 호출·SVG 복사 없이** 새 세션의 시작점이
되게 했다. 모티프 선택은 플랜대로 첫 단계로 열지 않았고, 프롬프트 직접 입력 경로도 그대로 둔다.

## 플랜에서 벗어난 것 — 스키마는 새 리비전이 아니라 베이스라인에 넣었다

플랜 §1은 "`db/` 리비전만 추가"였다. 그 전제(로컬 실행 DB가 baseline 스쿼시와 드리프트해 검증
불가)가 **더 이상 사실이 아니었다** — 로컬 DB는 `dadd999bf858` 단일 head에 `alembic check` clean
상태였다. 그리고 레포는 미배포 단일 베이스라인을 문서·테스트로 강제한다:

- `tests/test_migrations.py`가 revision 목록을 `["dadd999bf858"]`로 단정한다.
- `ARCHITECTURE.md` §6.1 / `docs/OPERATOR-CHECKLIST.md` §1 / `db/README.md`가 "단일 베이스라인"을
  전제로 쓰여 있고, 앞선 재설계도 모두 베이스라인 직접 수정으로 처리했다(`docs/reviews/*`).

리비전을 늘리면 테스트 1건 + 문서 3곳을 고쳐 "관례를 깼다"는 기록을 남겨야 한다. 그래서
`design_examples`를 베이스라인 `upgrade()`/`downgrade()`에 직접 넣었다(autogenerate가 만든
리비전을 그대로 옮기고 파일은 삭제). 로컬 DB는 이미 테이블이 있는 상태라 `alembic stamp --purge
dadd999bf858`로 버전 행만 되돌렸다 — DDL은 실행하지 않았고 `alembic check`는 clean이다.
빈 DB에서의 검증은 `tests/test_migrations.py`(testcontainers: downgrade base → upgrade head →
check)가 그대로 통과한다. **배포 전이라 스테이징·프로덕션 영향은 없다.**

## 스키마

`design_examples` (베이스라인 포함, 43번째 테이블)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid pk | |
| run_id | uuid FK → `seamless_generation_logs.id` ondelete RESTRICT | **unique** — run 하나당 예시 1개 |
| name | text | 갤러리 카드 제목 |
| caption | text null | 카드 라벨 둘째 줄(≤60자). 없으면 제목만 그린다 |
| ordinal | int, default 0 | 노출 순서 |
| published | bool, default false | 등록 직후는 비게시 |
| created_at / updated_at | | TimestampMixin |

인덱스 `ix_design_examples_published_ordinal (published, ordinal)`.

## api — `domains/design/examples.py` (신규, 라우터 2개)

세션 상태가 전부 run에서 파생된다는 성질(`_resolve_design_run`)을 그대로 썼다. `router.py`
(2892줄)에 더 얹지 않고 파일을 나눴고, 헬퍼는 `design.router`에서 임포트한다(역방향 임포트 없음).

| 엔드포인트 | 인가 | 동작 |
|---|---|---|
| `GET /design/examples` | **공개** | published만 ordinal 순, 상한 24. `preview_svg`가 빈 예시는 내리지 않는다 |
| `POST /design/sessions/from-example` | 로그인 | 세션 1개 + 턴 2개(assistant `generate` succeeded + user `activate`) |
| `GET·POST /admin/design/examples` | admin | 전체 목록 / run 등록 |
| `PATCH·DELETE /admin/design/examples/{id}` | admin | name·ordinal·published 부분 수정 / 삭제 |

- **from-example은 과금 경로를 아예 지나지 않는다** — 렌더도 워커 호출도 없고 원장에 행이
  생기지 않는다. `current_intent/plan/seed/colorway/registry_version`은 `_resolve_design_run`이
  복원한 값 그대로다(`_finish_generation_success`의 자동 활성화와 같은 필드 집합).
- `_ensure_intent_motif_access`는 `design_session_id=None`으로, **세션을 만들기 전에** 부른다.
  새 세션에는 이력 첨부가 없으므로 "내 라이브러리에 있는 비공개 모티프만 허용"이 정확한 규칙이고,
  실패해도 빈 세션이 남지 않는다.
- 등록은 `_resolve_design_run`으로 run 유효성(status·design·intent·seed·colorway)을 검증하고,
  intent가 `source='user_upload'` 모티프를 쓰면 **409 `private_motif_example`**. 같은 run 재등록은
  unique 제약 → 전역 IntegrityError 핸들러가 409로 바꾼다(도메인 메시지 중복 정의 안 함).
- 프론트 변경 없이 도는 지점: `_design_turn_outs`가 assistant generate 턴에 run 로그의 SVG를
  붙이므로 store의 `readDesignHistory`·캔버스·이력·되돌리기·모티프 패널이 그대로 동작한다.

## store

- `features/design/ui/starter-gallery.tsx` (신규) — 제목 + 부제 + 카드 그리드(`base` 2열 / `md`
  4열). 카드는 **팬톤 칩 구조**: 타일이 카드 폭을 `fit="cover"`로 꽉 채워(흰 여백 없음) 위를
  차지하고, 아래 흰 라벨 면(`bg.layer-default`)이 제목·설명 두 줄을 받는다. 모서리는 카드가
  `overflow:hidden`으로 잘라내므로 타일은 `borderRadius={0}`이다. 카드 전체가 버튼이고
  `aria-label`은 `"{이름} 예시로 시작하기"`.
- `design-canvas.tsx` — `empty?: ReactNode` prop 1개 추가. 없으면 기존 `ContentPlaceholder`.
  **예시 0건·조회 실패·생성 중이면 자동으로 기존 빈 상태로 폴백**한다(페이지가 `empty`를
  `undefined`로 넘긴다).
- `model/queries.ts` — `designExamplesQueryOptions()` (공개 조회라 `enabled` 게이트 없음).
- `model/use-example-start.ts` (신규) — 응답을 세션 캐시에 즉시 심고 세션 목록만 무효화한다.
- `pages/design/index.tsx` — 카드 클릭 → `requireAuth` → 시작 → `openSession(id, false)` +
  `‘{이름}’에서 시작했어요 · 토큰은 쓰지 않았어요` 스낵바.

## admin

- `/design-examples` (사이드바 "생성·에셋" 그룹 마지막) — run ID·이름·카드 설명·순서 등록 폼 +
  목록(썸네일·이름/설명·run·순서·게시 Switch·삭제).
- 카드 설명(`caption`)은 선택 입력이다. PATCH에서 **생략(null)은 "안 바꿈", 빈 문자열이 지우기**
  — `exclude_none` 규칙상 지울 수단이 따로 필요해서 그렇게 정했다.
- 게시 Switch는 즉시 PATCH, **순서는 포커스를 잃을 때만** PATCH한다(타자마다 요청 금지).
- 삭제는 `AlertDialog` 확인 뒤.
- v2로 미룬 것(플랜 §5): store 화면의 "이 스텝을 예시로 등록" 버튼. run ID 수동 입력으로 충분.

## 검증

```
uv run pytest --ignore=apps/api/tests/test_contract.py -n 4   # 1015 passed
uv run pytest apps/api/tests/test_contract.py -n 4            # 196 passed (신규 4엔드포인트 퍼징 포함)
uv run pytest tests/                                          # 1 passed (단일 베이스라인 유지)
uv run ruff check . · ruff format --check · uv run pyright     # clean · 0 errors
pnpm lint                                                     # clean (check-harness OK)
pnpm turbo typecheck test                                     # 5/5 · admin 233 · store 통과
VITE_API_BASE_URL=… VITE_TOSS_CLIENT_KEY=… pnpm turbo build    # 2/2
pnpm codegen                                                  # 재실행이 생성물을 바꾸지 않음 = 드리프트 0
```

새 테스트

- `apps/api/tests/test_design_examples.py` (testcontainers, 5건)
  - 공개 GET이 published만 노출 · from-example이 intent/plan/seed/colorway·턴 2개·`design.svg`를
    복원하고 **원장에 차감 행이 생기지 않음**
  - 미게시 404 / 없는 예시 404 / 비로그인 401 + 그 경우 턴이 하나도 안 남음
  - admin 등록 → 중복 409 → 게시 PATCH → 공개 목록 반영 → caption 유지/지우기 → 삭제 204
  - user_upload 모티프 409(`private_motif_example`) · 없는 run 409 · 비관리자 403
- `apps/api/tests/authz.py` — `admin_design_examples_list` 케이스 추가(익명 401 / customer 403).
- `apps/store/src/pages/design/index.test.tsx` — "비로그인 첫 진입에서 예시를 고르면 그 디자인으로
  시작한다"(빈 세션 생성·generate 호출 없음 + 이력 채워짐). 기존 첫 진입 테스트가 예시 0건 폴백을
  덮는다.
- `apps/admin/src/pages/design-examples/list.test.tsx` (3건) — 등록 폼, 게시 즉시/순서 blur 저장,
  삭제 확인 다이얼로그.

라이브 API 확인(로컬 :8000, 합성 run 2건 삽입 후): admin 로그인 → 등록 201 → 게시 PATCH 200 →
`GET /design/examples`에 2건 노출까지 curl로 통과.

## 브라우저 확인 (Aside, 로컬 :3000 · 1440 뷰포트)

합성 예시 2건을 게시한 상태로 전 구간을 눌러 봤다. 콘솔·페이지 오류 0건.

1. **비로그인 첫 진입** — 갤러리가 뜬다(수용 기준 1). 카드는 타일이 면을 꽉 채우고 아래 흰
   라벨에 제목·설명 두 줄.
2. **비로그인 카드 클릭** — `로그인이 필요합니다` AlertDialog(하네스 규칙대로 `/login` 직행 안 함).
3. **로그인 후 카드 클릭** — 캔버스에 넥타이 렌더, 이력 `1 · 현재` 1칸, 프롬프트 placeholder가
   편집 문구로 전환, 내려받기·실사화 활성화, **토큰 잔액 500 → 500 그대로**, 스낵바
   `‘미드나잇 웨이브’에서 시작했어요 · 토큰은 쓰지 않았어요`(수용 기준 2).

확인 중 고친 것: 예시가 4개 미만이면 4열 그리드에서 카드가 왼쪽으로 몰려 제목·부제와
어긋났다. 그리드 폭을 카드 수 × 176으로 묶어(`columns`도 개수로 clamp) 항상 가운데 모이게 했다.

모바일(390)은 Aside가 뷰포트를 못 줄여 확인하지 못했다 — `pages/design/index.test.tsx`가
`matchMedia` min-width 전부 false(= base 브레이크포인트)로 렌더하므로 카드 렌더·클릭은 그 쪽이
덮는다.

로컬 DB에는 확인용 합성 예시 2건("미드나잇 웨이브 / 네이비 · 대각 스트라이프",
"버건디 트윌 / 버건디 · 촘촘한 트윌")과 그 run 로그가 게시 상태로 남아 있다 — 필요 없으면
`DELETE /admin/design/examples/{id}`로 지운다.

## 남은 운영 항목

`docs/CHECKLIST.md` §6에 "디자인 첫 진입 예시 큐레이션"을 넣었다. 등록된 예시가 0건이면 첫 진입은
기존 빈 상태 문구로 폴백하므로 배포 자체를 막지는 않는다.

# 재설계 2단계 — 구성 patch 계약, 보존 기계 폐기, 범위 밖 거절

실행일: 2026-07-31

상태: 서버 구현·검증 완료. store 빌드는 **여전히 의도적으로 깨진 상태**(4단계에서 새 계약에 맞춘다).

범위: `docs/plans/design-redesign/02-server-scoped-edit.md` 전체. 입력창 문장은 이제 구성 축만
바꾸는 좁은 patch를 만든다. "모델이 요청 범위를 넘었는지 정규식으로 추측하고 되돌리는" 기계는
사라졌다 — patch 스키마에 모티프 정체성 필드가 없어 타입상 불가능하기 때문이다.

## 변경

### worker

- **신규 `engine/patch.py` (426행)** — `DesignPatchV1` + `composition_snapshot` + `apply_patch`.
  - 축: `background{color}`, `stripe{angle, period_mm, bands[]}`, `placement{arrangement,
    count_per_axis, rotation_deg}`, `motif_size_mm[]`, `motif_color`, `palette{slots[{id,hex}]}`,
    `note`, `out_of_scope`. 모두 nullable — null은 "그대로 둔다"이므로 원복 로직이 필요 없다.
  - **적용이 엔진 불변식을 깰 수 없게 만들었다**: 격자는 `count_per_axis`만 받아 셀을
    `tile/count`로 계산하고(항상 tile을 나눈다), 엇갈림은 짝수 축으로 올리고, 밴드는
    `offset % period`·`min(width, period)`로 정규화하고, 모티프 크기는 tile로 클램프한다.
    그래서 **patch 저작은 자기수정 재시도 라운드가 없다(1콜)** — 최초 저작의 4라운드와 다르다.
  - 색은 hex로 들어오고 슬롯 매핑은 `_SlotBook`이 결정론적으로 한다: 기존 hex는 그 슬롯을
    재사용, 새 hex는 슬롯을 추가(모든 colorway 매핑 포함), 참조가 끊긴 슬롯은 제거 —
    편집이 쌓여도 팔레트가 자라지 않고 `engine.palette`의 "colorway는 선언 슬롯 전부를
    정확히 매핑" 불변식이 유지된다.
  - 강제 팔레트 밖 색은 `ConstraintInvalid` → `constraint_conflict`(422).
- **신규 `warnings.py` (47행)** — `WARNING_MESSAGES` 코드→한글 + 경계 분류기.
  응답은 `warnings: [{code, message}]`이고 매핑에 없는 코드는 내려보내지 않는다. 엔진
  영문 진단 문자열은 로그·`diagnostics`의 정본으로 그대로 남는다.
- **신규 `adapters/named_colors.py` (320행)** — `gemini.py`에서 이관. 최초 저작의 지명색 접지
  (`normalize_requested_named_colors` 등)는 refine이 아니라 초기 저작이 쓰는 기능이라 삭제하지
  않고 분리했다(아래 "플랜과 다르게 한 것" 1번).
- **`adapters/gemini.py` 1801 → 920행.** 삭제: `_RefinePermissions`,
  `_refine_permissions`, `_refine_restore_permissions`, `_CategoryMentions`,
  `_category_mentions`, `_category_is_preserved`, `_copy_color_references`,
  `_copy_motif_fields`, `_merge_layer_categories`, `_preserve_refine_plan`,
  `_ensure_requested_refine_changes`와 그것들만 쓰던 정규식 12종(`_CHANGE_WORDS`,
  `_PRESERVE_WORDS`, `_COLOR_WORDS`, `_SIZE_WORDS`, `_PLACEMENT_WORDS`, `_GEOMETRY_*`,
  `_ADD_WORDS`, `_*_GAP`, `_GROUND_ONLY_WORDS`, `_*_PRESERVE_WORDS`).
  - `author_design`은 `current_plan`·`conversation_history`를 더 받지 않는다 — 최초 저작 전용.
    `_build_prompt`도 refine 분기와 `current_motif_N` alias 지침이 사라졌다.
  - 추가: `author_patch(prompt, snapshot, history, palette_constraint)` + `_build_patch_prompt`
    + `PATCH_SYSTEM_INSTRUCTION`/`PATCH_PROMPT_REVISION`. 응답 스키마는 `DesignPatchV1` 하나,
    모델은 flash-lite 유지.
- **`api/schemas.py`** — `ConversationContext`에서 `current_plan` 삭제(`current_intent`+`history`만).
  `GenerateResponse.warnings`가 `list[GenerationWarning]`으로, `note: str | None` 추가.
  신규 `ScopeRejectedResponse`. `GenerateRequest`는 구성 수정에 `reference_images`·`motif_ids`가
  오면 거부한다(조용히 무시되지 않게).
- **`api/routes.py`** — `_RefineAuthoringContext`·`_refine_authoring_context`(모티프 alias 기계)
  삭제. 신규 `_generate_from_patch`: patch 저작 → `apply_patch` → `apply_generation_constraints`
  → `compose_design`. 모티프 해석·예시 검색·plan 스냅샷을 타지 않는다. `_generate_from_prompt`는
  refine 분기가 전부 빠져 순수 최초 저작 경로가 됐다. 진단 `mode`는 `refine` → `patch`.
- **`engine/constraints.py`** — `_lattice_placement`/`_scatter_placement`를 count 기반 공개
  함수 `lattice_placement`/`scatter_placement`로 바꾸고(patch와 공유), density 계산은
  `_lattice_for_density`/`_scatter_for_density` 래퍼로 남겼다. `_ordered_slot_refs` →
  `ordered_slot_refs`(patch의 슬롯 정리가 재사용).

### api

- `_build_conversation_context`는 `current_intent`만 요구한다(plan 없이도 구성 수정이 된다).
- `_resolve_design_run`의 `plan`이 `dict | None` — patch 런에는 저작 plan이 없고 스텝 복원
  정본은 intent다. `design_plan_unavailable` 거절이 사라졌다.
- `DesignGenerateOut`에 `note`, `warnings: list[DesignWarningOut]`. `POST /design/generate`
  응답이 `DesignGenerateOut | DesignGenerateRejectedOut` 유니온이 됐다.
- 신규 `_undo_generation` — 범위 밖 거절 시 환불 + 요청 턴 삭제 + `context_version` 원복 +
  `active_generation_id` 해제. **잔액·이력·문맥이 요청 전과 같아진다.**
- assistant 턴 summary는 patch의 `note`를 우선 쓴다(없으면 기존 `_short_design_description`).
- 커밋된 디자인이 있는 세션에 사진·모티프를 보내면 과금 전에 `motif_input_conflict`(422).
- `admin/generation.py`의 진단 mode literal `refine` → `patch`, admin 라벨은 "구성 수정".

### 삭제한 테스트

`test_adapters.py`에서 refine 보존·언급탐지·사후검사 전용 테스트 605행(권한 시나리오
A2–A5, `_preserve_refine_plan` 원복 케이스, layer merge, 재시도 검증 등)과
`test_api_generate.py`의 `test_refine_uses_one_plan_without_exposing_the_concrete_motif`
(114행)를 지웠다. 검증 대상 함수가 없어졌다.

### 추가한 테스트

- `apps/worker/tests/test_patch.py`(신규 14개) — 스키마에 모티프 필드 없음, 스냅샷 왕복,
  축별 적용/미적용, 무늬 단색화, 격자 셀 divisibility, 회전만 바꿀 때 배치 타입 보존, 밴드 정규화·슬롯
  할당, 줄무늬 추가·제거(호스트 경로가 있으면 `ConstraintInvalid`), 슬롯 정리, 강제 팔레트
  충돌, **같은 intent + 같은 patch → byte-identical SVG**.
- `test_adapters.py` — `author_patch` 1콜 계약·모티프 정체성 미노출, `out_of_scope`,
  patch 프롬프트가 모티프 경계와 강제 팔레트를 명시.
- `test_api_generate.py` — 요청 축만 바뀌고 모티프 불변·`plan` null, `scope_rejected` 200,
  구성 수정에 모티프 입력 422.
- `test_design.py`(api, testcontainers) — `test_scope_rejected_edit_costs_nothing_and_leaves_no_turn`:
  잔액 불변·`context_version` 불변·턴 id 목록 불변·거절 후 재시도 성공. 사진 재사용 테스트는
  새 세션에서 확인하도록 고치고, 커밋된 세션의 사진 첨부 422를 함께 검증한다.

## 플랜과 다르게 한 것 (근거)

1. **지명색 정규화를 삭제하지 않고 `adapters/named_colors.py`로 이관했다.** 플랜의 삭제 목록에
   `_requested_named_colors`·`_normalize_requested_named_colors`가 있지만 이 함수들은 **최초 저작
   경로도 쓴다**(`test_initial_authoring_normalizes_wrong_named_ground_color` 등). 같은 플랜의
   검증 항목이 "최초 저작 경로는 건드리지 않았음"을 요구하므로 삭제는 기능 회귀가 된다. refine
   전용 보존·언급탐지·사후검사는 전부 지웠다.
2. **`gemini.py`는 920행 — "절반 이하"(< 953)는 만족하지만 목표 900은 19행 초과.** 1번 때문에
   320행이 삭제 대신 이동했다. 남은 것은 최초 저작, patch 저작, 아이디어, 프롬프트 조립,
   스키마 서빙뿐이다.
3. **완료 판정 2 (`grep -n "motif" engine/patch.py` 0건)은 문자 그대로는 불가능하다** — 플랜이
   정의한 patch 스키마 자체에 `motif_size_mm`가 있고 모티프 레이어를 찾아야 한다. 실제 계약인
   "모티프 정체성 필드 없음"은 `grep -c "motif_id\|catalog_ref\|\"source\"" engine/patch.py`
   = **0건**으로 성립한다.
4. **`placement` patch는 `intent.Placement`의 필드 부분집합이 아니라 3축 요약**
   (`arrangement`/`count_per_axis`/`rotation_deg`)이다. `cell_w_mm`를 모델이 직접 쓰면 "셀이
   tile을 나눈다"·"엇갈림은 토러스에서 닫힌다"를 위반한 intent가 대량으로 나오고(둘 다 repair가
   없는 하드 에러), `point_set`은 좌표 노출 금지 대상이다. 3축은 3단계에서 폐기되는
   `PatternConstraints`의 크기·밀도·배치·방향과 정확히 같은 표현력이다.
5. **플랜에 없던 `motif_color` 축을 하나 추가했다.** intent의 모티프 색은 슬롯 참조이거나
   **원본색 유지(직접 hex)** 인데, 후자는 `palette.slots` recolor로 닿을 수 없다. 옛 refine은
   plan의 `color_indices`로 이걸 할 수 있었으므로 축이 없으면 "무늬를 빨갛게"가 조용히 실패하거나
   범위 밖으로 거절된다. `motif_color`는 모든 paint slot을 한 색으로 칠하고(슬롯 이름 계약 유지),
   슬롯 단위 부분 채색은 5단계 모티프 모달이 맡는다. `palette.slots`(팔레트 연산)와
   `motif_color`(레이어 연산)는 슬롯을 줄무늬와 공유할 때 결과가 달라 중복이 아니다.
6. **거절 판정은 "축이 하나도 없으면"으로 넓게 잡았다.** 플랜은 "축이 없고 **요청이 모티프
   변경으로 보이면**"이지만, 모델이 `out_of_scope`를 안 켜고 축도 안 채운 응답도 결국 "아무것도
   안 바뀜"이라 성공으로 낼 수 없다. `target`은 플랜대로 `motif` 하나뿐이므로 모티프가 아닌
   표현 불가 요청(예: 글자 넣기)도 같은 알림을 받는다 — 문구 세분화가 필요해지면 `target`을
   늘린다.
7. **`docs/api-spec/worker-pipeline.md`에 "refine은 plan 전체를 재저작한다" 문단이 없었다.**
   대신 §5의 `/generate` 계약 bullet에 patch 경로·`scope_rejected`·warnings 계약을 새로 썼고,
   같은 줄에 남아 있던 1단계 잔여 표현(`candidate_count`, 후보별 응답, `candidate_invalid`,
   `{candidate_id}` 프리뷰 경로)도 함께 고쳤다.

## 남긴 것 (근거)

- **`design_sessions.current_plan` 컬럼과 `DesignSessionOut.current_plan`** — 최초 저작 런은
  여전히 plan을 남기고 `steps/activate`가 복원한다. patch 런에서는 null이다. 읽는 곳은
  이제 없으므로 `candidate_count_requested` 같은 관측 컬럼과 함께 **6단계에서 지운다**
  (베이스라인 수정 + 로컬 DB 재생성이 필요해 단계 경계를 넘지 않았다).
- **`intent`+새 seed 변형 경로(`_generate_from_intent`)** — api는 더 이상 호출하지 않지만
  워커 계약·테스트가 남아 있다. 폐기는 6단계 죽은 코드 스윕.
- `authoring/promotion.py`의 승격 스캔은 1단계에서 이미 `authoring.plans`(복수)·`select` 턴을
  찾도록 남아 사실상 동작하지 않는다. 2단계와 무관한 선재 드리프트 — 6단계에서 함께 본다.

## 검증

```
uv run pytest         # 1195 passed (worker 530 + api 665)
uv run ruff check .   # clean
uv run pyright        # 0 errors
pnpm lint             # clean
pnpm codegen          # 생성물 동봉 (DesignGenerateRejectedOut·DesignWarningOut·note)
pnpm --filter admin test   # 229 passed (router.test.tsx가 전체 실행에서 한 번 타이밍으로
                           # 실패했다 — 단독 재실행 통과, 이번 변경과 무관한 선재 flake)
pnpm turbo typecheck  # store만 실패 — 1단계와 동일한 4건(WorkerCandidateOut·rerollDesign·
                      # selectDesignCandidate·candidates), 이번 변경으로 늘어난 오류는 없다
```

- 결정론: `test_same_intent_and_patch_render_byte_identical_svg` — 같은 intent + 같은 patch를
  두 번 적용해 SVG 바이트와 design id 동일.
- 회귀: 최초 저작 경로 테스트(프롬프트·참고 사진·정확 모티프·지명색·예시 검색)는 그대로 통과.
- 인가/과금: `scope_rejected` 통합 테스트는 mock 없이 testcontainers Postgres에서 잔액·턴·
  `context_version`을 대조한다.

## 데이터

스키마 변경 없음. `conversation_context`·턴 payload 구조가 바뀌지 않았으므로 1단계에서
`design_sessions`를 비운 뒤라면 추가 정리도 필요 없다.

## 브라우저 확인

하지 않았다 — store가 아직 새 계약에 맞지 않아(1단계에서 의도적으로 깨진 상태) 화면으로
구동할 수 없다. 4단계에서 Aside로 확인한다.

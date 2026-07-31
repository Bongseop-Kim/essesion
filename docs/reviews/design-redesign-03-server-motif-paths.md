# 재설계 3단계 — 모티프 문장 검색·생성·교체, 패턴 설정 전면 폐기

실행일: 2026-07-31

상태: 서버 구현·검증 완료. store는 **여전히 의도적으로 깨진 상태**(1단계와 동일한 4건, 4단계에서
새 계약에 맞춘다). 이번 단계에서 store는 폐기된 축을 서버로 보내던 요청 payload만 끊었다.

범위: `docs/plans/design-redesign/03-server-motif-paths.md` 전체. 모티프는 목록이 아니라
**문장**으로 찾고, 없으면 문장으로 만들고, 슬롯 교체는 모델 없이 결정론으로 재렌더한다.
크기·밀도·배치·방향 4축(`PatternConstraints`)은 전 계층에서 사라졌다.

## 미결 결정 (플랜 M3)

**문장 → `MotifSpec` 변환은 flash-lite 1콜 구조화 출력으로 한다.** 규칙 기반은 한국어 문장에서
`scope`/`view`/`style`을 못 뽑고, 이 축이 검색 품질을 좌우한다. 대신 **실패가 검색을 막지 못하게**
했다: 모델 미구성·예외·타임아웃이면 문장을 그대로 `subject`로 써서 렉시컬·벡터 검색을 계속한다
(`worker/motifs/spec.py`, 82행). 폴백 경로는 모델 없이 통과하는 테스트로 고정했다.

## 변경

### worker

- **신규 `motifs/spec.py`** — `MotifSpecDraft`(subject/scope/view/expression/style/description) +
  `motif_spec_from_sentence(sentence, gemini_client, style_hint)`. 문장 100자 상한은 기존
  `MotifSpec` facet 상한과 같게 유지했다(C-10). 반환은 resolver가 먹는 spec dict.
- **`api/schemas.py`** — `CandidatesRequest`/`MotifGenerateRequest`가 `spec`이 아니라
  `MotifQuery{query, style_hint?}`를 상속한다. `MotifSpec` 모델은 삭제(외부에서 spec을 보내는
  경로가 없어졌다). `GenerateRequest`에서 `pattern_constraints` 삭제, `motif_slot{slot,motif_id}`
  추가 — `intent`와만 함께 올 수 있다. `IdeasRequest.pattern_constraints` 삭제.
- **`api/routes.py`** — `/motifs/candidates`·`/motifs/generate`가 문장을 spec으로 바꾼 뒤 기존
  `present_candidates`/`resolve_spec`을 호출한다(URL·과금 경계 불변). `_generate_from_intent`는
  `motif_slot`이 오면 `set_motif_slot` → 제약 → **카탈로그 기준 색 재바인딩**
  (`_bind_resolved_motif_colors`) → 합성 순서로 처리한다. 진단 `mode`에 `motif_slot` 추가,
  `pattern_controls` 진단 삭제. 로그 `intent`에 `motif_slot`을 남긴다.
- **`engine/patch.py`** — 신규 `set_motif_slot(intent, slot, motif_id)`. 슬롯 1·2 중 있는 슬롯은
  `params.motif_id`만 바꾸고, 빈 슬롯 2는 마지막 모티프 레이어를 복제해 **같은 격자에서 반 칸
  엇갈리게**(`offset_x/y_mm = cell/2`) 놓는다. 격자가 아닌 배치(산개·점집합·경로)는 축 개수만
  물려받아 격자로 내린다 — 같은 seed의 산개를 복제하면 두 모티프가 정확히 겹친다.
  모티프가 **하나도 없는** 디자인(줄무늬·단색)은 파생할 레이어가 없으므로 기본 격자
  (축 6, `size_mm = tile×0.18`, 배경이 아닌 팔레트 슬롯) 한 장을 만든다.
  `apply_patch` 말미의 슬롯 정리·z_order 재부여는 `_renumber`로 뽑아 두 경로가 공유한다.
- **`engine/intent.py`·`engine/placement.py`** — `LatticeSpec.offset_x_mm/offset_y_mm`(기본 0)
  추가, `place_lattice`가 인스턴스 좌표에 더한다. 좌표는 여전히 `% tile`이라 seamless 불변식과
  무관하고, 필드를 안 쓰는 기존 intent는 byte-identical이다(기존 스냅샷 테스트 전부 통과).
- **`engine/constraints.py` 514 → 274행.** 삭제: `PatternConstraints`, `_apply_pattern`,
  `_density_axis_count`, `_auto_axis_count`, `_lattice_for_density`, `_scatter_for_density`,
  `pattern_prompt_lines`, 4축 상수 5종(`_SCALE_FRACTION`·`_LATTICE_AXIS_COUNT`·
  `_PATH_REPEAT_COUNT`·`_SCATTER_COUNT`·`_DIRECTION_ANGLE`), `assert_constraints_satisfied`의
  pattern 절 전체. 남은 것은 **팔레트 강제**와 **격자 겹침 clamp**(품질 가드)뿐이다.
  `lattice_placement`/`scatter_placement`는 patch가 쓰므로 유지, `PaletteConstraint`도 유지.
- **`engine/candidates.py`·`authoring/retrieval.py`·`adapters/gemini.py`** — 4축 파라미터 제거.
  RAG query document와 예시 호환성 필터는 이제 motif 수만 본다(`arrangement` 필터 삭제).
  `_build_prompt`·`_build_ideas_prompt`에서 4축 지시문이 사라졌다.

### api

- 신규 `POST /design/sessions/{id}/motifs/search` — 바디 `{query}`, 응답
  `{results: [{motif_id, name, preview_svg, similarity, current}]}` 최대 4개. 워커가 Recraft를
  부르지 않으므로 **무과금**이며 `recraft_used`가 변하지 않는다. 이름은 내 라이브러리 이름
  → 없으면 `Motif.subject`, 썸네일은 api가 카탈로그 symbol로 만든다(`_motif_preview_svg`).
  카탈로그 행이 없는 후보는 카드가 될 수 없어 조용히 빠진다.
- `POST .../motifs/generate` — 바디가 `{spec, seed}` → `{prompt}`. 예산 선차감·환급 로직은
  그대로, 응답에 `motif{motif_id,name,preview_svg,...}`를 붙여 프론트가 바로 그린다.
- 신규 `POST .../motifs/activate` — 바디 `{slot, motif_id}`. 세션 잠금 → 모티프 존재·접근 확인
  → 워커 `/generate`에 `{intent, motif_slot, seed, colorway}` → 성공 처리는 생성과 같은 기계
  (`_finish_generation_success`). **모델 호출 0, 토큰 0**(`charge_cost=0`이라 환불도 no-op),
  새 스텝 1개(`motif_activate` 요청 턴 + assistant 턴 + 자동 `activate`).
- `_shielded()` 헬퍼로 생성·교체 두 경로가 같은 "클라이언트가 끊겨도 마무리" 규칙을 공유한다.
- `_ensure_intent_motif_access`를 `_ensure_motif_access(motif_ids)`로 갈라 교체 경로가 같은
  private 모티프 인가를 재사용한다.
- `_finish_generation_success(summary=...)` — 교체는 워커 `note`가 없으므로 api가
  `"{이름} 무늬로 바꿨습니다"`를 쓴다.
- `PatternConstraints` 모델과 `DesignGenerateRequest`·`DesignIdeasRequest`·턴 payload의
  `pattern_constraints` 필드 삭제.

### store (계약만 끊음 — UI는 4단계)

`use-generate.ts`·`context-tools.ts`가 더 이상 `pattern_constraints`를 보내지 않는다.
`pattern-settings-modal.tsx`·`draft.ts`의 4축 타입·`turn-feed`의 요약 표시는 **4단계에서 파일과
함께 사라지므로** 손대지 않았다(플랜 지시).

### 문서

- `docs/specs/design-generation-controls.md` **삭제**. 링크는 `ARCHITECTURE.md` 한 곳뿐이었고
  `worker-engine.md` §7.1로 바꿨다(레포 전체 `design-generation-controls` 잔존 0건, plans 제외).
- `worker-engine.md` §7.1을 색 지정 + 겹침 clamp로 다시 썼고, §1·§3에 lattice offset을 적었다.
- `worker-pipeline.md` `/generate` 계약에 `motif_slot`, 진단 mode에 `motif_slot` 추가,
  `/ideas`에서 pattern 삭제. `worker-motifs.md` §5에 문장 입력 계약(10번) 추가.
- `authoring-plan-v3.md` RAG 계약, `ARCHITECTURE.md` 4곳(제약 다이어그램·RAG 필터·제약 경계·
  모티프 경로)을 갱신했다.

### 테스트

- 삭제: `test_constraints.py`의 4축 케이스 2개(축→물리 변환, 크기×밀도 9조합),
  `test_generation_logging.py`의 `pattern_controls` 진단 단정.
- 추가:
  - `test_constraints.py` — 팔레트 강제 + 겹침 clamp가 합성·사후검증까지 함께 통과(9조합
    테스트가 지켜준 성질을 한 케이스로 남겼다).
  - `test_api_motifs.py` — 변환 실패 폴백(모델이 죽어도 문장으로 찾는다), 변환된 spec으로 검색
    (프롬프트에 문장·style_hint 포함), **모티프 슬롯 교체**: 슬롯 1 교체 후 같은 입력 두 번 →
    byte-identical SVG, 빈 슬롯 2 → 파생 격자 offset 6.0mm, 모티프 없는 줄무늬 디자인 →
    기본 격자(셀 8.0mm) 한 장 생성, `motif_slot` 단독 요청 422.
  - `test_design.py`(api, testcontainers) — 검색 무과금·카드 4개 상한·`current` 표시·style_hint
    전달, 생성 예산 3회 소진/409·재사용 환급·워커 실패 환급(+`preview_svg` 포함),
    교체가 잔액 불변·턴 3개(`motif_activate`→`generate`→`activate`)·payload에 `motif_slot`,
    없는 모티프 404·디자인 없는 세션 409.
  - `authz.py` — `design_motif_search`/`design_motif_activate` owner 케이스 추가.

## 플랜과 다르게 한 것 (근거)

1. **`LatticeSpec`에 `offset_x_mm`/`offset_y_mm`를 새로 넣었다.** 플랜은 두 번째 슬롯을 "같은
   lattice, 위상만 이동"으로 파생하라고 하는데, 기존 `LatticeSpec`에는 위상 축이 없었다
   (`drop_fraction`은 짝수 열만 어긋나 홀수 열이 원본과 정확히 겹친다). `Placement.phase_mm`는
   path_following 전용이라 격자에 의미를 덮어쓰는 대신 필드를 명시했다. 기본값 0이라 기존
   intent·layout id·SVG는 불변이다.
2. **모티프 슬롯 교체를 워커 신규 엔드포인트가 아니라 기존 `/generate`의 intent 경로에
   `motif_slot` 필드로 넣었다.** intent 재렌더 기계(제약·합성·로그·응답)가 이미 있어서, 새
   엔드포인트는 그 기계를 복제해야 한다. api 쪽 스텝 생성·인가·실패 처리도 그대로 재사용된다.
   부수 효과로 2단계 리뷰가 "6단계에서 폐기 후보"로 남겼던 `_generate_from_intent`가 다시
   쓰임을 얻었다 — **폐기하지 말 것**.
3. **api `motifs/generate`가 `seed`를 받지 않는다.** 플랜의 바디는 `{prompt}`뿐이고, 클라이언트가
   변이 선택 seed를 고를 화면이 없다. 워커는 여전히 `seed`를 받으며(기본 0) 기존 결정론 계약이
   유지된다. 그래서 `test_seed_inputs_reject_outside_signed_int64...`의 모티프 절은 지웠다.
4. **`grep -rn "pattern_constraints" apps/ docs/`가 0건이 아니다 — 의도한 2건이 남았다.**
   `test_design.py`의 422 파라미터(폐기된 축을 보내면 조용히 무시되지 않고 거부되는지)와
   `worker-engine.md`의 "4축은 폐기됐다" 서술이다. 살아 있는 코드 경로·계약·기본값은 0건이다.
5. **검색 결과의 `current`는 결과 항목의 플래그로 넣었다**("4개 + `current` 표시"). 세션의 현재
   슬롯 목록은 이미 `DesignSessionOut.current_motifs`가 준다.
6. **플랜에 없던 "모티프 0개 디자인의 첫 슬롯"을 넣었다.** 플랜 §4는 레이어가 1개일 때만 다루는데,
   줄무늬·단색 디자인은 레이어가 0개다. 입력창은 모티프 정체성을 만들 수 없고(patch 스키마에
   없어 `scope_rejected`) 교체도 실패하면, 그 디자인은 **영구히 무늬를 가질 수 없다**. 그래서
   0개일 때만 기본 격자 한 장을 만든다 — 위상·크기를 파생할 원본이 없으니 유일하게
   상수(축 6, 0.18×tile)를 쓰는 지점이고, 색은 카탈로그 바인딩이 다시 고른다.
7. **style_hint는 `current_plan`의 모티프 `style` 문구를 이어붙인 값이다.** Plan v3에 디자인
   전역 style 필드가 없다. 구성 patch 런은 plan을 남기지 않으므로 편집이 쌓이면 힌트가 없어질 수
   있는데, 힌트는 선택 입력이라 검색이 계속 동작한다.

## 남긴 것 (근거)

- `PaletteConstraint`(색 지정) — 레일의 `색 지정`이 계속 쓴다. 강제 팔레트 검증도 유지.
- 격자 겹침 clamp(`_clamp_lattice_overlap`, `lattice_size_limit`) — 4축과 무관한 품질 가드.
- store의 4축 UI(모달·draft 타입·turn-feed 요약) — 4단계 삭제 대상.
- `design_sessions.current_plan`·`candidate_count_requested` 등 관측 컬럼 — 6단계(베이스라인 수정).

## 검증

```
uv run pytest         # 1197 passed (worker 528 + api 641 + 그 외)
uv run ruff check .   # clean
uv run ruff format --check .   # clean
uv run pyright        # 0 errors
pnpm lint             # clean
pnpm codegen          # 생성물 동봉 (searchMotifs·generateMotif·activateMotif·MotifResultOut)
pnpm --filter store test   # 240 passed
pnpm --filter admin test   # 229 passed
pnpm turbo typecheck  # store만 실패 — 1단계와 동일한 4건, 이번 변경으로 늘어난 오류 없음
pnpm turbo build      # store만 실패 — 같은 원인(rerollDesign·selectDesignCandidate 미존재).
                      # admin build는 VITE_API_BASE_URL 환경변수 필요(선재 조건)
```

- 결정론: `test_motif_slot_replaces_the_layer_without_touching_a_model` — 같은 (intent, slot,
  motif_id)로 두 번 재렌더해 SVG 바이트 동일.
- 무과금: 검색은 `recraft_used` 불변, 교체는 토큰 원장 잔액 불변(testcontainers 실DB 대조).

## 데이터

스키마 변경 없음. `LatticeSpec` 필드 추가는 JSONB intent 안이라 마이그레이션이 없고, 기본값 0이라
기존 행의 렌더 결과도 그대로다.

## 브라우저 확인

하지 않았다 — store가 아직 새 계약에 맞지 않아 화면으로 구동할 수 없다. 4·5단계에서 Aside로
확인한다.

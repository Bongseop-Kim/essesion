# 3단계 — 모티프 문장 검색·생성, 패턴 설정 전면 폐기

> 총괄: `00-overview.md`. 선행: 1단계. 2단계와 병렬 가능(겹치는 파일은 `constraints.py`뿐).

## 목표

모티프를 **문장으로 찾고, 없으면 문장으로 만든다.** 목록을 통째로 노출하지 않는다.
그리고 크기·밀도·배치·방향 4축 설정(`PatternConstraints`)을 전 계층에서 없앤다.

## 이미 있는 것 (근거) — 백엔드 신규가 거의 없다

| 위치 | 내용 |
|---|---|
| `router.py:2745` | `POST /design/sessions/{id}/motifs/candidates` — 워커 벡터 검색, **Recraft 미호출·무과금** |
| `router.py:2763` | `POST /design/sessions/{id}/motifs/generate` — 세션 Recraft 예산 선차감 + 재사용(`reused`) 시 환급 |
| `packages/api-client/src/sdk.gen.ts:1378,1391` | 두 엔드포인트의 클라이언트가 **이미 생성돼 있다** |
| store | 두 함수를 호출하는 코드가 **없다** — UI만 없는 상태 |
| `worker/api/schemas.py:194` | `MotifSpec(subject, scope, view, expression, style, description)` |

즉 이 단계의 서버 작업은 **자유 문장 → `MotifSpec` 변환 한 단계**와 계약 정리다.

## 작업

### 1. 문장 → MotifSpec 변환 (미결 M3 결정)

- 권고: **flash-lite 1콜 구조화 출력**. 입력은 사용자 문장(최대 100자) + 현재 plan의 스타일
  힌트, 출력은 `MotifSpec`. 실패·타임아웃 시 `subject = 문장 그대로`로 폴백해 검색은 계속된다.
- 근거: `MotifSpec.scope`는 `whole/partial`로 제약되고 `style`·`view`가 검색 품질을 크게
  좌우한다. 규칙 기반으로는 한국어 문장에서 이 축을 못 뽑는다. 비용은 출력 6필드로 무시 가능.
- 위치: worker(`motifs/spec.py` 신규). api는 문장을 그대로 넘긴다.

### 2. api 표면 정리

- `POST /design/sessions/{id}/motifs/search` 신설 — 바디 `{ "query": str }`, 응답
  `{ "results": [{ motif_id, name, preview_svg, similarity }] }` 최대 4개 + `current` 표시.
  내부에서 spec 변환 → 기존 `motif_candidates` 호출. 무과금 유지.
- `POST /design/sessions/{id}/motifs/generate` — 바디를 `{ "prompt": str }`로 바꾼다(현재
  `MotifSpec` 직결). 내부에서 spec 변환. 예산·환급 로직은 **그대로**.
- 두 응답 모두 `preview_svg`를 포함한다(프론트가 썸네일을 바로 그린다).
- `POST /design/sessions/{id}/motifs/activate` 신설 — 바디 `{ "slot": 1|2, "motif_id": str }`.
  현재 intent의 해당 모티프 슬롯을 교체하고 결정론 재렌더 → 새 스텝을 만든다.
  **모델 호출 없음**(모티프 id만 바뀌고 나머지 intent는 불변).

### 3. `PatternConstraints` 전면 폐기

삭제 대상(참조 전부):

| 계층 | 파일 |
|---|---|
| worker | `engine/constraints.py`의 `PatternConstraints`·`_apply_pattern`(`:269`)·`_density_axis_count`·`_lattice_placement`·`_scatter_placement`·`pattern_prompt_lines`(`:491`), `assert_constraints_satisfied`의 pattern 절 |
| worker | `api/schemas.py`(요청 필드), `api/routes.py`(전달·진단 `pattern_controls`), `adapters/gemini.py`(프롬프트 줄), `authoring/retrieval.py`(검색 필터), `engine/candidates.py` |
| api | `domains/design/router.py`(요청·턴 payload) |
| store | `features/design/model/draft.ts`, `ui/pattern-settings-modal.tsx`, `api/context-tools.ts`, `pages/design/index.tsx` — 4단계에서 파일 자체가 사라지므로 여기서는 서버 계약만 끊고 store는 4단계에 맡긴다 |
| 문서 | `docs/specs/design-generation-controls.md` **파일 삭제**, `docs/api-spec/worker-engine.md`·`worker-pipeline.md`·`worker-motifs.md`의 4축 서술 삭제 |
| 테스트 | `test_constraints.py`의 pattern 케이스, `test_api_generate.py`·`test_adapters.py`·`test_authoring_store.py`의 관련 케이스 |

`apply_generation_constraints`는 **팔레트 강제(`_apply_fixed_palette`)와 lattice 겹침 clamp만**
남긴다. 겹침 clamp는 품질 가드라 유지한다(`_clamp_lattice_overlap`, `lattice_size_limit`).

`PaletteConstraint`(색 지정)는 **유지**한다 — 레일의 `색 지정`이 계속 쓴다.

### 4. 모티프 슬롯 계약 확인

- 슬롯은 최대 2개. 기존 하드 가드(`resolve_motifs` 이후 "exceeds 2 distinct motifs")를 유지한다.
- `motifs/activate`가 슬롯 2에 넣을 때 현재 intent에 모티프 레이어가 1개뿐이면 레이어를
  하나 추가해야 한다. 추가 레이어의 배치·크기는 **기존 레이어에서 파생**(같은 lattice, 위상만
  이동)시켜 결정론을 유지한다. 모델 호출 금지.

## 검증

- `motifs/search`: 무과금(잔액 불변), 결과 4개 이하, `preview_svg` 유효 SVG
- `motifs/generate`: 예산 차감 → 실패 시 환급, `reused=true`면 환급, 세션 상한 초과 시
  `recraft_budget_exhausted`
- `motifs/activate`: 모델 호출 0, 새 스텝 1개, 같은 입력 → byte-identical SVG
- `grep -rn "pattern_constraints\|PatternConstraints" apps/ docs/` 결과 0건(store 제외, dist 제외)
- `pnpm codegen` 후 생성물 커밋

## 완료 판정

1. 문장 하나로 검색 → 결과 4개 → 슬롯 교체까지 API만으로 왕복된다(테스트로 고정)
2. `docs/specs/design-generation-controls.md`가 삭제됐고 링크가 남아 있지 않다
3. 4축 관련 코드·테스트·문서가 남아 있지 않다
4. 팔레트 고정과 lattice 겹침 clamp는 그대로 동작한다

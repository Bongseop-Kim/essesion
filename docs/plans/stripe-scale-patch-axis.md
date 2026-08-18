# 패치 scale 축 — "패턴을 크게/작게"를 타일 배율로 해석

**계기**: seamless-log `e20b99e9-31da-4d73-b9cb-6bb199eb94d8`. "모든 줄무늬 폭과 간격을
1.5배" 요청에 패치 모델은 `period_mm 33.94→50.91`을 정확히 냈지만, seamless 불변식
`tile == k·period·hypot(p,q)` 때문에 `_repair_stripe_period`(`engine/validate.py:164`)가
period를 33.94로 재스냅하고 밴드 폭도 같은 비율로 원복했다 — 요청이 조용히 상쇄돼
픽셀 단위로 동일한 결과가 나갔다(경고 1줄만 남음).

**구조적 원인**: 대각선(45°) 줄무늬의 화면상 굵기는 `period/tile = 1/(k·√2)`로
양자화되고 k=1(0.707)이 최대치다. 프론트는 `tile_mm`을 보지 않고 타일 1장을 고정
비율로 반복한다(`svg-preview.ts:23` 62%, `tie-canvas.tsx:45` tileFraction). 즉 타일
**내부**에서는 연속적인 "더 굵게"가 나올 수 없다.

**전제(2026-08-19 사용자 확정)**: 이 SVG/래스터를 **그대로 실물 출력에 넣지 않는다.**
`tile_mm`의 물리적 의미(실제 원단에서 몇 mm인가)는 고려 대상이 아니며, 중요한 것은
**화면에서 어떻게 보이는가**뿐이다. 따라서 tile_mm을 배율 캐리어로 써서 값이 커져도
생산 공정 관점의 문제는 없다.

**결정**: 패치 계약에 `scale` 축을 추가하고, 적용은 **intent의 모든 길이(mm)를
`canvas.tile_mm` 포함해 일괄 f배**로 한다. 균일 배율은 모든 seamless 불변식
(`tile == k·period·hypot`, `divides(tile, cell)`, wave λ | closure, `size ≤ tile`)을
정확히 보존하므로 재스냅이 걸리지 않고, 각도(대각선)도 그대로다. 프론트는 SVG 루트의
물리 폭(`width="72mm"`)을 읽어 반복 배율을 비례시킨다.

새 표시 전용 필드가 아니라 `tile_mm`을 배율 캐리어로 쓰는 이유: 배율이 **SVG 자체에
실려** 별도 API 필드·세션 컬럼·로그 스키마 없이 모든 소비자(store 캔버스·썸네일·admin
로그 뷰·fabric 목업)가 같은 값을 본다. 물리 의미는 위 전제대로 없으므로 부작용도 없다.

**커버 범위**: "전부 N배"는 scale 단독. "줄무늬 굵게 + 모티프 시각 크기 유지"는
scale + `motif_size_mm`(최종 프레임 절대값) 조합 — §1의 적용 순서가 이를 보장한다.
"특정 밴드만 확대"는 §2 백스톱 덕에 period 확장 + 밴드별 값으로 표현 가능(커버리지
0.75 상한도 period가 커져 여유가 생긴다). **범위 밖**: 모티프 간격(배치 밀도)까지
고정한 채 줄무늬만 확대 — 배치 재계산이 필요해 별도 플랜.

관련 정본: `docs/api-spec/worker-pipeline.md` §패치 계약, `docs/api-spec/worker-engine.md`
§3(불변식)·§repair. 실행 시 두 문서를 함께 갱신할 것.

## 작업

### 1. worker — 패치 스키마·적용 (`apps/worker/src/worker/engine/patch.py`)

- `DesignPatchV1`에 `scale: float | None = Field(default=None, ge=0.25, le=4.0)` 추가,
  `PATCH_AXES`에 `"scale"` 추가(`changed_axes` 자동 반영 확인).
- `_apply_scale(raw, factor)` 신설 — intent dict의 길이 필드를 일괄 f배(round 6):
  - `canvas.tile_mm`
  - stripe `params.period_mm`, `bands[].offset_mm/width_mm`
  - motif `params.size_mm`
  - placement: `lattice.cell_w_mm/cell_h_mm/offset_x_mm/offset_y_mm`,
    `scatter.min_dist_mm`, `path.spacing_mm/phase_mm/wavelength/amplitude/points[][]`
  - **각도·비율·seed·dpi는 불변**. 필드 누락이 곧 seam 버그이므로 `intent.py`의
    mm-단위 필드 전수와 대조해 작성한다.
- **누적 클램프**: 적용 후 `tile_mm`이 `[12, 192]`(기본 48의 ¼~4배)를 벗어나면 그
  경계에 맞는 유효 배율로 줄이고 경고를 남긴다. 근거: dpi 고정이라 래스터 픽셀 수가
  tile²로 늘어난다(300dpi에서 192mm ≈ 2268px). inlay 경로의 `_MAX_INLAY_PIXELS`가
  이 상한에서 걸리지 않는지 구현 시 확인.
- **적용 순서**: scale(또는 §2 백스톱)을 먼저 적용해 tile 프레임을 확정하고,
  `motif_size_mm`은 그 **뒤**에 최종 프레임의 절대값으로 적용한다(새 tile로 클램프).
  이래야 "줄무늬 굵게 + 모티프는 그대로"를 `scale + motif_size_mm=[현재값]`으로 표현할
  수 있다 — 모델이 스냅샷에서 본 현재값이 곧 최종 시각 크기가 된다. stripe 밴드는
  §2 백스톱 프레임에서 verbatim으로 처리하므로 scale과 중복 배율되지 않는다.

### 2. worker — off-grid period의 결정론적 백스톱 (핵심 수정)

프롬프트를 고쳐도 모델이 scale 대신 `stripe.period_mm`으로 확대를 표현할 확률은
남는다 — 그 경로가 지금처럼 스냅 원복되면 원래 버그가 확률적으로 재발한다. 따라서
`_apply_stripe`에서 **요청 period가 off-grid면 period를 스냅하지 않고 tile을
배율한다**: `f = 요청 period / 현재 period`로 **줄무늬를 제외한 나머지**(tile, 모티프
크기·배치)를 `_apply_scale`로 f배(같은 클램프)하고, **줄무늬 params는 모델이 낸 값을
verbatim** 유지한다 — 새 tile에서 요청 period는 정확히 on-grid가 된다(같은 k).
전부 f배로 뭉개면 모델이 밴드별로 다르게 낸 값(예: "빨간 밴드만 1.5배")이 사라지므로
verbatim이 핵심이다. 이러면 모델이 scale 축이든 period 축이든 시각적 결과가 동일하고,
밴드별 확대도 period 확장으로 표현된다(커버리지 0.75 검증은 새 period 기준).
`_repair_stripe_period`(validate)는 authoring 등 다른 진입로의 최후 방어선으로 유지.

### 3. worker — 프롬프트·스냅샷 (`apps/worker/src/worker/adapters/llm.py`, `engine/patch.py`)

- `_build_patch_prompt`에 추가: ① 전체를 키우거나/줄이는 요청("전부 1.5배", "패턴을
  더 크게/작게")은 `scale` 축, 줄무늬 폭만 바꾸는 요청은 `stripe.bands` ② scale과
  함께 모티프의 시각 크기를 유지하려면 `motif_size_mm`에 현재값을 그대로 넣으라는
  규칙(적용 순서상 최종 프레임 절대값).
- `_snapshot`에 `scale: {current, min, max}`(현재 tile/48과 잔여 여유)를 추가 —
  고객용 `note`는 LLM이 클램프 **전에** 쓰므로, 상한을 미리 알려줘야 "10배로
  했어요"라고 쓰고 실제는 4배가 나가는 안내 불일치를 줄일 수 있다.
- `PATCH_PROMPT_REVISION` 갱신 (`design-patch-v3-scale-…`).

### 4. store — 반복 배율 (`apps/store/src/features/design/model/svg-preview.ts` 외)

- `svgTileScale(svg): number` 신설 — 루트 `width="Nmm"`을 정규식으로 읽어 `N/48`
  반환(파싱 실패·비정상값은 1). API·타입 변경 없음(값이 SVG 안에 이미 있다).
- **메인 캔버스만 완전 비례**: `packages/shared/src/components/tie-canvas.tsx`에
  `tileScale?: number`(기본 1) prop → `tileFraction[mode] * tileScale`.
  호출부(`design-canvas.tsx` → `pages/design/index.tsx`)에서
  `svgTileScale(history.currentSvg)` 전달. tie(마스크) 모드도 같은 prop 경유라 함께
  비례한다.
- **썸네일은 클램프**: `svgTileStyle`의 `62% × scale`은 최대 100%로 캡 — scale
  1.6부터 타일 1장이 카드보다 커져 "단색 확대"처럼 보이는 것을 방지. 히스토리
  카드·모달·세션 목록은 `svgTileStyle` 경유라 자동 반영.

### 5. 테스트

- `apps/worker/tests/test_patch.py`: ① scale 1.5 → tile 72·period 50.91·밴드 26.8,
  `validate_intent` 경고 없음(재스냅 미발생) ② 모티프+lattice 디자인에 scale 적용 후
  `assert_seamless_invariants` 통과 ③ 누적 클램프(scale 4 두 번 → 192에서 멈춤+경고)
  ④ `changed_axes`에 `scale` 포함 ⑤ **백스톱**: scale 없이 off-grid `period_mm`만 담은
  patch → tile이 배율되고 시각 비율이 요청대로 나옴 ⑥ **밴드별 확대**: off-grid period
  + 비대칭 bands(빨강만 1.5배) → 밴드 값 verbatim 유지, 새 tile에서 on-grid, 불변식
  통과 ⑦ **모티프 유지**: scale 1.5 + motif_size_mm=[현재값] → tile·period는 1.5배,
  모티프 size_mm은 그대로.
- `svg-preview.test.ts`: `width="72mm"` → 1.5, 파싱 실패 → 1, 썸네일 캡.
- tie-canvas 스냅샷/단위 테스트가 있으면 `tileScale` 케이스 1개.

### 6. 명세 갱신 (코드와 같은 커밋)

- `worker-pipeline.md` §58 패치 축 목록에 scale 추가(배경색·줄무늬·배치·크기·팔레트·**전역 배율**)
  + off-grid period → tile 배율 백스톱.
- `worker-engine.md`에 "균일 배율은 불변식 보존" 한 줄과 tile 클램프 범위, 그리고
  **tile_mm은 물리 치수가 아니라 화면 배율 캐리어**라는 전제(실물 출력에 이 파일을
  그대로 쓰지 않음 — 2026-08-19 확정)를 명시.

## 하지 않는 것

- API/api-client 변경 없음 — `DesignPatchV1`은 worker 내부 계약, 프론트 입력은 SVG 자체.
- DB 마이그레이션 없음, 과금 변화 없음(구성 수정 = 기존 `design_edit_cost`).
- 기존 세션·로그 영향 없음 — scale이 없는 intent는 tile 48로 지금과 동일하게 렌더.
- 실물 출력용 치수 보정 없음 — 위 전제대로 이 파일은 그대로 출력물에 들어가지 않는다.

## 검증

- worker: `uv run pytest apps/worker/tests/test_patch.py apps/worker/tests/test_validate.py`
- store: `pnpm --filter store test`, `pnpm typecheck`
- 수동: worker 재시작 후(‼ `--reload` 없음) 해당 세션에서 "전부 1.5배" 재요청 →
  브라우저(Aside)로 줄무늬가 실제로 굵어졌는지, 45° 유지·seam 없음 확인.

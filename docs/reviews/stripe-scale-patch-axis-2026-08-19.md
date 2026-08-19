# 패치 scale 축 실행 결과 (2026-08-19)

플랜 `docs/plans/stripe-scale-patch-axis.md` 실행 완료. 계기는 seamless-log
`e20b99e9`("전부 1.5배" 요청이 `_repair_stripe_period` 재스냅으로 조용히 원복).

## 구현

- **worker** (`engine/patch.py`): `DesignPatchV1.scale`(0.25~4.0) + `PATCH_AXES` 추가.
  `_apply_scale`이 intent의 모든 mm 길이(tile 포함)를 일괄 f배 — 균일 배율은 seamless
  불변식을 보존해 재스냅이 안 걸린다. tile은 [12, 192]mm 누적 클램프(경고).
  적용 순서: scale/백스톱 → placement → `motif_size_mm`(최종 프레임 절대값).
- **백스톱** (`_apply_stripe`): 기존 stripe에 off-grid `period_mm`이 오면 period를
  스냅하지 않고 `f = 요청/현재`로 나머지(tile·모티프)를 배율, 줄무늬 params는 verbatim
  유지 — 밴드별 값("빨간 밴드만 1.5배")이 살아남고 새 tile에서 같은 k로 on-grid.
  `_repair_stripe_period`는 authoring 등 다른 진입로의 최후 방어선으로 유지.
- **프롬프트/스냅샷** (`adapters/llm.py`, `composition_snapshot`): scale 축 사용 규칙 +
  "모티프 시각 크기 유지 = motif_size_mm에 현재값" 규칙, 스냅샷에
  `scale:{current,min,max}`(클램프 전 note 안내 불일치 방지).
  `PATCH_PROMPT_REVISION = design-patch-v3-scale-axis-openai-v1`.
- **store**: `svgTileScale(svg)`이 SVG 루트 `width="Nmm"`에서 N/48을 읽는다(실패 시 1).
  메인 캔버스(TieCanvas `tileScale` prop, tie 마스크 모드 포함)와 다운로드 PNG
  (`tie-image.ts`)는 완전 비례, 썸네일(`svgTileStyle`)은 62%×scale을 100%로 캡.
- **명세**: `worker-pipeline.md` §패치 계약, `worker-engine.md` §repair에 전역 배율·
  클램프 범위·"tile_mm은 화면 배율 캐리어(실물 출력에 미사용, 2026-08-19 확정)" 명시.

확인 사항: `_MAX_INLAY_PIXELS`(20M)는 192mm@300dpi(2268² ≈ 5.1M)에서 안 걸린다.
API/api-client·DB·과금 변화 없음.

## 검증

- `uv run pytest apps/worker/tests/test_patch.py apps/worker/tests/test_validate.py` — 65 passed
  (scale 배율·불변식·누적 클램프·changed_axes·백스톱·밴드 verbatim·모티프 유지 신규 8건 포함)
- `apps/worker/tests/test_api_generate.py test_adapters.py` — 116 passed
- `pnpm --filter store test`(221) · shared test(66) · `pnpm typecheck` · `pnpm lint` ·
  `pnpm architecture:check` — 전부 통과
- 수동 미실시: worker 재시작 후 해당 세션에서 "전부 1.5배" 재요청(브라우저 확인)은 남음.

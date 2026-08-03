# 모티프 색 고정 플랜 — 슬롯 기계 제거·프롬프트 직송

> 모티프 생성과 디자인 생성이 분리되면서 디자인 단계에서 모티프 색을 바꾸는 기능이 사라졌다.
> 이에 따라 확정한 결정: **(1) 모티프 색은 생성 시점에 고정 — 색 슬롯 기계 전체 제거,
> (2) 모티프 문장의 Gemini 전처리(facet 추출) 제거 — 사용자 문장을 그대로 사용(한국어 수용),
> (3) 프롬프트 금지문은 Recraft API 파라미터(`negative_prompt`, `controls.no_text`)로 이관.**
> Recraft 외부 API 스펙 실측 결과(2026-08-03, `external.api.recraft.ai/doc/spec/`):
> `negative_prompt`·`controls.{no_text,background_color,colors,artistic_level}`·`substyle:"seamless"`는 지원,
> `transparent_background`·`disable_gradient_fills`는 내부 스키마 전용으로 외부 미노출.
> 따라서 **배경 제거·gradient 차단 게이트(`gate_recraft_svg`)는 존치**한다.
>
> **작업 원칙: 현재 개발 단계다. 하위호환·레거시 경로·deprecated 잔재를 일절 남기지 않는다.**
> 코드·설정·스키마·API 필드 모두 완전 삭제가 기본이고, 과거 데이터·컬럼·테이블이 남으면 지운다.

## 1. 색 슬롯 기계 제거 (worker)

색을 `s0..sN` 토큰/currentColor로 치환하던 것을 중단하고, 모티프 symbol에 생성 당시의
concrete hex를 그대로 저장한다.

- `motifs/normalize.py` — `_slotize_colors`·`_quantize_colors` 제거, `max_color_slots` 파라미터 제거.
  `NormalizedMotif`에서 `color_slots`·`slot_colors` 제거. 단색 모티프의 currentColor 치환도 중단
  (concrete hex 유지). `_standalone_preview_svg`의 슬롯 복원 로직 불필요 → preview == symbol 수렴 검토.
- `engine/` — 모티프 레이어에서 색 개념 제거:
  - `intent.py` `MotifParams`: `color`/`colors` 필드와 "exactly one of" 검증 제거.
  - `composition.py`: 멀티컬러 branch(`slot_render_symbols`, instance-major/slot-minor 겹침) 제거,
    `<use>`에 `color` 속성 미지정.
  - `validate.py`: 슬롯 전량 매핑 검증 제거. `patch.py`: 모티프 슬롯 색 패치 경로 제거.
  - 팔레트 엔진(`palette.py`)은 스트라이프·그라운드용으로 존치.
- `authoring/` — `schema.py` `MotifLayerPlan.color_indices` 제거(플랜 LLM 프롬프트의 관련 지시문도 함께),
  `compiler.py` 슬롯 매핑·`motif_color_slots` 제거, `preview.py` 슬롯 수 매칭 제거.
- `motifs/labeler.py` — 슬롯별 시맨틱 라벨(primary/accent…)이 존재 이유를 잃음 → 모듈과 호출부 제거.
- `adapters/recraft.py` — `generate_motif`의 `colors` 파라미터·`recraft_max_color_slots` 소비 제거.
- `config.py` — `recraft_max_color_slots` 제거. `/motifs/import`(업로드 정규화)도 양자화 없이 통과.
- `api/schemas.py`·`api/routes.py` — 응답에서 `color_slots` 제거.
  주의: `MotifSlotInput`의 `slot: Literal[1,2]`는 **디자인 내 모티프 위치**로 색 슬롯과 무관 — 건드리지 말 것.

## 2. DB·데이터 처리

- Alembic 마이그레이션(`db/` 경유)으로 `motifs.color_slots`·`slot_colors`·슬롯 라벨/파트명 컬럼 제거.
  bake·백필 같은 이행 로직은 두지 않는다.
- 기존 행의 symbol에는 `s0..sN` 토큰·currentColor가 박혀 있어 그대로는 렌더 불가 → **기존 데이터 폐기**:
  마이그레이션에서 motifs·user_motifs(및 모티프를 참조하는 디자인 세션 잔재)를 비우고
  `seed_motifs.py` 재실행으로 새 normalize 산출물(concrete 색, 새 content-hash id)만 남긴다.
- 슬롯 제거로 의미를 잃는 컬럼·인덱스·시드 데이터가 더 발견되면 같은 마이그레이션에서 함께 지운다.

## 3. Gemini 전처리 제거 (문장 직송)

- `motifs/spec.py` 삭제. `routes.py:1154`(search)·`:1292`(generate)에서
  `{"subject": query, "scope": "whole"}`를 인라인 구성 (기존 폴백 경로와 동일한 형태 — 검색 래더·
  임베딩·C-10 facet 살균은 무변경으로 동작).
- 임베딩은 `gemini-embedding-001`(다국어)이라 한국어 문장 그대로 임베딩 가능 — 변경 없음.
- `style_hint`(api가 현재 플랜에서 추출해 전달)는 LLM 없이 Recraft 프롬프트에 한 줄로 직접 삽입.
- search/generate 요청의 `query` 상한(현 100자)은 문장 직송에 맞게 상향 검토(예: 200).

## 4. Recraft 프롬프트 재작성

`_build_recraft_prompt`를 facet 나열 대신 **사용자 문장(한국어 그대로) + 최소 제약**으로 재구성:

- payload에 `negative_prompt` 추가: "pattern, tiled, repeated, background, gradient, text,
  photorealistic shading, raster texture" 계열.
- `controls: {"no_text": true}` 추가.
- 본문 프롬프트는 "단일 오브젝트·투명 캔버스·flat solid vector" 제약 + `문장` + (있으면) `style_hint`.
- 게이트 실패 시 1회 재프롬프트(오류 목록 첨부) 메커니즘은 유지.
- `gate_recraft_svg` 존치: raster/gradient 오류, 전면 배경 제거, rgb→hex — API가 대신 못 해주는 부분.
- 한국어 수용은 확정이나 `prompt_has_unknown_language` 오류 코드가 존재하므로,
  구현 첫 단계에서 라이브 1회 실측으로 확인.

## 5. 파급 (api·프론트·계약)

- api: `domains/design/router.py`·`admin/generation.py`의 `color_slots` 노출 제거.
  스펙 변경이므로 `pnpm codegen` 후 api-client 생성물을 같은 커밋에.
- store: `motif-modal`·`motif-panel` 등에서 슬롯 표시 제거(모티프는 원색 그대로 미리보기).
- admin: `motifs/detail.tsx`의 슬롯 토큰 복원 로직, `authoring/motif-picker.tsx`의 "N색 슬롯" 표기 제거.
- **골든 테스트**: 모티프 색이 팔레트로 렌더되던 계약이 바뀌므로 `tests/golden/`의 모티프 관련
  골든 SVG/JSON 재생성. seamless-tile 대비 byte-identical 계약은 모티프 색 경로에 한해 공식적으로 이탈
  (이미 제품이 분기한 부분) — `test_motif_parity.py` 범위를 그에 맞게 축소하고 사유를 리뷰 문서에 기록.

## 검증

- `uv run pytest` (worker: normalize/resolver/engine/authoring, api: design/admin_generation) 전체 통과.
- `uv run ruff check .`·`uv run pyright`·`pnpm lint`·`pnpm turbo build typecheck test`.
- 라이브 실측 1회(RECRAFT_API_KEY 필요): 한국어 문장으로 `/motifs/generate` → 게이트 통과·원색 저장 확인,
  `negative_prompt`·`controls.no_text` 수용 확인.
- 시드 재실행 후 `select source, count(*) from motifs group by source` 확인, store에서 모티프
  검색→생성→디자인 배치 플로우 브라우저 확인(Aside).

## 상태 — 계획

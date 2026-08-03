# 모티프 색 고정 후속 — 리뷰 지적 일괄 수정·레거시 정리 실행 리뷰

실행일: 2026-08-03  
선행 기록: `docs/reviews/motif-fixed-colors.md`

머지 전 리뷰(도메인별 병렬 검토)에서 나온 결함을 전부 수정하고, 사용자 결정에 따라
레거시(구 마이그레이션 체인, 세션 고정 팔레트 UI)를 삭제했다.

## 색 고정 계약 결함 수정

- **루트 `<svg>` presentation 속성 소실**: normalize가 루트를 버리면서 루트의
  `fill`/`stroke`/`stroke-width`/`opacity`가 사라져 색이 다른 문서가 같은 motif ID를
  받거나(빨간 원=검은 원) stroke 전용 문서가 투명 모티프가 됐다. 루트에 해당 속성이
  있으면 자식 전체를 그 속성을 단 `<g>`로 감싸 보존한다(opacity는 그룹 시맨틱이라
  hoist가 아닌 래핑). worker-motifs.md §1에 상속 규정 반영.
- **paint canonicalize**: `#FF0000`/`#f00`/`rgb(255,0,0)` 표기 차이가 서로 다른 motif
  ID를 만들던 것을 normalize에서 소문자 6/8자리 hex로 정규화해 해소. named color·
  Pantone·`url(#...)` paint는 오류로 거부 — `<pattern>` paint server 침투도 이 층에서
  차단된다. rgb→hex 변환은 `normalize.rgb_to_hex` 한 곳으로 모아 recraft가 공유.
- **빈 렌더 거부**: render gate가 완전 투명 래스터(`motif renders nothing`)를 거부.
- **Recraft `<style>` 태그**: 클래스 셀렉터 채색이 조용히 검정이 되던 것을 gradient처럼
  오류로 올려 재프롬프트를 유발.
- **배경 제거 오탐**: `_find_backgrounds`를 `rect`로 한정 — viewBox 90%+를 채우는
  원반형 모티프 본체가 삭제되던 오탐 제거(full-bleed path 배경이 남는 ceiling은 주석).
- **재시도 프롬프트 클램프**: sanitize 에러 원문 무제한 삽입으로 V2/V3 1000자 상한을
  넘을 수 있던 것을 건당 160자로 클램프.
- **inlay 마스크를 기하학 기반으로 교체**(`render/motif_mask.py` 신설): full/base 채널차
  threshold 방식은 바탕과 비슷한 모티프를 통째로 증발시키고 팔레트 동색 부분의 실루엣을
  갈랐다. 마스크 전용 렌더(모티프=흰색, 그 외=검정, z-order 오클루전 유지)로 교체.
  트레이드오프: yarn_dyed 모티프 경로 래스터 3회→4회(근거는 worker-pipeline.md).
- **relief 스킵 수정**: 마스크가 비면 슬롯 경계 relief까지 건너뛰던 조기 반환 제거.
- **named_colors raise 복원**: 지명색을 배치할 슬롯이 없을 때 조용히 무시하던 두 경로를
  raise로 복원해 Gemini 재저작 피드백 루프를 타게 함.
- **style_hint를 검색·생성 spec의 `style` facet에 반영** — 저장 facet·임베딩 descriptor에
  들어간다. 단 variant_group_key는 미변경(아래 미해결 참조).

## 레거시 삭제

- **마이그레이션 스쿼시**: 3개 체인(dadd999bf858→6c4f2a9d1b7e→c93e4a7b2d10)을 새 baseline
  `a3f1c05e7d24` 하나로 합성, 기존 파일 삭제. 스크래치 DB 적용 결과와 라이브 스키마의
  pg_dump diff 0 확인. 기존 DB는 `alembic_version`을 새 id로 갱신하거나 재생성한다.
  단일 baseline 유지 정책은 db/README.md에 기록.
- **세션 고정 팔레트("색 지정") 전면 제거**: 모티프 색 고정 정책과 상충하는 사용자 색
  지정 UI를 store에서 삭제(ToolRail 항목, ColorSettingsModal, DesignPalette, 사진 색
  추출 플로우). 소비자가 store뿐임을 확인하고 api 표면도 삭제 — `POST
  /design/palette/extract`, 생성/아이디어 요청의 `palette` 필드. patch 경로의 palette
  축("배경을 네이비로")과 admin diagnostics의 읽기 전용 `fixed_palette`는 별개 기능이라
  유지. api-client 재생성 포함.
- `circle.svg` 에셋을 `seed_motifs._SEEDS` 인라인으로 이동(에셋 파일명 템플릿이 "outline
  icon" 라벨을 강제해 실물과 어긋나던 문제). content-hash id 불변.

## 신설

- **`apps/worker/scripts/seed_design_examples.py`**: 첫 진입 갤러리(design_examples) 시드.
  gallery-v1 플랜 6종을 결정론 컴파일 경로로 렌더해 run+예시를 upsert — 외부 API·GCS
  불필요, 멱등. 부트스트랩 순서는 AGENTS.md·docs/CHECKLIST.md에 반영.
- 죽은 코드 정리: `validate_intent`/`segment()`의 `motifs` 파라미터,
  `gemini.exact_motif_metadata`, `MotifUpsertResult`, admin 죽은 분기·항진명제 테스트 등.
- admin motif-picker: 검색 maxLength를 서버 계약(100)에 맞추고 2자 미만 가드 추가.
- 회귀 테스트: colorway 전환 시 모티프 symbol paint 불변 assert 추가.

## 검증

```text
uv run pytest                                      1195 passed
uv run ruff check . && uv run ruff format --check  통과 (261 files)
uv run pyright                                     0 errors
pnpm lint                                          537 files + check-harness 통과
pnpm turbo build typecheck test                    11/11 tasks 통과 (admin build는 VITE_API_BASE_URL 필요)
pnpm codegen                                       재생성 후 드리프트 없음
uv run pytest tests/test_migrations.py             통과 (downgrade→upgrade→alembic check)
```

- `[E2E] 대상: store 갤러리 예시 시작→캔버스 렌더 | 이유: API 계약(palette 삭제)·DB
  스키마(스쿼시)·갤러리 시드 신설 | 결과: PASS` — Aside 브라우저에서 seeded customer로
  갤러리 6종 노출, "흩뿌린 꽃" 무과금 시작, 원색 모티프 렌더, 도구 레일에 색 지정 부재,
  콘솔 오류 0 확인.

## 후속 결정 (같은 날 실행 완료)

1. **모티프 정체성 = 사용자 문장 (style_hint 전면 제거)**: 같은 문장은 언제 누가
   요청해도 같은 모티프를 의미한다 — 다른 스타일을 원하면 문장을 바꾼다("미니멀한
   동백꽃"). 이 정책과 어긋나던 숨은 입력, 즉 현재 디자인 플랜의 모티프 style 문구를
   Recraft 프롬프트에 `Style context:`로 주입하던 style_hint를 api 파생·전달·워커
   스키마·프롬프트에서 전부 제거했다(최초 생성자의 디자인 톤이 문장의 영구 기본값이
   되는 복불복 해소). 재사용 판정 로직은 무변경. 필드 재유입은 StrictRequest 422
   회귀 테스트로 고정.
2. **프롬프트의 모티프 언급 감지**: "stripe 없는 플랜 + 잔여 지명색" 상황은 색 배치
   실패가 아니라 디자인 문장 안에서 모티프 작업을 요청한 경우로 재규정 — 워커 감지 →
   api 시그널 → store 모티프 피커 유도 플랜을 `docs/plans/motif-mention-signal.md`로
   남겼다(미실행). 그때까지 현행(재저작 루프 후 422)을 유지한다.
3. **fixed palette 레거시 삭제**: 엔진 PaletteConstraint fixed 모드·가시성 검증,
   compiler 검사, gemini 프롬프트 분기, worker `/palette/extract`와 photo_svg
   `extract_palette`, worker 요청 palette 필드, api/admin의 `fixed_palette` 진단
   표면까지 제거. patch 경로의 palette 축·지명색 접지·colorway·`engine/palette.py`는
   보존. 골든 재생성 불필요(auto 경로 출력 불변) 확인.

최종 재검증: pytest 1187 passed, ruff check/format·pyright 클린, pnpm lint·turbo
11/11, codegen 드리프트 없음.

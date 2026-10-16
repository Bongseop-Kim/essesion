# 배치형(placement) 넥타이 디자인 — 반복 타일 위에 한 번만 놓이는 요소

넥타이 한 장에 **한 번만** 놓이는 무늬(대각 분할, 한쪽 S자 곡선 띠, 한쪽 세로 금선, 넝쿨 가지, 붓 터치,
V자 분할)와 **한 번만 놓이는 포인트 로고**를 엔진·api·store에 넣는다. 2026-10-16 사용자가 참조
10종 중 배치형 6종을 근사(큰 타일) 대신 "배치형 기능부터 개발"로 결정했다. 반복형 4종은 이 플랜 없이
먼저 추가됐다(커밋 `a1ea3dd`).

- 참조 이미지: `/Users/gimbongseob/Downloads/735834f4-fa42-426c-b838-c86fd677993f.png`의 01 ALTIS(대각
  분할+사선 한 줄)·02 MONDRÉ(왼쪽 세로 금선+끝 점)·03 BELLEN(한쪽 S자 곡선 띠 3겹)·05 TRENZ(V자 분할+
  와인 띠)·08 CÉDRIC(넝쿨 잎가지)·09 NEXION(붓 터치). 파일이 없으면 사용자에게 다시 받는다.
- 템플릿 제작 절차·엔진 함정은 `.claude/skills/tie-template/SKILL.md`가 정본이다 — 7단계 전에 읽는다.

## 왜 필요한가

- 엔진은 seamless 타일 반복만 안다(`docs/api-spec/worker-engine.md` §2 — compose는 `<pattern>` 한 장을
  깐다, §3 seamless 불변식 assert). "한쪽에만 있는 곡선"·"대각 분할"을 표현할 레이어가 없다.
- 타일을 키우는 우회(tile_mm 3~4배)는 목록 카드에선 한 번만 보이지만 긴 실사 컷(상세)에서 3~4번
  반복된다 — 사용자가 2026-10-16 기각.
- 포인트 로고도 같은 한계다. 지금은 `logo_slot` 모티프가 무늬 레이어에 반드시 있어야 해서 로고가 무늬에
  작게 반복된다(스킬 "로고" 절). 배치형 요소가 생기면 로고를 **한 번만** 놓을 수 있다 — 두 번째 효과.
- 생산 흐름(2026-10-16 사용자 확인): 공장에는 **타일 이미지와 실사화 이미지를 둘 다** 보내고, 디자이너가
  어차피 다시 그린다. 그래서 타일이 배치형을 못 담아도 문제없다 — 배치형은 **실사화 이미지(와 미리보기)에
  보이기만 하면** 된다. 생산용 전체 패널 파일 포맷은 만들지 않는다.

## 범위 밖

- 저작 모델(LLM)·구성 patch가 배치형 요소를 **새로 만드는** 것 — 이번엔 시드 템플릿만. authoring-plan-v3
  계약은 손대지 않는다(단, patch가 기존 panel을 **보존**하는지는 검증한다).
- 붓 터치의 실감 질감(AI 생성) — 손그림 벡터 모티프로 근사한다.

## 실행 조건

- 선행: 반복형 템플릿·스킬 커밋(`a1ea3dd`·`837b8a3`)이 브랜치에 있을 것 — 2026-10-16 충족.
- 명세 변경이 포함된다 — `docs/api-spec/worker-engine.md`·`worker-pipeline.md`·`domains.md`를 같은
  변경에서 갱신한다(대원칙). api 스키마가 바뀌므로 `pnpm codegen` 결과를 같은 커밋에 넣는다.
- 운영 반영: deploy.yml은 api를 worker보다 먼저 배포한다(`.github/workflows/deploy.yml:77-79`). Intent는
  `extra="forbid"`라 옛 worker는 panel이 든 intent를 거부한다 — **운영 시드(배치형 템플릿)는 배포가 끝난
  뒤** 실행한다.

## 데이터 경로 — panel이 지나가는 곳 (빠뜨리면 조용히 깨진다)

| 단계 | 위치 | 할 일 |
|---|---|---|
| intent 모델 | `apps/worker/src/worker/engine/intent.py:186` `Intent` | `panel` 필드 |
| 카탈로그 범위 | `apps/worker/src/worker/motifs/registry.py:52` `iter_motif_ids` | **panel motif id도 수집** — 안 하면 카탈로그 조회에서 빠져 렌더 실패 |
| 합성 | `apps/worker/src/worker/engine/compose.py:36` `compose_design` | `panel_svg` 생성 |
| 워커 응답 | `apps/worker/src/worker/api/schemas.py:162` `DesignOut` | `panel_svg: str \| None` |
| 생성 로그 | 같은 응답의 design 객체가 `seamless_generation_logs.design`에 저장 | 필드가 따라 들어가는지 확인 |
| api 수신 | `apps/api/src/api/domains/design/router.py:380` `WorkerDesignOut` | 필드 추가 |
| 세션 미리보기 | `router.py:579` `_pointer_svg_query` → `router.py:130` `DesignSessionOut.preview_svg` | `preview_panel_svg` 추가, 같은 방식으로 조회 |
| 템플릿 목록 | `apps/api/src/api/domains/design/examples.py:91` `_preview_svg`, `:47` `DesignExampleOut` | `panel_svg` 추가 |
| SVG 정화 | `router.py:46` `sanitize_svg`(libs/svg-safety) — preview_svg 검증기(`router.py:193`)와 같게 | panel_svg도 정화 |
| 로고 교체 | `apps/worker/src/worker/engine/patch.py:800` `set_motif_slot`, api `router.py:2712` `place_design_logo` | panel 로고 경로 추가 |
| 로고 미리보기 | `examples.py:102` `_logo_slot_motif_id` | panel 로고면 그 id |
| 실사화 | `apps/worker/src/worker/render/photoreal.py:145·230` `tie_mockup_png` | finalize는 intent를 받으므로 intent에서 panel을 합성 |
| store | `template-picker.tsx:163`, `template-shots.tsx`, `pages/design/color.tsx:200`, `pages/design/logo.tsx:254` | `panelSvg` 전달 |
| admin | `apps/admin/src/pages/authoring/plan-preview.tsx:127` | prop이 선택이라 변경 없음(확인만) |

## 절차

좌표계는 **블레이드 프레임**으로 통일한다: x는 블레이드 폭 0..1(왼→오), y는 넥타이 블레이드 길이 0..1
(위→끝). 실루엣마다 이 프레임을 아트 박스 좌표로 바꾸는 사상 하나만 둔다.

1. **intent·카탈로그** — `Intent`에 선택 필드 `panel: list[PanelElement] = []`(기본 빈 목록이라 기존
   intent·골든 불변). 요소(판별 유니온 `type`):
   - `region` — 다각형(블레이드 프레임 점 목록) 채움 + color 슬롯 id → 대각·V 분할.
   - `line` — 폴리라인 + 폭(블레이드 폭 비) + color 슬롯 → 사선 한 줄, 세로 금선.
   - `curve_band` — 3차 베지어 중심선 + 폭 + color 슬롯(여러 개 겹쳐 3겹 띠) → S자 곡선.
   - `motif` — motif_id, 중심·크기(면적 기준)·회전, `role: "logo" | "decor"` → 넝쿨·붓 터치·**포인트 로고**.
     `role="logo"`는 panel 안에 최대 1개(검증기로 강제).
   color는 palette 슬롯 id라 색 고르기·colorway가 그대로 적용된다. `iter_motif_ids`가 panel motif도
   돌려주게 고친다. 근거: 기존 레이어는 타일 좌표·seamless assert에 묶여 있어 섞으면 §3를 깬다.
2. **compose** — `compose_design`이 `panel_svg`를 함께 만든다: viewBox `0 0 1000 1000`(블레이드 프레임),
   배경 투명, seamless 클론·불변식 미적용, panel이 비면 None. 로고 motif는 서버가 `MotifDef.bbox_mm`
   (`registry.py:20`)으로 면적 기준 크기를 계산한다(store `emblemBox` 규칙과 같은 식 — 면적 `size`, 최대
   폭·높이로 자르고 오른쪽 아래 모서리 고정). `DesignOut`에 `panel_svg`를 실어 응답·로그에 남긴다.
3. **api** — `WorkerDesignOut`·`DesignExampleOut`·`DesignSessionOut`에 panel SVG 필드, 정화 검증기,
   `_pointer_svg_query` 확장. `DesignExampleOut`에 panel 로고 여부(예: `logo_in_panel: bool`)를 추가해
   store가 엠블럼 오버레이를 중복으로 그리지 않게 한다. `pnpm codegen`, `domains.md` §11 갱신.
4. **로고 교체** — `set_motif_slot`에 panel 로고 교체 경로(슬롯 값 예: `"panel_logo"` 또는 별도 함수),
   `place_design_logo`는 템플릿에 panel 로고가 있으면 그 경로로 보낸다. 기존 `logo_slot`(레이어) 경로는
   그대로 둔다. `_logo_slot_motif_id`도 panel 로고를 우선한다.
5. **store** — `packages/shared/src/components/tie-canvas.tsx`의 `TieCanvas`에 `panelSvg` prop: 무늬 위·
   명암(shadow) 아래, 실루엣 마스크 안에 블레이드 프레임→아트 박스 사상으로 얹는다(확대 샷 focus에서도 같은
   사상). `SILHOUETTES`(`:56`)에 `blade` 사상을 추가한다:
   - flat(목록): 마스크 실측 블레이드 x 0.055~0.944, 윗변 y 0.03, 어깨(끝이 좁아지기 시작) 0.60, 끝 0.97.
   - photo(상세): 실측이 없다 — `apps/store/public/images/tie-mask.png`를 PIL로 행마다 알파 범위를 재서
     구한다(참고: y 0.6~0.9에서 x 0.306~0.694, 끝 좁아짐 ~0.92, 매듭 아래 시작 y는 마스크로 확인).
   panel 로고가 있으면 `emblem` 오버레이를 끈다. 위 표의 store 호출부 4곳에 prop을 잇는다.
6. **finalize(필수)** — `tie_mockup_png`가 타일 반복 위에 panel을 한 번 합성해 실사화 참조로 쓴다
   (`worker-pipeline.md` §2 갱신). 공장에 가는 두 이미지 중 배치형이 보이는 건 실사화뿐이라 이 단계가
   빠지면 디자이너가 배치형을 모른다. finalize는 intent를 받으므로 api 경로 변경은 없다.
   검증: 배치형 템플릿으로 실사화를 한 번 돌려 결과 이미지에 panel(예: 대각 분할)이 보이는지 눈으로 확인.
7. **시드·템플릿** — `apps/worker/scripts/seed_design_examples.py:51` `CuratedExample`에 `panel` 필드,
   `_compose_run`(`:925`)이 intent에 실어 compose. 참조 6종을 `tie-template` 스킬 절차로 추가하고, 스킬
   "엔진 제약"의 배치형 금지 문구를 지우고 "구조 팔레트"에 배치형 행을 더한다. 기존 템플릿 중 원하면
   로고를 panel 로고로 옮길 수 있지만 이번 범위는 신규 6종만.

## 검증

- 워커(로컬 테스트는 수정한 파일만 — AGENTS.md):
  - panel compose 결정론(같은 intent → 같은 panel_svg), panel 없는 intent의 SVG가 기존 골든
    (`apps/worker/tests/golden/`)과 바이트 단위로 같음.
  - `iter_motif_ids`가 panel motif를 포함, `set_motif_slot` panel 로고 교체, patch가 panel을 보존.
  - `uv run pytest apps/worker/tests/test_seed_design_examples.py`.
- api: `curl -s localhost:8000/design/examples`에 배치형 템플릿은 `panel_svg`가 있고 반복형은 null.
  testcontainers 인가 테스트 규칙(AGENTS.md)대로 로고 넣기가 panel 로고를 바꾸는지.
- store(browser-use, 스킬 5단계): `/design` 카드에서 01(대각 분할)이 한 번만 보이고, 상세 실사 컷
  (`/design/sessions/<id>/color`)에서도 한 번만 보인다. 두 실루엣을 같은 템플릿으로 나란히 캡처해 위치가
  같은지 본다. 색 고르기에서 분할 색을 바꾸면 panel 색도 바뀐다. 로고 넣기 후 포인트 로고가 한 번만 보인다.
- `pnpm codegen` 드리프트 없음, `pnpm build && pnpm typecheck`, `pnpm architecture:check`, `uv run pyright`.

## 되돌리는 법

panel은 선택 필드라 시드에서 배치형 템플릿만 빼고 재시드하면 기존 동작으로 돌아간다. api 응답의 panel
필드는 null로 남아도 무해하다. 이미 panel intent로 만든 사용자 세션은 worker가 계속 렌더할 수 있어야
하므로 **엔진의 panel 지원 자체는 되돌리지 않는다**.

## 기각한 대안

- **템플릿별 큰 타일**(tile_mm 3~4배) — 긴 실사 컷·실물에서 반복된다. 사용자가 2026-10-16 기각.
  블레이드 전체를 덮는 타일(tile_mm ≈ 넥타이 길이)이 가능해지면 재론.
- **기존 레이어에 "비반복" 플래그** — seamless assert와 경계 클론이 레이어 단위라 예외 분기가 엔진 전반에
  퍼진다.
- **store에서만 panel 그리기(엔진 무변경)** — 실사화 참조 이미지·로고 교체·색 고르기가 엔진 intent를
  거치므로 미리보기와 결과가 어긋난다.

실패 모드: 블레이드 프레임 사상이 실루엣마다 어긋나 목록(평면)과 상세(실사)에서 요소 위치가 다르게 보이는
것, 그리고 위 "데이터 경로" 표의 한 곳(특히 `iter_motif_ids`·정화·`_pointer_svg_query`)을 빠뜨려 한
화면에서만 panel이 사라지는 것 — 5단계 검증에서 목록·색 고르기·로고 화면을 모두 캡처해 잡는다.

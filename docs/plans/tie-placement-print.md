# 배치형(placement) 넥타이 디자인 — 반복 타일 위에 한 번만 놓이는 요소

넥타이 한 장에 **한 번만** 놓이는 무늬(대각 분할, 한쪽 S자 곡선 띠, 한쪽 세로 금선, 넝쿨 가지, 붓 터치,
V자 분할)와 **한 번만 놓이는 포인트 로고**를 엔진·api·store에 넣는다. 2026-10-16 사용자가 참조
10종(`/Users/gimbongseob/Downloads/735834f4-fa42-426c-b838-c86fd677993f.png`의 01·02·03·05·08·09)을
"배치형 기능부터 개발"로 결정했다. 반복형 4종(04·06·07·10)은 이 플랜 없이 먼저 추가됐다.

## 왜 필요한가

- 엔진은 seamless 타일 반복만 안다(`docs/api-spec/worker-engine.md` §2·§3 — compose는 `<pattern>` 한 장을
  깐다). 그래서 "한쪽에만 있는 곡선"·"대각 분할"은 표현할 수 없고, 타일을 키우는 우회는 긴 넥타이
  (상세 실사 컷)에서 3~4번 반복돼 배치형이 아니게 된다.
- 포인트 로고도 같은 한계다. 지금은 `logo_slot` 모티프가 무늬 레이어에 반드시 있어야 해서 로고가 무늬에
  작게 반복된다(`.claude/skills/tie-template/SKILL.md` "로고" 절, 2026-10-16 사용자 결정). 배치형 요소가
  생기면 로고를 **한 번만** 놓을 수 있다 — 이 플랜의 두 번째 효과.
- 근거: `tile_mm`은 물리 치수가 아니라 화면 배율 캐리어이고 결정론 SVG는 실물 출력에 그대로 들어가지
  않는다(`worker-engine.md` §1, 2026-08-19 확정). 그러니 배치형 요소도 "미리보기·실사화 참조 이미지"
  계약만 지키면 되고, 원단 생산 파일 포맷을 새로 정할 필요는 없다(추정 — 생산 담당 확인 필요, 실행 조건 참고).

## 범위 밖

- 저작 모델(LLM)이 배치형 요소를 만드는 것 — 이번엔 시드 템플릿만. authoring-plan-v3 계약은 손대지 않는다.
- 붓 터치의 "실감" 질감 생성(AI) — 손그림 모티프(벡터)로 근사한다.

## 실행 조건

- 선행: 반복형 템플릿 작업이 커밋돼 있을 것(이 플랜은 같은 시드 파일을 고친다).
- **실행 전 확인**: 생산(원단 발주) 쪽이 지금 무엇을 받는지 사람에게 확인한다. 생산이 "타일 이미지 한 장"을
  전제로 돌아간다면 배치형은 패널 이미지가 별도로 필요하다 — 이 답이 없으면 1~4단계(미리보기)까지만 하고
  5단계(finalize)는 멈춘다.
- 명세 변경이 포함된다 — `docs/api-spec/`(worker-engine·worker-pipeline·domains)를 같은 변경에서 갱신한다.

## 절차

좌표계는 **블레이드 프레임**으로 통일한다: x는 블레이드 폭 0..1(왼→오), y는 넥타이 길이 0..1(위→끝).
실루엣마다 이 프레임을 아트 박스 좌표로 바꾸는 사상 하나만 둔다(평면 컷 실측: 블레이드 x 0.055~0.944,
윗변 y 0.03·어깨 0.60·끝 0.97 — `packages/shared/src/components/tie-canvas.tsx:56` 주석·마스크 실측).

1. **intent에 `panel` 추가** — `apps/worker/src/worker/engine/intent.py:186` `Intent`에 선택 필드
   `panel: list[PanelElement] = []`. 요소 종류(최소): `region`(다각형 채움, color 슬롯 — 대각·V 분할),
   `line`(직선/폴리라인, 폭·color 슬롯 — 사선 한 줄, 세로 금선), `curve_band`(3차 베지어 중심선 + 폭 +
   color 슬롯, 여러 겹 — S자 곡선 띠), `motif`(motif_id, 중심·크기·회전 — 넝쿨 가지·붓 터치·**포인트 로고**).
   좌표는 블레이드 프레임 비율. color는 palette 슬롯 id라 색 고르기·colorway가 그대로 적용된다.
   근거: 기존 레이어는 타일 좌표·seamless 불변식에 묶여 있어 섞으면 §3 assert를 깬다 — 별도 목록으로 분리.
2. **compose가 패널 SVG를 따로 낸다** — `apps/worker/src/worker/engine/compose.py:36` `compose_design`이
   `panel_svg`(viewBox 0 0 1000 1000 블레이드 프레임, 배경 투명)를 함께 반환하고, 생성 로그 design에
   저장한다(`worker-engine.md` §7 로그 객체에 필드 추가). 패널이 비면 null. seamless 클론·불변식은 적용하지 않는다.
3. **api가 전달** — `apps/api/src/api/domains/design/examples.py:47` `DesignExampleOut`와 세션 응답에
   `panel_svg`를 추가(examples.py:91 `_preview_svg` 옆에 같은 방식으로 꺼냄). `pnpm codegen`으로
   api-client 재생성, `docs/api-spec/domains.md` §11 갱신.
4. **store가 그린다** — `TieCanvas`에 `panelSvg` prop: 무늬 레이어 위·명암(shadow) 아래, 실루엣 마스크 안에
   블레이드 프레임→아트 박스 사상으로 얹는다(`tie-canvas.tsx:56` `SILHOUETTES`에 `blade` 사상 추가: flat·photo).
   확대 샷(focus)에서도 같은 사상을 따른다. 포인트 로고가 panel motif로 오면 기존 `emblem` 오버레이 대신
   그것을 쓴다 — `emblemBox`의 면적·오른쪽 아래 기준 규칙(2026-10-16)을 panel motif 배치 기본값으로 옮긴다.
5. **finalize 참조 이미지에 합성** — `apps/worker/src/worker/render/photoreal.py:145` `tie_mockup_png`가
   타일 반복 위에 패널을 한 번 합성해 AI 실사화 참조로 쓴다(`worker-pipeline.md` §2 갱신). 실행 조건의
   생산 확인이 없으면 이 단계는 하지 않는다.
6. **로고 슬롯 확장** — 로고 넣기(`router.py` `place_design_logo`)가 템플릿의 로고 자리가 panel motif이면
   그 motif_id를 바꾸도록 한다. 기존 `logo_slot`(무늬 레이어)은 그대로 지원. `domains.md` §11 갱신.
7. **시드에 배치형 템플릿** — `apps/worker/scripts/seed_design_examples.py:51` `CuratedExample`에 `panel`
   (블레이드 프레임 요소 목록) 필드, `_compose_run`(같은 파일 `def _compose_run`)이 intent에 실어 compose.
   참조 01·02·03·05·08·09를 `tie-template` 스킬 절차로 추가하고, 스킬 "구조 팔레트"에 배치형 행을 더한다.

## 검증

- 워커: `uv run pytest apps/worker/tests/test_seed_design_examples.py` + panel compose 결정론 테스트
  (같은 intent → 같은 panel_svg), panel 없는 기존 intent의 SVG가 바이트 단위로 안 바뀌는 회귀 테스트.
- api: `curl -s localhost:8000/design/examples`에 배치형 템플릿의 `panel_svg`가 있고 반복형은 null.
- store: `/design` 카드 스크린샷 — 01(대각 분할)이 카드 한 장에 한 번만, 상세 실사 컷에서도 한 번만.
  색 고르기에서 분할 색을 바꾸면 패널 색도 바뀐다. 로고 넣기 후 포인트 로고가 한 번만 보인다.
- `pnpm codegen` 드리프트 없음, `pnpm architecture:check` 통과.

## 되돌리는 법

panel은 선택 필드라 시드에서 배치형 템플릿만 빼면 기존 동작으로 돌아간다. api 응답의 `panel_svg`는
null로 남겨도 무해하다.

## 기각한 대안

- **템플릿별 큰 타일**(tile_mm 3~4배) — 목록 카드에선 한 번만 보이지만 긴 실사 컷·실물에서 반복된다.
  사용자가 2026-10-16 기각. 블레이드 길이 전체를 덮는 타일(tile_mm ≈ 넥타이 길이)이 가능해지면 재론.
- **기존 레이어에 "비반복" 플래그** — seamless 불변식(§3 assert)과 경계 클론이 레이어 단위로 걸려 있어
  예외 분기가 엔진 전반에 퍼진다.

실패 모드: 블레이드 프레임 사상이 실루엣마다 어긋나 목록(평면)과 상세(실사)에서 요소 위치가 다르게 보이는
것 — 4단계에서 두 실루엣을 같은 템플릿으로 나란히 스크린샷 비교해 잡는다.

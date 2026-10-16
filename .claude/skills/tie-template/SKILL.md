---
name: tie-template
description: 스토어 /design 넥타이 템플릿을 추가·수정한다 — 참조 이미지(넥타이 샘플)를 엔진 플랜·손그림 모티프·시드로 옮기고, 렌더와 스토어 화면을 보며 사용자와 토의하며 다듬는다. "템플릿 추가", "이 넥타이처럼", "템플릿 다듬어", 넥타이 이미지를 주며 재현을 요청할 때 쓴다. 매 작업에서 배운 것을 이 문서에 다시 반영하는 성장형 스킬.
---

# 넥타이 템플릿 만들기

스토어 `/design`의 템플릿은 **시드 코드가 정본**이다(DB가 아니다). 사용자가 넥타이 샘플 이미지를 주면
그 느낌을 엔진 플랜으로 옮기고, 결과 이미지를 보며 사용자와 함께 고친다.

## 스스로 학습 (사용자가 시키지 않아도 한다)

이 스킬은 쓰일 때마다 자란다. 사용자가 "스킬 업데이트해"라고 말하기를 기다리지 말고, 아래 신호가
오면 **그 자리에서** 이 문서(`.claude/skills/tie-template/SKILL.md`)를 직접 고친다.

- **언제**
  - 사용자가 결과를 고치라고 했다("아니야", "너무 커", "더 오른쪽") → 무엇이 틀렸고 무엇이 맞았는지.
  - 사용자가 방향을 정해 줬다(AskUserQuestion 답 포함) → 다음엔 다시 묻지 않을 기본값.
  - 작업 중 함정·버그를 밟았다(실패한 명령, 엉뚱한 렌더, 엔진 제약) → 피하는 법.
  - 사용자가 결과를 그대로 받아들였다 → 통한 방식(수치·색·밀도)을 기준값으로.
- **어디에** — 맨 끝에 덧붙이기만 하지 말고 그 지식이 쓰일 절(제약·로고·단계)을 고친다. 일반화된
  교훈은 "배운 것"에 날짜와 함께 한 줄, 그리고 "변경 이력"에 한 줄.
- **어떻게** — 짧게, 규칙 형태로("X 하지 말 것 — 이유"). 이미 있는 항목과 겹치면 합치고, 틀린 것으로
  드러난 항목은 지운다. 문서와 코드가 어긋나면 코드를 믿고 문서를 고친다.
- **안 적을 것** — 템플릿 하나에만 해당하는 일회성 취향, 추측, 아직 확인 안 된 가설.
- **알리기** — 고친 뒤 응답 끝에 "스킬 갱신: …" 한 줄로 무엇을 바꿨는지 사용자에게 알린다.

## 파일 지도

| 무엇 | 어디 |
|---|---|
| 템플릿 표(`CURATED`)·플랜 상수 | `apps/worker/scripts/seed_design_examples.py` |
| 손그림 모티프(`_SEEDS`) | `apps/worker/scripts/seed_motifs.py` |
| 모티프 한글 태그·카테고리 | `apps/worker/src/worker/motifs/categories.py` |
| 플랜 스키마(레이어·배치) | `apps/worker/src/worker/authoring/schema.py` |
| 비율→mm, point_template 좌표 | `apps/worker/src/worker/authoring/compiler.py` |
| 카드 넥타이·포인트 로고 배치 | `packages/shared/src/components/tie-canvas.tsx` (`SILHOUETTES`, `emblemBox`) |
| 카드 구성(목록·상세 샷) | `apps/store/src/features/design/ui/template-shots.tsx` |
| 렌더 하네스 | `scripts/render.py` (이 스킬 폴더) |
| 엠블럼 점검 | `scripts/check_emblems.py` (이 스킬 폴더) |

## 진행 방식 — 사용자와 토의하며

1. **참조 해석을 먼저 말한다.** 이미지를 보고 템플릿마다 바탕색·무늬 구조(스트라이프 방향·묶음, 격자·
   엇갈림)·로고 모양·카테고리, 그리고 **반복형/배치형** 구분을 짧은 표로 정리해 보여준다. 엔진으로 못 하는 부분(아래 제약)은
   이때 미리 말한다.
2. **사용자 몫의 결정은 묻는다.** 재현 방식이 갈리는 지점(예: 단일 로고를 어떻게 다룰지)은
   AskUserQuestion으로 권장안을 첫 번째에 둔다. 이미 "배운 것"에 답이 있으면 다시 묻지 않는다.
3. **설계 → 렌더 → 비교 반복.** 템플릿마다 `cand.py`를 쓰고 `render.py`로 그려 참조와 나란히 본다.
   여러 개면 템플릿 하나당 서브에이전트 하나(아래 "병렬 작업").
4. **병합 → 시드 → 스토어 확인.** 결과를 실제 카드로 보고, 사용자에게 스크린샷으로 보고한다.
5. **피드백을 받으면 고치고 다시 본다.** 위치·크기·밀도 같은 미세 조정은 숫자를 바꿀 때마다
   스크린샷으로 확인하고, 피드백에서 배운 것은 바로 이 문서에 반영한다("스스로 학습").

## 엔진 제약 (설계 전에 반드시)

- 플랜 모티프는 **최대 2개**, 레이어 **최대 5개**, 스트라이프 레이어당 밴드 **최대 4개**(같은
  주기 레이어를 둘로 나누면 된다). 같은 모티프를 여러 레이어에서 재사용할 수 있다.
- **모티프 색은 바꿀 수 없다** — SVG에 칠한 색 그대로다. 사용자가 고를 수 있는 색은 플랜 `colors`
  (바탕·스트라이프)뿐이고, `color_names`에 이름 붙인 슬롯만 색 고르기 화면에 나온다.
  `colors`는 최소 2개라 안 쓰는 색을 자리만 채우기도 한다(그 슬롯엔 이름을 붙이지 않는다).
- 무늬는 타일 단위 seamless 반복. lattice 원점은 (0,0) 고정이고 오프셋이 없다 — 위치 조절은
  `drop`(half_row/half_column), `point_template`(quincunx_inset·diagonal_pair·grid4_inset),
  스트라이프 `offset_ratio`로 한다.
- 사선 주기는 타일과 맞물려야 이음매가 없다: `period_ratio = 1/(k·√2)` (k=1 0.70710678,
  k=2 0.35355339, k=3 0.23570226, k=4 0.1767767).
- **사선 스트라이프는 무조건 우상향(/) = `diagonal_up`.** 넥타이에 좌상향(\\, `diagonal_down`) 줄무늬는
  없다(2026-10-16 사용자 규칙). `diagonal_down`은 양방향을 겹치는 격자·다이아 체크에서만 쓴다.
- 점선·체인처럼 줄 위에 얹는 무늬는 바탕색 스트라이프를 lane으로 깔고 `path` 배치(`host_stripe_index`
  ·`host_band_index`)로 모티프를 얹는다. 모티프 가로세로 비는 최대 20(normalize 한도).
- **배치형(한 번만 놓이는) 무늬는 panel로 만든다** — 대각·V 분할, 한쪽 곡선 띠, 한쪽 세로선, 넝쿨 가지,
  붓 터치. 큰 타일(tile_mm 확대)로 흉내 내지 말 것: 긴 실사 컷에서 반복된다(2026-10-16 사용자 기각).
  `CuratedExample.panel`에 intent `panel` 요소(region·line·curve_band·motif)를 적는다 — 계약은
  `docs/api-spec/worker-engine.md` §2b. 아래 "배치형(panel)" 절.
- `vertical` 스트라이프의 `offset_ratio`는 **오른쪽 가장자리에서** 잰다 — 화면 순서(왼→오)의 반대로 적는다.
- 1×1 lattice는 타일 원점 (0,0)에 놓인다. 다른 격자와 원점이 겹치면 로고를 `path` straight
  `horizontal` + `phase_ratio`(예 0.25)로 옮겨 빈자리에 둔다(lattice엔 오프셋이 없다).
- 호스트 없는 wave path는 타일당 y=0 한 줄뿐이고 phase는 경로 방향이라 줄 간격을 못 만든다. 연속
  물결선은 "한 파장 폭 물결 조각" 모티프를 lattice로 이어 붙인다(size를 셀보다 0.3% 크게 → 접합 헤어라인 없음).
  파장은 타일의 1/정수(size ≤ 0.4라 최대 1/3)에 묶인다.
- 밀도: 평면 카드에서 넥타이 폭 ≈ 1.5타일. 넥타이 폭에 무늬 2~4개가 기본.
- **타일 렌더로 판단을 끝내지 말 것** — 2×2 타일에서 괜찮던 것이 카드 넥타이 크기에선 달라진다.
  k=2 사선의 블록 띠는 가는 줄처럼 보이고(굵은 블록은 k=1), 크기 0.1 미만 모티프는 점·x로 뭉개진다.
  크기·굵기 판단은 반드시 스토어 카드 스크린샷(deviceScaleFactor=2 확대 크롭)으로.

## 구조 팔레트 — 같은 계열 템플릿끼리 겹치지 않게

같은 카테고리(특히 스트라이프)를 여러 개 만들 땐 아래에서 **서로 다른 구조**를 고른다. 방향·색만
바꾼 "사선 묶음 + 작은 로고"를 반복하지 말 것(2026-10-16 사용자 피드백: 다양성 부족).

| 구조 | 엔진 표현 | 예 |
|---|---|---|
| 렙(rep) 스트라이프 | 촘촘한 사선 k=3(`diagonal_up`), 굵은 띠를 가는 줄이 감쌈 | 흰 줄과 빨간 줄 렙 스트라이프 |
| 스트라이프 + 모티프 행 | 바탕색 레인 밴드 + `path` straight(`host_band_index`, `rotation: fixed`)로 모티프가 줄지어 흐름 | 잎 가지가 흐르는 사선 |
| 블록 스트라이프 | k=1, 밴드 폭 ~0.45로 두 톤 굵은 띠 반반 + 경계 가는 줄, 로고는 `diagonal_pair`로 띠 중앙 | 블록 스트라이프와 물결 엠블럼 |
| 가로 바 | `horizontal`, period 0.5, 바 사이에 `half_row` 격자 | 가로 바와 날개 엠블럼 |
| 클래식 사선 묶음 | k=1~2 가는 줄 묶음 + 사이 로고 1×1 | 핀 스트라이프와 세 고리 |
| 사선 점선·체인 | 바탕색 lane + 점선 모티프·로고를 path로 엇갈림 | 모노그램 사선 점선 |
| 다이아 체크 | 양 사선 반폭 밴드 두 겹 + 겹침 칸 마름모 모티프 | 다이아 체크와 세리프 이니셜 |
| 잔 격자 + 포인트 | 양 사선 가는 밴드(k=2~4) + 칸 중앙 모티프 | 육각 엠블럼과 꽃문양, 마름모 격자와 네이비 꽃 |
| 올오버 엇갈림 | lattice `half_row`/`half_column`, `quincunx_inset` | 로고 하프드롭과 점, 나무·큐브 템플릿 |
| 도트 | 작은 점 모티프 `half_row` 2×4(가로 0.5·세로 0.25), 로고는 가로 path로 빈자리 | 세리프 R과 마름모 도트 |
| 세로 스트라이프 | `vertical` period 1.0, 밴드 4+1(레이어 둘), offset은 오른쪽 기준 | 세로 스트라이프와 세리프 V |
| 윈도페인 체크 | 양 사선 가는 줄 한 밴드(offset 0.5, k=2), 칸 중앙 = 원점 | 윈도페인 체크와 십자 문장 |
| 톤온톤 물결선 | 한 파장 물결 조각 lattice 3×2(size 0.3345), 바탕보다 한 톤 밝은 모티프 색 | 물결선과 물결 원 엠블럼 |

| 배치형 사선 분할 | panel `region`(아래 면) + `line`(경계 한 줄) | 사선 분할과 세리프 A |
| 배치형 세로 금선 | panel `line` 여러 개, 위(y=-4600)에서 내려와 `end_dot`으로 끝 | 세로 금선과 막대 로고 |
| 배치형 곡선 겹띠 | panel `curve_band` 같은 중심선을 x로 밀어 2~3겹 | 곡선 띠와 네잎 로고 |
| 배치형 V자 분할 | panel `region` + 두 팔 `line` + 한쪽 팔 굵은 띠 | V자 분할과 큐브 로고 |
| 배치형 큰 모티프 | panel `motif`(decor) 큰 size로 한 번 — 넝쿨 가지·붓 터치 | 넝쿨 가지와 C 로고, 붓 터치와 세리프 N |

새 구조를 찾으면 이 표에 한 줄 더한다.

## 배치형(panel)

- **좌표 = 블레이드 프레임(등방)**: x 0..1000 = 어깨 폭, y는 같은 단위로 어깨선 1000·끝 ≈1500. 평면
  카드는 y ≈ 210..1500만 보이고, 실사 컷은 y ≈ -4400(매듭 아래)까지 보인다. 위에서 내려오는 선·띠는
  y=-4600부터 시작해야 실사 컷에서 중간에 끊기지 않는다.
- **바탕 플랜은 `_textured_plan`**(바탕 + 한 톤 밝은 가는 사선 결). 결 슬롯에도 이름(`결`)을 붙인다 —
  바탕만 바꾸면 결 색이 따로 놀아 줄무늬가 드러난다.
- **포인트 로고는 `{**PANEL_LOGO, "subject": …}`**(어깨선 위 오른쪽, 면적 기준). `point="bottom"`,
  `logo_slot=None` — 로고 넣기는 서버가 panel 로고 자리(`slot="logo"`)로 보내고, 카드 엠블럼 오버레이는
  `logo_in_panel`이라 그리지 않는다.
- 색은 슬롯 id(`ground`·`color_<i>`, 플랜 colors 순서)로 적는다. panel 모티프는 `subject`로 적고 시드가
  motif_id로 푼다. 후보 렌더는 scratchpad에 평면 카드 + `photoreal.tie_mockup_png(panel_svg=…)` 실사
  목업을 나란히 그려 두 실루엣의 위치가 같은지 본다(`render.py`는 panel을 모른다).

## 로고 (포인트 로고 + 무늬 속 로고)

- 참조의 큰 로고 하나는 `point="bottom"`(카드가 블레이드 아래쪽에 엠블럼을 얹는다)이고, 엠블럼은
  `logo_slot` 모티프다. 엔진상 로고 슬롯 모티프는 **무늬 레이어에도 반드시 있어야** 해서 작고 성기게
  반복시킨다(2026-10-16 사용자 결정).
- **`logo_slot`은 레이어 순서다.** 플랜 input 순서가 아니라 intent 모티프 레이어를 그리는 순서의
  고유 id 인덱스(api `_intent_motif_ids`). 장식 레이어를 먼저 그리면 `logo_slot=2`.
  병합 후 `check_emblems.py`로 모든 행의 subject가 로고인지 확인한다.
- 로고 자리 모티프는 참조 로고의 심볼을 손으로 그린 path(`<text>` 금지). 바탕 위에서 보이는
  아이보리·실버·금 계열. subject는 영문 한 단어, **기존 seed subject와 겹치면 안 된다** — 시드는
  subject로 모티프를 고른다(`select distinct subject from motifs where source='seed'`).
- **포인트 로고 배치는 로고마다 다르다.** `TieCanvas`가 로고 실제 외곽(getBBox)을 재서 같은 면적
  (`size`)으로 키우고 `maxW`·`maxH`로 자른 뒤 `anchor` 점에 붙인다. 끝 로고는 `bottom-right` —
  오른쪽 여백과 바닥선이 같고, 넓은 로고는 왼쪽·높은 로고는 위로 자란다. 위치를 바꿀 땐 템플릿이
  아니라 `SILHOUETTES[*].emblem.tip`의 anchor·size를 바꾸고 flat(목록)·photo(상세) 둘 다 본다.

## 단계별 실행

### 1. 후보 설계·렌더

작업 폴더는 scratchpad 아래 `tpl/<NN>/`. `cand.py`에 `PLAN`(dict)과 `MOTIFS`를 정의하고:

```bash
uv run python .claude/skills/tie-template/scripts/render.py <cand.py> <out_prefix>
```

`<out_prefix>_2x2.png`를 Read로 보고 참조와 비교한다. `warnings`가 비어야 한다. 이음매·겹침·밀도·색.

### 2. 병렬 작업 (템플릿 여러 개)

템플릿 하나당 서브에이전트 하나. 공통 브리프 파일을 scratchpad에 쓰고 각자에게 번호와 묘사만 준다.
브리프에 넣을 것: 이 문서의 "엔진 제약"·"로고" 절, **레포 파일·DB 수정 금지(시드 실행 금지)**,
결과는 코드 조각으로 반환(PLAN 상수·CuratedExample·`_SEEDS` 튜플·KO_TAGS·카테고리 그룹·
최종 렌더 경로·참조와 다른 점). 병합은 메인이 한 번에 한다 — 같은 파일 동시 편집·시드 충돌 방지.

### 3. 병합

- 플랜 상수는 `# 스토어 템플릿 목록` 앞에, `CuratedExample`은 `CURATED` 끝에, 모티프는 `_SEEDS` 끝에.
- 주석은 기존처럼 한두 줄 한글. ruff 줄 길이 100(한글 주석이 자주 넘는다).
- 카테고리 그룹: 상징류는 `symbol`, 식물은 `plant`, 바다는 `sea` — subject 튜플은 알파벳순.
- 템플릿 이름·설명은 한글 서술형, 브랜드명 금지. `category`는 목록 필터 칩 라벨 그대로.

### 4. 검사·시드

```bash
uv run ruff check apps/worker && uv run ruff format apps/worker/scripts apps/worker/src/worker/motifs
uv run pytest apps/worker/tests/test_seed_design_examples.py apps/worker/tests/test_motif_tagging.py
uv run python apps/worker/scripts/seed_motifs.py
uv run python apps/worker/scripts/seed_design_examples.py
uv run python .claude/skills/tie-template/scripts/check_emblems.py
```

시드 warnings는 전부 `[]`여야 한다. `TieCanvas`를 건드렸으면
`pnpm --filter @essesion/shared typecheck && pnpm --filter @essesion/shared test`.

### 5. 스토어 확인 (browser-use)

- 서버가 떠 있는지 먼저 확인(`lsof -i :3000`·`:8000`). 목록: `http://localhost:3000/design`.
- 전체 카드 한 장에 보기: `cdp("Emulation.setDeviceMetricsOverride", width=1400, height=1700,
  deviceScaleFactor=1, mobile=False)` → `capture_screenshot` → `Emulation.clearDeviceMetricsOverride`.
- 상세(실사 컷)는 로그인 필요: `/login`에서 h1 "로그인"을 5번 클릭하면 id/pw 폼이 열린다.
  `type_text`로 `customer@local` / `customer-local-password`를 넣고
  `form.requestSubmit()`으로 제출(버튼 클릭·fill_input은 잘 안 먹는다). 그 뒤 템플릿 카드를 누르면
  `/design/sessions/<id>/color`로 간다.

### 6. 보고

스크린샷 기준으로: 추가된 템플릿 표(이름·카테고리·바꿀 수 있는 색), 참조와 다른 점, 검증 결과,
안 한 것(유료 임베딩 `index_motif_embeddings.py --confirm-live`, 커밋). 커밋은 사람이 한다.

## 배운 것 (사용자 피드백·함정)

- **밀도**: 첫 시도는 늘 너무 촘촘했다. 넥타이 폭에 로고 2~3개가 참조 느낌(2026-10-15).
- **색**: 원색 코발트는 싸 보인다 — 한 톤 깊게(`#2451b5`→`#1d3a80`). 검정 아이콘 모티프는 네이비에서
  안 보이니 템플릿 전용 모티프를 손으로 그린다.
- **포인트 로고**: 가운데 하단·큰 크기는 틀렸다 → 블레이드 오른쪽, 끝이 좁아지기 직전, 블레이드 폭의
  ~15%. 그리고 **한 점·한 폭으로 일괄 통일하지 말 것** — 로고 비율·크기에 따라 자리가 달라야 한다
  (면적 기준 + 오른쪽 아래 모서리 고정으로 해결, 2026-10-16).
- **logo_slot 함정**: 장식 레이어가 먼저면 끝 로고에 장식이 뜬다(위 "로고" 절).
- 서브에이전트 10개 병렬은 잘 됐다 — 레포를 안 건드리게 하고 코드 조각만 받는 게 핵심.
- **방향**: 다양성을 내려고 사선을 좌상향(\\)으로 뒤집었다가 틀렸다 — 사선은 항상 우상향,
  다양성은 구조(굵기·묶음·행·가로 바)로 낸다(2026-10-16).
- **배치형**: 참조 2차(2026-10-16) 10종 중 6종이 배치형이었다 — 사용자는 근사 대신 기능 개발을 택했고,
  같은 날 panel로 6종을 만들었다. 이제 배치형도 묻지 말고 panel로 만든다. 목록 칩은 `포인트`.
- **다양성**: 참조를 충실히 옮겨도 같은 카테고리가 한 구조로 몰리면 목록이 단조롭다 — 여러 개를
  만들 땐 "구조 팔레트"에서 서로 다른 구조를 배정하고 시작한다(2026-10-16).

## 변경 이력

- 2026-10-16 첫 작성 — 참조 10종 템플릿 추가 작업에서 정리. 렌더 하네스·엠블럼 점검 스크립트,
  포인트 로고 면적·모서리 배치 규칙.
- 2026-10-16 "스스로 학습" 규칙 추가 — 피드백·결정·함정을 시키지 않아도 그 자리에서 반영.
- 2026-10-16 스트라이프 4종 다양화 작업 — "구조 팔레트" 표, 타일 렌더 vs 카드 크기 함정 추가.
- 2026-10-16 사선 방향 규칙 — 스트라이프 사선은 우상향(`diagonal_up`)만.
- 2026-10-16 배치형 구분 — 반복형/배치형을 1단계에서 가르고, 배치형은 플랜(tie-placement-print) 뒤로.
- 2026-10-16 참조 2차 반복형 4종 — vertical offset·원점 회피 path·물결선 이어 붙이기 제약, 팔레트 4행.
- 2026-10-16 배치형(panel) 기능 + 6종 — "배치형(panel)" 절, 팔레트 5행, 배치형 금지 문구 삭제.

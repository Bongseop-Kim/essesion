# 디자인 의도 보존 수정 실행 기록 — 2026-09-07

[Aside 점검](./design-page-aside-2026-09-07.md)에서 확인한 D1·D2·D3·D4·D5·D6 중 **코드로 고칠 수 있는 1~5번 항목을 적용했다.** 6번(레이어별 배치·부분 재색)은 같은 날 오후 제품 결정을 받아 아래 §결정 후 확장으로 이어서 실행했다. 외부 API 없이 회귀 테스트로 고정한 뒤, 같은 날 Aside로 실패했던 단계만 다시 실행해 확인했다(아래 §Aside 재검증).

## 적용한 것

| 항목 | 위치 | 변경 |
|---|---|---|
| D1 바탕색 덮어쓰기 | `apps/worker/src/worker/adapters/named_colors.py` | 바탕 역할을 거리 16자가 아니라 직접 수식 관계로 배정. 바탕 바로 옆에 미등록 색 표현("짙은 초록")이 있으면 다른 지명색을 끌어오지 않고 모델의 바탕을 보존. 강도 수식어(짙은·진한·deep·dark 등)와 "만" 조사를 연결어로 허용 |
| D2 부분 누락 | `authoring/schema.py`, `adapters/llm.py`, `adapters/motif_intent.py` | `DesignPlanV3.unmet_motif_subjects`(기본 `[]`, ≤2, 계약 버전·fingerprint 불변) 추가. 저작 프롬프트가 입력·카탈로그가 못 덮는 주제를 여기 적게 하고, 비어 있지 않으면 `motif_mention` sidecar로 첫 항목을 안내. 스토어 스낵바가 "카탈로그에 없어 넣지 못했어요"로 누락을 명시 |
| D3 대상 오인 | `engine/patch.py`, `api/routes.py`, `motifs/store.py`, `adapters/llm.py` | 스냅샷에 읽기 전용 `motifs[{index,subject,description}]`(id 없음, `motif_size_mm`와 같은 순서) 추가. 프롬프트가 목록에 없는 대상은 `target_missing`으로 거절하고 note는 실제 변경만 서술하도록 지시. `PATCH_PROMPT_REVISION` v4 |
| D5 이유 코드 | `DesignPatchV1.out_of_scope_reason`, `ScopeRejectedResponse.reason`, api `DesignGenerateRejectedOut.reason`, store `canvas-notice.tsx` | `motif_change|motif_recolor|motif_position|per_motif_placement|target_missing`. `motif_change`(또는 이유 없음)만 피커를 열고, 나머지는 코드별 한국어 알림. 무과금·이력 원복 계약 유지. `pnpm codegen` 반영 |
| D4 엇갈림 밀도 | `engine/patch.py::_stagger_frame`, `warnings.py` | 홀수 축 엇갈림은 개수를 올리지 않고 셀·크기·줄무늬 params를 둔 채 `tile_mm`만 두 배(축 2n). tile 192mm·축 10 상한이면 종전 올림 + `stagger_density_adjusted` 고객 경고. `drop_axis=column` 고정을 명세에 기록 |
| D6 첫 모티프 크기 | `engine/patch.py::_first_motif_layer` | `tile×0.18`(8.64) → 6분할 셀의 절반 `tile/12`(4.0). 사용자가 정한 크기·교체 크기는 불변 |

명세: `worker-pipeline.md` §5, `worker-engine.md` §7.1, `worker-motifs.md` §6, `domains.md` §11.

## 검증

- worker: `test_patch.py`·`test_adapters.py`·`test_api_generate.py`·`test_authoring_v3.py`·`test_constraints.py`·`test_api_motifs.py` 198건 통과. 회귀 기준을 그대로 테스트로 고정했다 — S2 문장+바탕 `#14532D` 유지, S3(tile 48/cell 16/크기 9) 엇갈림 후 면적당 밀도 동일 + `validate_intent` 재스냅 없음 + `assert_seamless_invariants` + `compose_design` 통과, 줄무늬 params verbatim, S5 첫 로고 크기 4.0 < 셀 8.0.
- api: `test_design.py -k "reject or scope"` 19건 통과. store: canvas-notice·use-generate·index 38건 통과, typecheck 통과.
- `ruff check .`·`ruff format`·pyright(worker src, api design) 통과. `pnpm architecture:check` 5/5 kept. `pnpm lint`의 실패 2건은 `docs/reviews/assets/design-intent-2026-09-07/`(qa-logo.svg·steps.json)의 기존 커밋 산물로 이번 변경과 무관.

## Aside 재검증 (2026-09-07 15:10–15:25 KST)

`http://localhost:3000/design`, 로컬 고객 계정, 기존 store·api(`--reload`)와 **재시작한 worker**(원래 프로세스는 `--reload`가 없어 옛 코드였다). 잔액 197→123(1차: 첫 생성 2×25 + 성공 수정 2×12 = 74토큰), 이어서 충전 후 첫 생성 1회·수정 1회·슬롯 교체 4회(무료)를 추가 실행했다. 거절 5회는 무과금·이력 무변경이었다. 판정은 화면 alert·스크린샷과 DB `design_sessions.current_intent`·`seamless_generation_logs.diagnostics`로 했다.

| 항목 | 단계 | 결과 |
|---|---|---|
| D6 | S5 세션 1번째(줄무늬만)로 되돌려 qa-logo 슬롯 추가 | size 4.0 / cell 8.0 / tile 48. 로고 사이 여백과 가는 사선 줄이 타일 뷰에서 식별됨 |
| D4 | S3 세션 3번째(성기게: tile 48·cell 16·크기 9)에서 "반 칸 엇갈리게" | tile 96, cell 16, size 9, drop 0.5/column, warnings 없음. 화면 밀도·꽃 크기 동일, 엇갈림만 적용. patch는 `placement.arrangement=staggered` 하나 |
| D5 위치 | S1 "벌을 줄 사이 빈 공간의 가운데로" | `motif_position` 거절, alert "줄 사이처럼 정확한 위치로…아직 지원하지 않아요", 이력 4/4 유지 |
| D5 재색 | 기존 S4(사자+가지) "붉은 꽃잎만 아이보리로" | `motif_recolor` 거절, alert "모티프 색은 그림 자체에 고정돼 있어…" |
| D5 개별 회전 | 기존 S4 "꽃 가지만 45도, 사자는 유지" | `per_motif_placement` 거절, alert "모티프 하나만 따로 돌리거나…" |
| D3 | 기존 S4 "꽃 가지는 그대로, 사자만 1.5배" | 사자 14.4→21.6, 가지 9.6 유지. patch `motif_size_mm=[21.6, 9.6]`, note "사자는 1.5배 크게 하고 꽃 가지는 그대로 유지했습니다." |
| D1 | 새 세션, S2 원문 | plan colors `#123B2A/#F1E8D0/#CFAE3D`, ground 0 → 정규화 후에도 바탕 `#123B2A`(초록) 유지. 1회 저작 |
| D2 | 새 세션, S4 원문 | 카탈로그 flower/leaf로 저작(2회 시도), plan `unmet_motif_subjects=["사자"]` → 스낵바 "‘사자’ 모티프는 카탈로그에 없어 넣지 못했어요. 왼쪽에서 찾거나 만들 수 있어요." |
| D3 대상 부재 | 위 flower/leaf 세션에서 "사자만 1.5배" | `target_missing` 거절, alert "말씀하신 모티프가 지금 디자인에 없어서 바꾸지 않았어요", 꽃 7.68·잎 5.76 불변 |

| D3 순서 뒤집힘 | 위 세션에서 슬롯 1=꽃 가지, 슬롯 2=사자로 교체(무료) 후 "가지는 그대로, 사자만 1.5배" | 사자(슬롯 2) 5.76→8.64, 가지(슬롯 1) 7.68 유지. patch `motif_size_mm=[7.68, 8.64]` — 스냅샷의 이름 순서를 따라 실제 대상을 골랐다 |
| 부정어 가드 | 새 세션, S2 원문 재생성(worker 재시작 후) | 피커 스낵바 없음, `motif_intent=null`, 바탕 초록 유지 |

| 모티프 저작 유도 | 기존 S4 "붉은 꽃잎만 아이보리로" / "사자를 호랑이로 바꿔줘" | 재색: 빨강 알림 "…문장으로는 바꿀 수 없어요. 왼쪽 모티프의 AI 생성으로 원하는 색의 그림을 새로 만들어 주세요."(문구를 이번에 AI 생성 유도로 고침). 교체: 스낵바 "‘호랑이’ 모티프는 왼쪽에서 찾거나 만들 수 있어요." + 모티프 패널 강조 1.6초 + 검색어 채움. 모달은 자동으로 열지 않는 것이 설계(`index.test.tsx` 고정). 둘 다 무과금·이력 불변 |

**재검증 중 발견해 추가로 고친 것:** S2 첫 생성에서 "모티프는 넣지 마"가 `motif_mention` 피커 안내를 띄웠다(모티프 레이어 없음 + "모티프" 어휘). `motif_intent.py`에 부정 어휘 가드(`…는 넣지|없이|빼|제외|말고|쓰지|않`, `no/without motif`)를 넣어 부정된 어휘를 지운 뒤 mention을 판정한다. 회귀 테스트 2건 추가, worker 재시작 뒤 같은 문장을 재생성해 스낵바가 뜨지 않는 것을 확인했다.

**관찰:** S2 결과의 바탕은 초록으로 맞지만 아이보리 줄 폭(15/33.9mm)이 커서 인상은 여전히 아이보리 우세다 — 이는 색이 아니라 모델의 폭 선택이며 이번 범위 밖. S4 새 저작은 사자 대신 요청하지 않은 금색 가로 줄무늬도 넣었다(기존 관찰과 같음).

## 결정 후 확장 (2026-09-07 오후)

결정: ① 모티프 하나만 회전 — 예. ② 모티프 하나만 성기게 — 예, 두 격자가 달라져 겹쳐도 허용. ③ 줄 사이 배치 — 가능하면 구현. ④ 부분 재색 — 새 기능이 아니라 **모티프 AI 생성으로 안내**한다.

| 변경 | 위치 | 내용 |
|---|---|---|
| gap lane | `engine/primitives.py::Stripe.lanes`, `validate.py` | 밴드 i 끝과 다음 밴드 시작 사이 중점 `b{i}.gap`(단일 밴드는 bare `gap`). 다중 밴드 bare `gap`도 `b0.gap`으로 정규화 |
| 슬롯 지정 배치 | `engine/patch.py::PlacementPatch.slot`, `_target_layers` | `slot`(1..2)이 있으면 그 레이어만 회전·밀도·배열 변경. 범위 밖 슬롯은 `ConstraintInvalid` |
| 줄 위/사이 배열 | `Arrangement`에 `on_stripes`·`between_stripes`, `_stripe_lane` | 가장 넓은 밴드 center / 가장 넓은 빈 공간 gap을 host lane으로 한 path_following. 줄무늬가 없으면 거절 |
| 스냅샷 | `composition_snapshot` | `motifs[].placement`에 슬롯별 현재 배열·밀도·회전 |
| 이유 코드 | worker·api·store | `per_motif_placement` 제거(지원 축이 됨). `motif_position`은 "표현 불가 위치"로 좁힘. `no_change` 추가 — patch 적용 결과가 현재 intent와 같으면 무과금 거절 |
| 프롬프트 | `PATCH_PROMPT_REVISION` v5 | slot·on/between_stripes 설명, `count_per_axis`는 클수록 촘촘·최소 2 명시(실측에서 모델이 "드문드문"에 10을 내는 오독을 확인해 추가) |
| 재색 안내 | store `canvas-notice.tsx` | "왼쪽 모티프의 AI 생성으로 원하는 색의 그림을 새로 만들어 주세요" |

명세: `worker-engine.md` §3(lane)·§7.1(슬롯 배치), `worker-pipeline.md` §5, `domains.md` §11. 테스트: `test_patch.py` 슬롯 회전/밀도/범위, between/on_stripes(seamless 검증 포함), `test_validate.py` gap lane·bare gap 정규화.

Aside 실측(worker 재시작 후):

| 단계 | 결과 |
|---|---|
| S1 "벌을 줄 사이 빈 공간의 가운데로" | patch `arrangement=between_stripes` → `b0.gap`, spacing 8→8.4853 스냅(경고는 진단만). 화면에서 벌이 네이비 빈 공간 중앙에 한 줄로 배치, 줄무늬 params 불변 |
| S4 "꽃 가지만 45도, 사자는 유지" | patch `slot=1, rotation_deg=45` → 가지 45°, 사자 0° |
| S4 "사자는 그대로, 꽃 가지만 더 드문드문" 1차 | 모델이 `count_per_axis=10`을 내 가지가 촘촘해짐(현재 2, 최소) — 프롬프트에 밀도 의미를 명시해 수정 |
| 같은 요청 2차 | `count_per_axis=2`(변경 없음), note "이미 가장 드문 간격이라 바꾸지 않았다". 다만 12토큰이 과금돼 `no_change` 무과금 거절을 추가 |
| 같은 요청 3차(`no_change` 적용 후) | 빨강 알림 "요청한 내용은 이미 그렇게 되어 있어서 바꾼 것이 없어요. 토큰은 쓰지 않았어요.", 잔액·이력(9/11) 불변 |

## 하지 않은 것·남은 것

- D2·D3은 프롬프트 지시에 의존한다. 위 실측은 시나리오당 1회(D3는 정순·역순 각 1회)라 모델 편차는 반복 실측으로 봐야 한다.
- Aside 조작 관찰: 모티프 시트의 카드·삭제 버튼 접근성 이름이 같은 긴 subject로 시작해 자동화 클릭이 삭제 확인창을 열었다(취소함, 삭제 없음). 사람 사용에는 영향 없지만 삭제 버튼 이름을 "…삭제"로 구분되게 앞에 두면 안전하다 — 이번 범위 밖.
- D4로 tile이 두 배가 되면 스냅샷의 `scale.current`가 2.0으로 보인다(tile/48 정의). 화면 배율은 그대로지만 모델이 note에 "현재 2배"라고 말할 수 있다 — 관찰되면 스냅샷의 scale 정의를 손볼 것.
- D1에서 "사선 줄"·"보조 줄"처럼 맨 "줄"은 여전히 스트라이프 역할 어휘가 아니다. 이번 문장은 기존 주어+조사 휴리스틱이 아이보리·금색을 모티프 색으로 분류해 plan을 그대로 두는 경로로 바탕이 보존된다.
- 슬롯 지정 밀도는 겹침을 허용하기로 했으므로, 두 모티프가 겹치는 결과가 나오면 사용자가 크기나 밀도를 다시 지시해야 한다. 겹침 경고는 두지 않았다.
- `no_change` 판정은 빈 patch 기준선과의 동일성이다. 정규화가 결과를 바꾸는 경로(off-grid period 등)에서는 "변경 없음"으로 잡히지 않는다 — 의도된 보수적 판정.

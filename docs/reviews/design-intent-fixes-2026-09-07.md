# 디자인 의도 보존 수정 실행 기록 — 2026-09-07

[Aside 점검](./design-page-aside-2026-09-07.md)에서 확인한 D1·D2·D3·D4·D5·D6 중 **코드로 고칠 수 있는 1~5번 항목을 적용했다.** 6번(레이어별 배치·부분 재색 계약 확장)은 제품 결정이 필요해 `docs/plans/motif-layer-placement-recolor-contract.md`에 남겼다. 외부 API 없이 회귀 테스트로 고정한 뒤, 같은 날 Aside로 실패했던 단계만 다시 실행해 확인했다(아래 §Aside 재검증).

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

`http://localhost:3000/design`, 로컬 고객 계정, 기존 store·api(`--reload`)와 **재시작한 worker**(원래 프로세스는 `--reload`가 없어 옛 코드였다). 잔액 197→123: 첫 생성 2×25 + 성공 수정 2×12 = 74토큰. 거절 5회는 무과금·이력 무변경이었다. 판정은 화면 alert·스크린샷과 DB `design_sessions.current_intent`·`seamless_generation_logs.diagnostics`로 했다.

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

**재검증 중 발견해 추가로 고친 것:** S2 첫 생성에서 "모티프는 넣지 마"가 `motif_mention` 피커 안내를 띄웠다(모티프 레이어 없음 + "모티프" 어휘). `motif_intent.py`에 부정 어휘 가드(`…는 넣지|없이|빼|제외|말고|쓰지|않`, `no/without motif`)를 넣어 부정된 어휘를 지운 뒤 mention을 판정한다. 회귀 테스트 2건 추가, 브라우저 재실행은 하지 않았다(결정론 경로라 단위 테스트로 대신).

**관찰:** S2 결과의 바탕은 초록으로 맞지만 아이보리 줄 폭(15/33.9mm)이 커서 인상은 여전히 아이보리 우세다 — 이는 색이 아니라 모델의 폭 선택이며 이번 범위 밖. S4 새 저작은 사자 대신 요청하지 않은 금색 가로 줄무늬도 넣었다(기존 관찰과 같음).

## 하지 않은 것·남은 것

- D2·D3은 프롬프트 지시에 의존한다. 위 실측은 각 1회이며, 순서가 뒤집힌 두 모티프 사례(가지가 슬롯 1, 사자가 슬롯 2)는 아직 실행하지 않았다.
- 부정 어휘 가드는 브라우저로 재확인하지 않았다(재생성 25토큰). 다음 S2류 첫 생성에서 피커 스낵바가 뜨지 않는지 보면 된다.
- D4로 tile이 두 배가 되면 스냅샷의 `scale.current`가 2.0으로 보인다(tile/48 정의). 화면 배율은 그대로지만 모델이 note에 "현재 2배"라고 말할 수 있다 — 관찰되면 스냅샷의 scale 정의를 손볼 것.
- D1에서 "사선 줄"·"보조 줄"처럼 맨 "줄"은 여전히 스트라이프 역할 어휘가 아니다. 이번 문장은 기존 주어+조사 휴리스틱이 아이보리·금색을 모티프 색으로 분류해 plan을 그대로 두는 경로로 바탕이 보존된다.
- 6번 항목(모티프 슬롯 지정 회전·밀도 patch, lane/위상 기반 줄 사이 배치, 부분 재색 소유권·이력 계약)은 명세 결정 전이라 미구현 — 플랜 문서에 그대로 남아 있다.

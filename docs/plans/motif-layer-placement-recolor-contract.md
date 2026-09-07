# 디자인 의도 보존 — 레이어별 배치·부분 재색 계약 확장 제안 (2026-09-07)

**상태: 제안만 작성, 미실행.** [Aside 실행 기록](../reviews/design-page-aside-2026-09-07.md)의 D5 중 현재 patch 계약으로 표현할 수 없는 축이다. 색 정규화·대상 매핑·이유 코드·엇갈림 밀도·첫 모티프 크기(원래 1~5번)는 2026-09-07에 적용해 [실행 기록](../reviews/design-intent-fixes-2026-09-07.md)으로 옮겼다. 이 문서는 남은 6번만 다룬다.

## 왜 필요한가

S4에서 "꽃 가지만 45도", "꽃 가지만 더 드문드문", "붉은 꽃잎만 아이보리로"는 거절됐다. 지금은 코드별 안내(`per_motif_placement`·`motif_recolor`·`motif_position`)로 이유를 설명하지만 고객 목표 자체는 달성되지 않는다. 배치 patch(`PlacementPatch`)는 모든 모티프 레이어에 한 번에 적용되고, 모티프 색은 content-hash identity에 포함돼 저장된 모티프를 재색할 수 없다(`worker-motifs.md` §2·§6.1).

## 범위 밖

페이지 재설계, 에이전트 루프, 생성마다 이미지 검수 호출, seamless 보장 제거는 하지 않는다. 이미 적용된 이유 코드 안내를 되돌리지 않는다.

## 실행 조건

- `ARCHITECTURE.md` §6, `worker-pipeline.md` §5, `worker-motifs.md` §2·§6.1, `worker-engine.md` §7을 읽고 시작한다.
- **명세를 먼저 갱신하고 구현한다.** 아래 두 결정이 나기 전에는 코드를 바꾸지 않는다.
- 부분 재색을 지원하기로 결정하면 새 모티프 생성 경로의 소유권·content hash·이력 보존 계약을 먼저 정한다. 결정되지 않으면 기다린다.

## 절차

### 1. 레이어별 배치 patch

**위치:** `apps/worker/src/worker/engine/patch.py`(`PlacementPatch`, `_apply_placement`), `apps/worker/src/worker/engine/intent.py:83`, `apps/worker/src/worker/engine/placement.py:65`, `apps/worker/src/worker/adapters/llm.py::_build_patch_prompt`.

- `PlacementPatch`에 대상 슬롯(스냅샷 `motifs[].index`)을 지정하는 필드를 추가하고, 지정된 레이어만 바꾸고 나머지는 보존한다. 전역 필드를 슬쩍 재해석하지 않는다.
- 회전은 레이어별 `fixed_rotation_deg`로 표현 가능하다. 밀도는 두 슬롯이 같은 격자 위상을 공유하므로(`_derived_placement`) 한 슬롯만 성기게 하면 위상 관계가 깨진다 — 어떤 관계를 보존할지 명세에 적는다.
- 줄 사이 위치(S1)는 기존 `path_following`의 host/lane 또는 격자 `offset`으로 표현할 수 있는지 먼저 검증하고, 가능하면 `motif_position` 코드를 지원 축으로 바꾼다.
- 명세 갱신: `worker-pipeline.md` §5 patch 불릿, `worker-engine.md` §7.1. 프롬프트 revision bump.

**완료 기준:** S4 "꽃 가지만 45도/성기게"가 사자에 영향을 주지 않는다. 지원하게 된 코드는 `RejectReason`에서 제거하고 스토어 문구도 함께 지운다.

### 2. 부분 재색은 별도 결정

- 저장된 모티프 symbol을 직접 바꾸지 않는다(identity·이력 불변).
- 지원하기로 하면 "색 변형 모티프를 새로 만드는 경로"로 설계한다: 원본 참조·소유권·content hash·이력에 남는 방식을 `worker-motifs.md`에 먼저 쓴다.
- 꽃잎/잎 같은 의미 영역은 hex 치환과 다르다. 기존 SVG가 영역을 구분하지 못하는 경우까지 지원한다고 약속하지 않는다.

**완료 기준:** 지원 시 같은 꽃잎 형상만 아이보리로 바뀌고 잎·줄기·원래 이력은 보존된다. 지원하지 않기로 결정하면 `motif_recolor` 안내를 그대로 두고 이 항목을 문서에서 제거한다.

## 검증

수정한 patch 로직의 테스트 파일(`test_patch.py`)에 슬롯 지정 사례를 추가한다. 두 모티프 순서가 뒤집힌 사례와 seamless 검증(`assert_seamless_invariants`·`compose_design`)을 포함한다. 명세 변경 시 `pnpm architecture:check`, API 변경 시 `pnpm codegen`.

## 되돌리는 법·상향 신호

요청하지 않은 레이어 변경이나 기존 이력의 모티프 색·형상 변형이 관찰되면 해당 patch 변경만 되돌린다. 기존 저장 디자인을 일괄 재작성하지 않는다.

## 기각한 대안

- 모티프 symbol을 그대로 재색: identity·이력 불변 계약을 깬다.
- 전역 `placement` 필드를 "마지막에 언급된 모티프"로 재해석: 어느 레이어가 바뀌는지 결정론적으로 검증할 수 없다.

**실패 모드:** 명세 결정 없이 patch 필드를 먼저 늘려 두 슬롯의 위상·이력 계약을 조용히 깨는 것이다.

# 2단계 — 구성 patch 계약, 보존 기계 폐기, 범위 밖 거절

> 총괄: `00-overview.md`. 선행: 1단계. 이 단계가 이번 재설계에서 **가장 크게 코드를 줄인다**.

## 목표

입력창 문장은 **구성 축만 바꾸는 좁은 patch**를 만든다. 모델이 plan 전체를 다시 쓰는 대신
정해진 필드만 채우므로, "요청하지 않은 걸 모델이 건드렸는지"를 사후에 추측하는 기계가
필요 없어진다.

## 현재 상태 (근거)

`apps/worker/src/worker/adapters/gemini.py`는 1907줄이고, refine 경로가 `DesignPlanV3`
**전체를 재저작**한다. 그래서 84–960행이 사실상 "모델이 범위를 넘었는지 정규식으로
추측하고 되돌리는" 기계다.

| 위치 | 역할 |
|---|---|
| `:84` `_RefinePermissions` | 어떤 섹션을 모델 결과로 유지할지 |
| `:191`–`:262` `_named_color_is_excluded`·`_category_is_preserved`·`_category_mentions` | 프롬프트 정규식 언급 탐지 |
| `:244` `_requested_named_colors`, `:290` `_normalize_requested_named_colors` | 색 이름 추출·근접 매핑 |
| `:492` `_refine_permissions`, `:567` `_refine_restore_permissions` | 섹션별 허용 판정 |
| `:640`–`:753` `_copy_color_references`·`_copy_motif_fields`·`_merge_layer_categories` | 필드 복사 |
| `:753` `_preserve_refine_plan` | 요청 범위 밖 원복 |
| `:873` `_ensure_requested_refine_changes` | 요청한 변경이 실제로 반영됐는지 사후 검사 |

## 작업

### 1. patch 스키마 정의

`apps/worker/src/worker/engine/patch.py` (신규) — `DesignPatchV1`. 구성 축만 담는다.

```
DesignPatchV1
  background: { color: hex } | null
  stripe: { angle: float | null, period_mm: float | null, bands: [{offset_mm,width_mm,color}] | null } | null
  placement: { type: lattice|point_set|path_following|scatter, ... } | null   # intent.Placement 부분집합
  motif_size_mm: float | null          # 슬롯별 [slot1, slot2]
  palette: { slots: [{id, hex}] } | null
  note: str                            # 사용자 문장을 어떻게 해석했는지 1줄 (고객 노출용)
```

- **모티프 정체성 필드는 없다.** `motif_id`·`source`·`catalog_ref`가 스키마에 존재하지 않으므로
  모델이 모티프를 바꾸는 것은 타입상 불가능하다.
- 모든 필드는 nullable — 언급되지 않은 축은 그대로 둔다는 뜻이고, 원복 로직이 필요 없다.
- 적용은 결정론: `apply_patch(intent, patch) -> intent`. 값 검증은 기존
  `engine/validate.py`·`engine/constraints.py`(팔레트 강제)를 재사용한다.

### 2. refine 경로 교체

- `gemini.author_designs`의 refine 분기를 `gemini.author_patch(prompt, current_plan, history)`로
  교체한다. 응답 스키마는 `DesignPatchV1` 하나(구조화 출력, flash-lite 유지).
- 저작용 예시 검색(`retrieve_examples`)은 refine에서 이미 skip이므로 그대로 skip.
- `conversation_context.history`(최근 6쌍)는 **유지**한다. "좀 더 크게" 같은 상대 지시가
  여기 의존한다.

### 3. 보존 기계 삭제

위 표의 항목 전부 삭제한다. 삭제 후 `gemini.py`에 남는 것은 최초 저작(프롬프트/참고 사진 →
`DesignPlanV3`), patch 저작, 아이디어 생성, 프롬프트 조립, 스키마 서빙이다.

### 4. 범위 밖 거절 (`scope_rejected`)

- 모델이 patch에 담을 축이 하나도 없고 요청이 모티프 변경으로 보이면 worker는
  `{ "status": "scope_rejected", "target": "motif" }`를 돌려준다(HTTP 200).
- api는 이 응답에서 **토큰 차감을 되돌린다.** 기존 실패 환불 경로(`work_id` 멱등 환불)를
  재사용한다 — 순사용량 0이므로 UI 문구 "토큰은 쓰지 않았어요"가 사실이 된다.
- **턴을 남기지 않는다.** `context_version`도 올리지 않는다. 이력에 스텝이 생기지 않아야 한다.
- api 응답: `409` 대신 `200 { "rejected": { "target": "motif" } }`로 내린다. 프론트는 상단
  알림만 띄우고 입력창 문장을 유지·전체 선택한다.

### 5. 경고 문구 고객화

현재 `warnings`는 엔진 영문 문자열(예: lattice overlap clamped)이라 그대로 노출할 수 없다.

- worker에 `WARNING_MESSAGES: dict[str, str]` 매핑을 두고 응답에는 **코드 + 고객 문구**를 함께
  내린다: `warnings: [{ code: "lattice_clamped", message: "줄 간격은 요청보다 조금 넓게 맞췄어요." }]`
- 매핑에 없는 코드는 프론트가 표시하지 않는다(로그·admin에는 코드가 남는다).

## 삭제 목록

- `gemini.py` 84–960행 영역의 refine 보존·언급탐지·사후검사 함수 전부
- 그 함수들만 검증하는 worker 테스트(`test_authoring_v3.py` 등의 preserve 케이스)
- "refine은 plan 전체를 재저작한다"를 기술한 문서 문단 (`docs/api-spec/worker-pipeline.md`)

## 검증

- patch 적용 단위 테스트: 축별 적용/미적용, 모티프 불변, 팔레트 강제 충돌 시 `constraint_conflict`
- `scope_rejected`: 토큰 잔액 불변, 턴 미생성, `context_version` 불변 (api 통합 테스트)
- 결정론: 같은 intent + 같은 patch → byte-identical SVG
- 회귀: 최초 저작 경로(프롬프트·참고 사진·정확 모티프)는 건드리지 않았음을 기존 테스트로 확인

## 완료 판정

1. `gemini.py` 줄 수가 절반 이하로 줄었다 (1907 → 목표 900 이하)
2. patch 스키마에 모티프 관련 필드가 없다 — `grep -n "motif" engine/patch.py` 결과 0건
3. "벌을 나비로 바꿔줘" 요청이 토큰 차감 0, 턴 0, 상단 알림 1건으로 끝난다
4. 경고가 한글 1줄로 내려온다

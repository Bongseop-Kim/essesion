# /design 재설계 6단계 — 통합 기록 (2026-07-31 ~ 08-01)

원래 6개 리뷰(01~06)를 하나로 합친 결정 기록이다. 상세 변경 목록은 Git 이력에 남아 있고,
현재 계약의 정본은 [worker-pipeline.md](../api-spec/worker-pipeline.md) §5와
[worker-engine.md](../api-spec/worker-engine.md) §7.1이다.

## 1단계 — 후보 제거, 결과 1개, 스텝 이동

한 번의 생성이 디자인 **1개**를 만들고, 세션은 그 디자인들의 선형 이력(스텝)을 갖는다.
"후보 N개 중 선택"은 서버에서 사라졌다.

- `engine/candidates.py`의 팬아웃(`_layout_variants`·`_stripe_variants`·`_lattice_cell_variants`·
  `_motif_size_variants`·`RankedCandidate`·`CandidateSet`·`generate_candidate_set`)을 전부 삭제하고
  `compose_design(intent) -> ComposedDesign` 하나만 남겼다(약 520행 → 80행).
- 컬러웨이 미지정 시 선택 규칙은 후보 랭킹이 쓰던 기준을 유지한다: **distinct color 수가 가장
  적은 컬러웨이, 동수면 id 순**. 단일 결과가 예전 rank 1위와 같은 색으로 나오게 하기 위함이다.
- `GenerateRequest.candidate_count` 삭제, `CandidateOut` → `DesignOut`.

## 2단계 — 구성 patch 계약, 보존 기계 폐기

입력창 문장은 **구성 축만 바꾸는 좁은 patch**를 만든다. "모델이 요청 범위를 넘었는지 정규식으로
추측하고 되돌리는" preserve 기계는 사라졌다 — patch 스키마에 모티프 정체성 필드가 없어
**타입상 불가능**하기 때문이다.

- 신규 `engine/patch.py` — `DesignPatchV1` + `composition_snapshot` + `apply_patch`.
  축은 `background{color}`, `stripe{angle, period_mm, bands[]}`,
  `placement{arrangement, count_per_axis, rotation_deg}`, `motif_size_mm[]`, `motif_color`,
  `palette{slots}`, `note`, `out_of_scope`. 전부 nullable이며 null = "그대로 둔다"이므로
  원복 로직이 필요 없다.
- **적용이 엔진 불변식을 깰 수 없다**: 격자는 `count_per_axis`만 받아 셀을 `tile/count`로
  계산하고, 엇갈림은 짝수 축으로 올리고, 밴드는 `offset % period`·`min(width, period)`로
  정규화하고, 모티프 크기는 tile로 클램프한다. 따라서 **patch 저작은 자기수정 재시도 라운드가
  없다(1콜)** — 최초 저작의 4라운드와 다르다.

## 3단계 — 모티프 문장 검색·생성·교체, 패턴 4축 폐기

모티프는 목록이 아니라 **문장**으로 찾고, 없으면 문장으로 만들고, 슬롯 교체는 모델 없이
결정론으로 재렌더한다. 크기·밀도·배치·방향 4축(`PatternConstraints`)은 전 계층에서 사라졌다.

- 문장 → `MotifSpec` 변환은 LLM 1콜 구조화 출력. 규칙 기반은 한국어 문장에서 `scope`/`view`/
  `style`을 못 뽑고 이 축이 검색 품질을 좌우한다. 대신 **실패가 검색을 막지 못하게** 했다 —
  모델 미구성·예외·타임아웃이면 문장을 그대로 `subject`로 써서 렉시컬·벡터 검색을 계속한다.

## 4~5단계 — store 캔버스 셸과 모티프 모달 통합

- 좌우 2패널·채팅 피드·후보 그리드를 없애고, 넥타이가 화면을 채우는 캔버스 + 떠 있는 컨트롤
  4그룹으로 바꿨다. 모티프 카드 접힘 상태는 `design:motif-panel:collapsed`로 localStorage에 남긴다.
- 흩어진 모티프 모달 4개를 `motif-modal.tsx` + `motif-generate-modal.tsx` 둘로 합치고, 기본
  경로를 목록이 아니라 **문장 → RAG 검색**으로 바꿨다. 유료 생성은 확인 모달을 반드시 거친다.
  검색 상태(`use-motif-search.ts`)는 모달이 아니라 **페이지가 소유**해서, 확인 모달을 갔다
  돌아와도 검색어·결과·선택이 유지된다.

## 6단계 — 과금 단가 분리 (미결 M1 확정)

첫 생성과 구성 수정의 단가를 분리한다.

| 행위 | 키 | 기본값 |
|---|---|---|
| 첫 생성 (전체 저작 + 모티프 해석) | `admin_settings.design_token_cost_openai_render_standard` | 5 |
| 구성 수정 (patch, 1콜) | `admin_settings.design_edit_cost` | 2 |
| 모티프 검색·교체 | — | 0 |
| 모티프 생성 | — | 토큰 0 + 세션 예산 3회 |
| 범위 밖 거절(`scope_rejected`) | — | `work_id` 멱등 환불 |

`ledger.get_generate_cost` → `get_cost(session, cost_key=...)`, `use_tokens(..., cost_key=...)`.
"후보"·"패턴 4축"·"전체 재저작(refine)" 개념을 코드·스키마·문서·테스트에서 전부 제거했다.

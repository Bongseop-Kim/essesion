# 구성 patch 배치 후속 — 진단 노출 · 스냅샷 · 클램프 정책

2026-08-15 프로덕션 로그 4건(전부 `partial`) 조사에서 나온 후속 작업이다. 조사 대상은 한
디자인 세션의 연속 4턴이며, 사용자는 매 턴 "벌과 꽃이 겹친다 / 대각선으로 / 간격을 넓혀라"를
요청했다.

관련: `docs/api-spec/worker-pipeline.md §5`(patch 계약·모티프 슬롯 파생·진단 저장),
`docs/api-spec/worker-engine.md §3`(lattice offset).

## 조사 결과 요약 — 저작 모델은 대체로 맞았다

`_apply_placement`는 결정론이므로 before/after intent에서 모델이 보낸 patch를 역산할 수 있다.

| 턴 | 프롬프트 | before → after | 역산한 patch | 판정 |
|---|---|---|---|---|
| 1 | (슬롯2 교체, 모델 미호출) | — → 축당 3, size 14 | — | — |
| 2 | 대각선 + 간격 넓게 | 3 → **2, drop 0.5** | `staggered, count=2` | 정확 |
| 3 | 겹치지 않게 | 2 → **10, drop 제거** | `lattice, count=10` | 오답 |
| 4 | 겹치지 않게 + 넓게 + 대각선 | 10 → **8, drop 0.5** | `staggered, count=8` | 방향 맞음 |

3턴 중 2턴은 요청대로 반환됐고 엔진도 그대로 적용했다. **그런데도 화면에서는 두 모티프가
계속 정확히 포개져 있었다** — 아래 선행 항목이 원인이다. 3턴째 모델 오답도 "스냅샷은 정상인데
사용자는 겹친다고 말하는" 모순 상태에서 나왔을 개연성이 크므로, 선행 수정 없이 모델 쪽을
손대는 것은 순서가 틀렸다.

## 선행 — 이미 작업 트리에 있는 두 수정 (배포 필요)

이 플랜의 나머지는 아래가 프로덕션에 올라간 뒤에 판단한다.

1. `render/raster.py` — `rsvg-convert`에 `-`(stdin) 인자를 넘기지 않는다. 배포 이미지의
   librsvg 2.54는 `-`를 파일명으로 읽어 프리뷰 래스터화가 **항상** 실패했고, 그것이 로그
   4건이 전부 `partial`이 된 유일한 원인이다. 로컬(2.62)에서는 `-`가 stdin이라 재현되지 않는다.
   같은 `rasterize_svg`를 finalize(인쇄 파일)도 쓰므로 배포 후 실주문 1건으로 확인할 것.
2. `engine/patch.py::_apply_placement` — 배치를 다시 만들 때 격자 위상(`offset_x/y_mm`)을 셀
   대비 비율로 옮긴다. 기존에는 `lattice_placement()`가 위상 없는 배치를 새로 만들어,
   `set_motif_slot`이 슬롯2에 넣어둔 반 칸 엇갈림이 **첫 배치 patch에서 소실**됐다. 이는
   `worker-pipeline.md §5`가 명시한 "같은 격자·반 칸 엇갈림으로 파생" 계약 위반이다.

## 1. admin에 patch 원본과 격자 위상 노출 (무위험, 먼저)

이번 조사에서 모델 출력을 역산해야 했던 이유는 순전히 admin이 가진 것을 안 내려줬기 때문이다.
둘 다 이미 DB에 있다.

- `apps/api/src/api/domains/admin/generation.py::_safe_diagnostics` — `diagnostics["patch"]`를
  투영에 추가한다. worker가 `llm.py::author_patch`에서 `sink["patch"] = patch.model_dump(...)`로
  저장하고 있고, `worker-pipeline.md §5`도 "적용한 patch"를 진단 저장 항목으로 명시한다.
  기존 필드들과 같은 방식으로 화이트리스트·길이 상한을 두고 살균할 것 — 문자열 필드는
  모델이 쓴 값(`note`)이므로 그대로 통과시키지 않는다.
- 같은 파일 `_INTENT_ALLOWED_KEYS` — `offset_x_mm`, `offset_y_mm`을 추가한다. 지금은 admin의
  Intent JSON에서 격자 위상이 통째로 빠져 있어, 두 모티프가 겹쳤는지 화면으로 판단할 수 없다.
- `apps/admin/src/pages/generation/seamless-detail.tsx` — 생성 진단 영역에 patch 원본을
  `Intent JSON`과 같은 접이식 블록으로 붙인다.

api 스펙 표면이 바뀌므로 `pnpm codegen` 후 `packages/api-client` 생성물을 같은 커밋에 넣는다.

수용 기준: 위 4건 중 `18cba70b-3cbf-4b64-9ca4-ae32e3d6a423` 상세에서 `arrangement`·
`count_per_axis` 값이 화면에 보이고, `836bdf26-6bf5-41f9-aff9-cffebcd8b02e`의 `motif_slot_2`
격자에 `offset_x_mm`이 보인다.

## 2. 모델 스냅샷에 모티프 레이어별 배치 노출 — **조건부**

`composition_snapshot`(`engine/patch.py:204`)은 모티프가 몇 장이든 `motifs[0]`의 배치 하나만
모델에 준다. 두 레이어가 서로 어긋나 있는지, 같은 자리에 있는지 모델은 알 수 없다.

**실행 조건**: 선행 2번을 배포한 뒤에도 "겹친다"는 요청이 재현될 때만 실행한다. 위상이
보존되면 두 모티프가 정확히 포개지는 상태 자체가 사라지므로 이 작업이 불필요해질 수 있다.
재현 확인 없이 먼저 손대지 말 것 — 모델에게 줄 정보를 늘리는 것은 되돌리기 어렵다.

재현될 경우의 지시:

- 스냅샷에 레이어별 정보를 더한다. 원시 mm 좌표가 아니라 **모델이 patch로 표현할 수 있는
  형태**로 준다 — 현재 `PlacementPatch`에는 레이어별 축이 없으므로, 원시 offset을 줘도 모델은
  고칠 수단이 없고 환각만 는다. 최소한으로는 "두 모티프 레이어가 같은 격자 위상을 쓰는지"
  불리언 하나로 충분하다.
- `PATCH_PROMPT_REVISION`(`adapters/llm.py:57`)을 올린다. 이 값은 진단 라벨 전용이고
  few-shot 예시는 `author_design` 경로만 쓰므로(`author_patch`는 `examples` 인자가 없다)
  올리는 비용은 없다. `authoring/promotion.py`는 `authoring["plan"]`을 다루므로 patch 런과
  무관하다.
- `docs/api-spec/worker-pipeline.md §5`의 patch 계약 문단을 같은 커밋에서 갱신한다.

수용 기준: `apps/worker/tests/test_patch.py`에 두 모티프 레이어 상태가 스냅샷에 반영되는
테스트를 추가하고, 실제 프롬프트("벌이랑 꽃이 겹쳐")로 로컬 1콜을 돌려 patch가
`count_per_axis`를 올리지 않는지 확인한다.

## 3. 격자 클램프가 모티프 크기를 영구 파괴하는 문제

`constraints.py::_clamp_lattice_overlap`은 모티프가 셀의 1.15배를 넘으면 크기를 줄인다.
줄어든 크기는 **되돌아오지 않는다**. 조사 데이터에서 실제로 일어난 일:

- 3턴: 축당 10개 → 셀 4.8mm → size 14mm가 **5.52mm**(= 4.8 × 1.15)로 클램프
- 4턴: 셀을 6mm로 되돌렸지만 size는 5.52mm 그대로 — 원래 14mm짜리 모티프가 60% 작아진 채 고착

모델은 배치만 patch했고 `motif_size_mm`은 건드리지 않았으므로 복구되지 않는다. 스냅샷에는
클램프된 5.52가 "현재 크기"로 들어가므로 모델은 이것이 원래 값이라고 믿는다.

**결정이 필요하다.** 세 안:

- **A. 크기 대신 밀도를 양보한다 (권고)** — patch가 `placement`만 바꾸고 `motif_size_mm`은
  건드리지 않은 경우, 현재 크기가 들어갈 수 있는 최대 `count_per_axis`로 낮춘다. 크기는
  사용자가 명시적으로 말한 축이고 밀도는 "촘촘/넓게"라는 상대 표현이므로, 충돌 시 크기를
  지키는 쪽이 요청에 가깝다. 상태를 늘리지 않는다. 둘 다 바꾼 patch는 지금처럼 크기를 클램프한다.
- **B. 원래 크기를 intent에 기억한다** — 정확하지만 Intent 스키마에 필드가 늘고
  (`worker-engine.md §1` 개정), 클램프 해제 시점 규칙도 새로 정해야 한다.
- **C. 그대로 두고 알린다** — 클램프 경고에 한글 문구를 붙여 고객에게 노출한다. 다만
  `warnings.py`의 현행 기준("화면만 보고는 알 수 없는 것만 말한다")은 크기 클램프를 명시적으로
  제외하고 있어, 그 기준부터 뒤집어야 한다.

어느 안이든 `docs/api-spec/worker-engine.md §8`(상수)과 `worker-pipeline.md §5`(정규화 문구)를
같은 커밋에서 갱신한다. `LATTICE_OVERLAP_ALLOWANCE = 1.15`는 정의상 15% 겹침을 허용하므로,
"겹치지 않게"라는 요청이 격자에서 완전히 만족될 수 없다는 점도 함께 적을 것.

수용 기준: 조사 데이터의 3→4턴을 그대로 재생하는 테스트에서 4턴 결과의 `size_mm`이 원래
값(14mm)을 회복하거나, 3턴에서 애초에 클램프가 일어나지 않는다.

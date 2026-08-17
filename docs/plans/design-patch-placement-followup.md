# 구성 patch 배치 후속 — 모델 스냅샷에 레이어별 배치 노출 (조건부)

2026-08-15 프로덕션 로그 4건 조사에서 나온 후속 작업 중 **남은 한 건**이다. 조사 요약과
실행 완료분(admin patch 노출, 클램프 정책 A안)은
[design-patch-placement-2026-08-16](../reviews/design-patch-placement-2026-08-16.md)에 있다.

관련: `docs/api-spec/worker-pipeline.md §5`(patch 계약·진단 저장),
`docs/api-spec/worker-engine.md §3`(lattice offset)·`§7.1`(겹침 클램프·밀도 양보).

## 선행 — 배포되어야 판단할 수 있는 두 수정

1. `render/raster.py` — `rsvg-convert`에 `-`(stdin) 인자를 넘기지 않는다. 배포 이미지의
   librsvg 2.54는 `-`를 파일명으로 읽어 프리뷰 래스터화가 **항상** 실패했고, 그것이 로그
   4건이 전부 `partial`이 된 유일한 원인이다. 로컬(2.62)에서는 `-`가 stdin이라 재현되지 않는다.
   같은 `rasterize_svg`를 finalize(인쇄 파일)도 쓰므로 배포 후 실주문 1건으로 확인할 것.
2. `engine/patch.py::_apply_placement` — 배치를 다시 만들 때 격자 위상(`offset_x/y_mm`)을 셀
   대비 비율로 옮긴다. 기존에는 `lattice_placement()`가 위상 없는 배치를 새로 만들어,
   `set_motif_slot`이 슬롯2에 넣어둔 반 칸 엇갈림이 **첫 배치 patch에서 소실**됐다.

둘 다 코드에는 들어갔고 아직 프로덕션에 올라가지 않았다. 사용자가 "겹친다"고 말한 화면은
2번이 원인이었을 개연성이 크다.

## 모델 스냅샷에 모티프 레이어별 배치 노출

`composition_snapshot`(`engine/patch.py`)은 모티프가 몇 장이든 `motifs[0]`의 배치 하나만
모델에 준다. 두 레이어가 서로 어긋나 있는지, 같은 자리에 있는지 모델은 알 수 없다.

**실행 조건**: 위 선행 2번을 배포한 뒤에도 "겹친다"는 요청이 재현될 때만 실행한다. 위상이
보존되면 두 모티프가 정확히 포개지는 상태 자체가 사라지므로 이 작업이 불필요해질 수 있다.
재현 확인 없이 먼저 손대지 말 것 — 모델에게 줄 정보를 늘리는 것은 되돌리기 어렵다.

재현될 경우의 지시:

- 스냅샷에 레이어별 정보를 더한다. 원시 mm 좌표가 아니라 **모델이 patch로 표현할 수 있는
  형태**로 준다 — 현재 `PlacementPatch`에는 레이어별 축이 없으므로, 원시 offset을 줘도 모델은
  고칠 수단이 없고 환각만 는다. 최소한으로는 "두 모티프 레이어가 같은 격자 위상을 쓰는지"
  불리언 하나로 충분하다.
- `PATCH_PROMPT_REVISION`(`adapters/llm.py`)을 올린다. 이 값은 진단 라벨 전용이고
  few-shot 예시는 `author_design` 경로만 쓰므로(`author_patch`는 `examples` 인자가 없다)
  올리는 비용은 없다. `authoring/promotion.py`는 `authoring["plan"]`을 다루므로 patch 런과
  무관하다.
- `docs/api-spec/worker-pipeline.md §5`의 patch 계약 문단을 같은 커밋에서 갱신한다.

수용 기준: `apps/worker/tests/test_patch.py`에 두 모티프 레이어 상태가 스냅샷에 반영되는
테스트를 추가하고, 실제 프롬프트("벌이랑 꽃이 겹쳐")로 로컬 1콜을 돌려 patch가
`count_per_axis`를 올리지 않는지 확인한다.

# 구성 patch 배치 후속 — 진단 노출·클램프 정책 (2026-08-16)

2026-08-15 프로덕션 로그 4건 조사(`design-patch-placement-followup` 플랜)의 실행 기록.
선행 두 수정과 §1·§3을 끝내고 플랜은 제거했다. 남은 조건부 항목은 맨 아래 "재현되면 할 일".

## 선행 두 수정 — 로컬에서 검증 완료 (2026-08-17)

플랜은 이 둘을 "배포되어야 판단할 수 있다"고 적었으나 사실이 아니었다. 배포 없이 로컬에서
원인 확정·수정 검증이 끝났다.

- `render/raster.py` — `rsvg-convert`에 `-`(stdin) 인자를 넘기지 않는다. 배포 이미지의
  librsvg 2.54가 `-`를 파일명으로 읽어 프리뷰 래스터화가 **항상** 실패했고, 그것이 로그 4건이
  전부 `partial`이 된 유일한 원인이다. 로컬 rsvg는 2.62라 재현되지 않지만 배포 베이스 이미지를
  그대로 띄우면 재현된다 — `docker run --rm ghcr.io/astral-sh/uv:python3.13-bookworm-slim`에
  `librsvg2-bin`을 깔면 2.54.7이고, `-f png -`는 `Error reading file "-"`로 rc=1, 인자 없는
  stdin은 rc=0에 정상 PNG. 인자 없는 형태는 2.54·2.62 양쪽 다 stdin이라 로컬 회귀도 없다.
- `engine/patch.py::_apply_placement` — 배치를 다시 만들 때 격자 위상(`offset_x/y_mm`)을 셀
  대비 비율로 옮긴다. 기존에는 `lattice_placement()`가 위상 없는 배치를 새로 만들어,
  `set_motif_slot`이 슬롯2에 넣어둔 반 칸 엇갈림이 첫 배치 patch에서 소실됐다.
  `test_patch.py::test_placement_patch_keeps_the_two_motif_slots_staggered`가 이걸 잡는다
  — 위상 복원 분기를 죽이면 `KeyError: offset_x_mm`로 실패하는 것까지 확인했다.

남은 프로덕션 확인은 finalize(인쇄 파일) 실주문 1건뿐이다. 같은 `rasterize_svg`를 쓰므로
프리뷰가 정상이면 통과할 것으로 본다.

## §1 admin에 patch 원본과 격자 위상 노출

역산 없이 모델 출력을 볼 수 있도록, 이미 DB에 있던 두 값을 투영에 추가했다.

- `_safe_diagnostics`에 `patch` — worker가 `sink["patch"]`로 저장하던 patch 원본을
  화이트리스트 투영(`_safe_patch`)으로 내린다. 색은 hex 정규식, 수치는 finite 검사, 배열은
  worker 상한(밴드 4·슬롯 16·모티프 2)으로 자른다. `note`만 모델이 쓴 자유 문장이라
  `_safe_metadata`(이메일·전화·URL 포함 시 통째로 탈락)를 태운다.
- `_INTENT_ALLOWED_KEYS`에 `offset_x_mm`·`offset_y_mm` — 두 모티프 슬롯이 반 칸 엇갈렸는지
  Intent JSON에서 판단할 수 있는 유일한 값인데 통째로 빠져 있었다.
- admin 생성 진단 카드에 `구성 patch 원본` 접이식 블록(`TechnicalDetails`).

api 스펙 표면이 바뀌어 `pnpm codegen` 생성물을 같은 커밋에 넣었다.

## §3 격자 클램프가 모티프 크기를 영구 파괴하는 문제 — A안(밀도 양보) 채택

`_clamp_lattice_overlap`이 줄인 `size_mm`은 셀을 되돌려도 복구되지 않는다(조사 3턴에서
14mm → 5.52mm로 고착). 크기는 사용자가 명시한 축, 밀도는 "촘촘/넓게"라는 상대 표현이므로
충돌 시 크기를 지키기로 했다.

- `engine/patch.py::_density_cap` — 현재 `size_mm`이 셀에 들어가는 최대 축 개수.
  `placement`만 담은 patch는 이 상한으로 `count_per_axis`를 낮춘다. 엇갈림은
  `lattice_placement`가 홀수 축을 올림하므로 상한도 짝수로 내린다(올림이 셀을 상한 밑으로 민다).
- `motif_size_mm`을 함께 담은 patch는 종전대로 요청 밀도를 받고 크기를 클램프한다.
- 상태를 늘리지 않는다 — intent 스키마 변경 없음(B안 기각), 경고 문구 기준도 그대로(C안 기각).

`worker-engine.md §7.1·§8`과 `worker-pipeline.md §5`를 같은 커밋에서 갱신했다.
`LATTICE_OVERLAP_ALLOWANCE = 1.15`가 정의상 15% 겹침을 허용하므로 "겹치지 않게"는 격자에서
완전히 만족될 수 없고 밀도를 낮추는 것이 유일한 응답이라는 점도 §7.1에 적었다.

## 확인

- `apps/worker/tests/test_patch.py` — 조사 3→4턴(축당 10 → staggered 8)을 재생해
  `apply_generation_constraints` 경고가 0건이고 `size_mm`이 14mm로 남는지 검증.
- `apps/api/tests/test_admin_generation.py` — patch 투영과 격자 위상 노출, `note`의
  이메일 탈락.
- `uv run pytest apps/worker/tests apps/api/tests/test_admin_generation.py` 551 passed,
  `pnpm lint`·`pnpm typecheck`·`pnpm architecture:check` 통과.

## 재현되면 할 일 — 모델 스냅샷에 레이어별 배치 노출 (실행 안 함)

`composition_snapshot`(`engine/patch.py`)은 모티프가 몇 장이든 `motifs[0]`의 배치 하나만
모델에 준다. 두 레이어가 어긋나 있는지 모델은 알 수 없다. 다만 위상 소실이 고쳐진 지금은
두 모티프가 정확히 포개지는 상태 자체가 사라졌으므로 **"겹친다"가 다시 나올 때만** 손댄다.
재현 없이 먼저 하지 말 것 — 모델에게 주는 정보를 늘리는 건 되돌리기 어렵다.

- 레이어별 정보는 원시 mm가 아니라 **모델이 patch로 표현할 수 있는 형태**로. `PlacementPatch`에
  레이어별 축이 없어 원시 offset을 줘도 고칠 수단이 없고 환각만 는다. "두 모티프가 같은 격자
  위상을 쓰는지" 불리언 하나면 충분하다.
- `PATCH_PROMPT_REVISION`(`adapters/llm.py`)을 올린다. 진단 라벨 전용이고 few-shot은
  `author_design` 경로만 쓰므로(`author_patch`에는 `examples` 인자가 없다) 비용은 없다.
- `docs/api-spec/worker-pipeline.md §5` patch 계약 문단을 같은 커밋에서 갱신.
- 수용 기준: `test_patch.py`에 두 레이어 상태가 스냅샷에 반영되는 테스트, 그리고 실제
  프롬프트("벌이랑 꽃이 겹쳐")로 로컬 1콜을 돌려 patch가 `count_per_axis`를 올리지 않는지 확인.

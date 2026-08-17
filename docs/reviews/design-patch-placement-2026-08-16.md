# 구성 patch 배치 후속 — 진단 노출·클램프 정책 (2026-08-16)

플랜 `design-patch-placement-followup`의 §1·§3 실행 기록. §2(모델 스냅샷에 레이어별 배치
노출)는 선행 수정 배포 후 "겹친다" 재현이 확인될 때만 실행하는 조건부 항목이라 플랜에 남겼다.

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

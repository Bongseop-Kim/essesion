# 격자 모티프 겹침 클램프 — 셀의 1.15배 상한

실행일: 2026-07-30

상태: 구현·단위 검증 완료 (브라우저 확인 잔여)

범위: `docs/plans/design-motif-lattice-overlap.md` 전체. 저작(size_ratio ↔ columns/rows)과
패턴 설정(크기 ↔ 밀도) 두 경로에서 독립적으로 발생하던 격자 겹침을, 컴파일러에서
결정론적으로 클램프해 해결.

## 결정

의도적 겹침 정책은 플랜의 **2번(여유 계수)** 채택 — 상한 `LATTICE_OVERLAP_ALLOWANCE = 1.15`
(사용자 확인). 셀의 1.15배까지는 그대로 통과시켜 촘촘한 플로랄 같은 밀집을 남기고,
그 위만 형상 파괴로 보고 줄인다.

## 변경

- `apps/worker/src/worker/engine/constraints.py`
  - `LATTICE_OVERLAP_ALLOWANCE = 1.15`, `lattice_size_limit(cell_mm)`(공개),
    `_lattice_cell_mm(layer)`, `_clamp_lattice_overlap(raw, warnings)` 추가.
  - `apply_generation_constraints`가 팔레트·패턴을 **모두 적용한 뒤 마지막에** 클램프 —
    크기·밀도 두 축을 함께 지정해도 관계가 깨지지 않는다. 패턴이 전부 `auto`인
    저작 경로에도 걸리도록 `_apply_pattern`의 early-return 밖에 둔다.
  - 선택 인자 `warnings`에 기존 snap 경고와 같은 형식으로 남긴다:
    `layer 'motif_0': size_mm 14.4 clamped to 13.8 (lattice cell 12.0 × 1.15)`.
  - `assert_constraints_satisfied`의 `motif_scale` 기대값을
    `min(tile × _SCALE_FRACTION, lattice_size_limit(cell))`로 계산 — 플랜이 지적한
    핵심 위험(정확 일치 요구가 클램프와 충돌)을 기대값 쪽에서 해소.
- `apps/worker/src/worker/engine/candidates.py` — 플랜 범위 외 추가분. 후보 변이가
  클램프를 되돌리는 구멍을 막았다. `_motif_size_variants`의 ×1.35 확대는 격자 레이어에서
  셀 상한까지만, `_with_lattice_cells`의 셀 축소 변이는 모티프도 같이 줄인다. 없으면
  base만 정상이고 사용자가 보는 후보 절반이 다시 겹친다(패턴 미지정 = 저작 경로가 정확히
  이 경우).
- `apps/worker/src/worker/api/routes.py` — `warnings` 전달. `_generate_from_intent`에
  인자 추가, 프롬프트 경로는 `_validate`가 로컬 리스트로 받아 **통과한 설계에서만**
  옮긴다(거절된 재시도의 경고가 응답에 새지 않게).
- 저작 스키마(`authoring/schema.py`)·엔진 `validate.py`는 무변경.

## 판단 근거 (엔진이 아니라 컴파일러에 둔 이유)

`validate_intent`의 repair 단계가 경고 채널·전 경로 커버를 공짜로 주지만,
`golden/json/07_motif_lattice_half_drop_column.json`이 size 14.0 / 셀 12.0 = **1.167배**로
상한을 넘는다. 골든은 원본 seamless-tile 엔진에서 추출한 byte-identical 대조표라
엔진에서 클램프하면 파리티가 깨진다. 겹침 상한은 엔진 불변식이 아니라 생성 정책이므로
생성 경로(constraints/candidates)에만 둔다.

## 검증

- 신규 `test_lattice_motif_larger_than_cell_is_clamped_with_a_warning` — S4 회귀
  (size 14.4 / 셀 12.0 → 13.8 + 경고 1건), 상한 이하(13.0)는 무변경·무경고.
- 신규 `test_scale_and_density_together_never_exceed_the_overlap_allowance`
  (크기 3 × 밀도 3 = 9조합) — S7 회귀. 각 조합에서 `size_mm ≤ 셀 × 1.15`,
  `assert_constraints_satisfied` 통과, 그리고 생성된 후보 8개의 모든 격자 레이어까지 상한 이하.
- 신규 `test_lattice_overlap_clamp_is_reported_as_a_warning` — `/generate`(intent 경로)
  응답에서 `intents[0]`의 size_mm가 13.8로 클램프되고 `warnings`에 경고가 실제로 실린다
  (경고 배선 검증).
- 기존 `test_pattern_controls_map_to_physical_engine_primitives_and_lock_variants`의
  기대값 갱신: large + dense는 13.44 → **6.9**(셀 6.0 × 1.15)로 클램프.
- `uv run pytest` 전체 1182 passed(worker 544 + api), ruff·pyright 통과. 골든 파리티 무변경
  — `07_motif_lattice_half_drop_column`(1.167배)을 포함해 골든 SVG는 한 바이트도 안 바뀐다.
- **잔여**: Aside로 텍스트 모티프("잇선")·사진 모티프(로고) 생성 판독성 확인. 로컬 워커(:8001)가
  `--reload` 없이 떠 있어 변경 전 코드를 서빙한다 — 워커를 재시작한 뒤 확인해야 한다.

## 관찰 / 남은 것

- 1.15배는 겹침을 **없애지 않는다** — S7의 "크게+여유롭게"(13.44mm / 12mm 셀 = 1.12배)와
  S3의 "0.25 ratio + columns 4"(1.0배)는 상한 이내라 그대로 통과한다. 채택한 정책의
  의도(살짝 닿는 밀집은 남긴다)대로다. 로고·글자에서 여전히 뭉개지면 계수를 1.0으로
  내리는 것이 다음 수이고, 상수 한 곳만 바꾸면 된다.
- 회전(`fixed_rotation_deg`)으로 커지는 실제 바운딩 박스는 계산하지 않는다. ±10° 회전은
  정사각 모티프의 폭을 약 1.17배로 늘리므로 상한 이내에서도 닿을 수 있다. 필요해지면
  `lattice_size_limit`에 cos/sin 보정을 더한다(주석으로 표시).
- 겹침 경고는 admin 경고 분류기에서 `generation_warning`(폴백)으로 묶인다. 전용 코드가
  필요하면 `apps/api/src/api/domains/admin/generation.py`의 분류에 한 분기 추가.
- scatter·path 배치의 겹침은 이번 범위 밖(격자만).

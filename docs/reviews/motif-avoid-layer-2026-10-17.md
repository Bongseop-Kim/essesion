# 모티프 레이어 자리 비우기(avoid) — 실행 기록 (2026-10-17)

플랜 `docs/plans/motif-avoid-layer.md`(삭제)를 실행했다. 모티프 레이어가 앞서 그린 다른 모티프 레이어와
겹치는 자기 인스턴스를 건너뛰게 하는 선택 필드를 엔진 intent와 Plan v3에 더하고, 이 필드로 「세리프 R과
마름모 도트」를 흩어진 R로 다시 만들었다.

## 한 일

- **엔진** — `Placement.avoid_layer`. `compose`가 모티프 레이어별 그려진 배치(경계 클론 전·avoid 후)를
  모아 두고, 토러스 거리 `< (자기 size + 상대 size)/2`인 인스턴스를 입력 순서대로 뺀다. 체인(A←B←C)에서 C는
  필터된 B를 본다(플랜은 이 점을 정하지 않았다). 전부 빠지면 영문 경고.
- **검증** — 자기 자신·없는 id·모티프가 아닌 레이어·뒤에 그려지는 레이어는 `IntentInvalid`.
- **플랜** — `MotifLayerPlan.avoid_motif_layer`(앞 서수만), 값이 없으면 dump에서 빠져(`exclude_if`) 기존
  플랜·fingerprint가 바이트 그대로. 컴파일러가 `motif_{서수}`로 옮긴다. 플랜 단계 레이어 drop은
  `snapshot_resolved_plan`과 `authoring/preview.py` 두 곳이고, 둘 다 `prune_motif_layers`로 서수를 다시
  매기며 대상이 빠지면 avoid를 지운다. intent 단계 soft-drop은 현재 생성 경로에 없다.
- **patch** — `_apply_placement`가 배치를 새로 만들 때 `avoid_layer`를 옮겨 담는다.
- **명세·주변** — `worker-engine.md` §1·§3, `worker-motifs.md` §6, admin intent allowlist.
  DesignPlanV3는 OpenAPI에 없어 codegen 드리프트 없음.
- **템플릿** — 별도 템플릿(「흩어진 R과 마름모 도트」)으로 만들었다가 원본과 차이가 거의 없어 원본
  `template_dot_initial_r`을 이 구성으로 교체했다(사용자 결정). 타일 2배, R sateen 8·3 + 점 lattice 4×4 +
  `grid4_inset`, 두 점 레이어 avoid R. 스킬 `tie-template` 갱신.

## 검증

- `apps/worker/tests/test_avoid_layer.py` 14개(필터·결정론·이음새·전부 제거 경고·잘못된 참조·patch 보존·
  플랜 서수·snapshot 정리) + 엔진·저작·patch·골든·시드 관련 스위트 통과.
- 시드 warnings `[]`, `check_emblems` `initialr`. 스토어 카드(dsf=2): R 자리 점 없음, 격자 구멍 없음,
  세로·가로 일직선 없음.

## 후속

- 카드에서 끝 엠블럼(큰 R) 밑에 무늬 속 작은 R이 비쳐, panel에 바탕색 원 받침(반경 85)을 깔았다.
  로고는 엠블럼(logo_slot=1) 그대로라 사용자 로고 교체 동작은 바뀌지 않는다.

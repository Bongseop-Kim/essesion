# 모티프 레이어 "자리 비우기"(avoid) — 격자 속 일부 자리를 다른 모티프에 내주기

모티프 레이어가 **앞서 그린 다른 모티프 레이어와 겹치는 자기 인스턴스를 건너뛰게** 하는 선택 필드를
엔진 intent와 플랜(DesignPlanV3)에 더한다. 그다음 이 필드로 스토어 템플릿 「흩어진 R과 마름모 도트」를
새로 만든다. 2026-10-17 사용자 결정("엔진이 많은 경우의 수를 대응할 수 있어야")에서 나왔다. 레이어
상한(5)을 올리는 안 대신 택했다. 언제든 실행할 수 있다.

## 왜 필요한가

- **실측(2026-10-17, 「세리프 R과 마름모 도트」 엇박 작업)**: 점 격자의 몇 자리를 R이 차지하는 도트형에서,
  R을 세로·가로 일직선 없이 흩으면서 나머지 자리를 빠짐없이 점으로 채우는 플랜은 **레이어 5개 안에
  없다**. 타일 72·96·120·144mm에서 엔진이 만드는 점 집합(lattice·sateen·point_template·원점/레인 경로)의
  조합을 전부 탐색해 확인했다. 원인은 엔진에 "격자에서 몇 자리를 빼는" 표현이 없다는 것이다. 그래서 점을
  레인 줄마다 쪼개 깔아야 했고, 레이어가 6~7개 필요했다.
- 5개 안의 근사는 구멍(점이 빠진 자리)이 났다. 사용자는 원본(48mm 반복, R이 세로 열에 섬)을 골랐다 —
  `.claude/skills/tie-template/SKILL.md` "배운 것"의 엇박 항목.
- **같은 문제가 반복된다(추정)**: 도트·체크·격자 계열에서 "격자 일부를 로고로 바꾸기"는 흔한 구성이다.
  지금은 같은 자리를 여러 레이어로 나눠 까는 우회(스킬 "엔진 제약"의 "격자 한 자리를 로고로 바꾸기")만
  있고, 그마저 로고가 규칙적 자리(`diagonal_pair` 등)에만 갈 수 있다.
- 레이어 상한을 올리지 않는 이유는 "기각한 대안"에 적었다.

## 범위 밖

- 레이어 상한(`MAX_STRUCTURE_LAYERS = 5`) 변경.
- 기존 템플릿 수정. 원본 「세리프 R과 마름모 도트」(`template_dot_initial_r`)는 그대로 둔다.
- 사용자 구성 patch(`DesignPatchV1`)로 avoid를 켜고 끄는 기능. 이 플랜은 저작·시드 경로만 다룬다.
- 줄무늬(stripe)를 피하는 것. 대상은 다른 모티프 레이어의 인스턴스뿐이다.

## 실행 조건

- 선행 조건 없음. 로컬 DB·서버(store :3000, api :8000, worker :8001)가 떠 있어야 6단계 카드 확인이 된다.
- 워커는 `--reload` 없이 떠 있을 수 있다. 엔진을 바꾼 뒤에는 :8001 프로세스를 재시작해야 스토어 상세의
  재합성이 새 코드로 돈다.
- **실행하지 말 것**: 1~4단계(엔진·명세·테스트)가 통과하기 전에는 5단계(새 템플릿 시드)를 하지 않는다.
  필드를 모르는 워커가 그 intent를 받으면 `extra="forbid"`로 거절한다.

## 계약 — 무엇을 더하나

- **intent**: `Placement.avoid_layer: str | None = None`. 같은 intent의 **모티프 레이어 id**이고, 자기보다
  먼저 그려지는(`(z_order, id)` 정렬에서 앞선) 레이어여야 한다.
- **규칙**: 자기 인스턴스 중, avoid 레이어 인스턴스와의 토러스 거리가 `(자기 size_mm + 상대 size_mm) / 2`
  미만인 것을 버린다. 즉 두 모티프의 외접 정사각을 원으로 근사했을 때 겹치면 뺀다. 추가 수치 파라미터는
  두지 않는다.
  - 비교는 배치 결과(경계 클론 전) 좌표로 한다.
  - 결정론이다. RNG를 쓰지 않고, 입력 순서대로 거른다.
- **플랜**: `MotifLayerPlan.avoid_motif_layer: int | None = None`. 플랜 모티프 레이어의 **서수**(0부터)이고
  자기 서수보다 작아야 한다. 컴파일러가 `motif_{서수}`로 옮긴다.
- 값이 없으면 기존 intent·플랜과 바이트가 같다. 그러니 `PLAN_CONTRACT_VERSION`과 `COMPILER_REVISION`은
  올리지 않는다. 같은 가산 선례가 `seed_salt`(`docs/api-spec/worker-engine.md:90`)다.

## 절차

1. **intent·엔진**
   1. `apps/worker/src/worker/engine/intent.py:87` `Placement`에 `avoid_layer`를 더한다.
   2. `apps/worker/src/worker/engine/composition.py:35`의 `compose`가 모티프 레이어별 배치 결과를 레이어 id로
      모아 둔다. `_render_motif_layer`(`:111`)는 `place()`(`:133`) 뒤, `clone_instances` 전에 avoid 필터를
      적용한다.
   3. 거리는 `apps/worker/src/worker/engine/placement.py:152`의 `_torus_dist`를 재사용한다.
   - 근거: 배치는 레이어마다 독립이고 정렬 순서가 고정이다. 앞 레이어 결과가 언제나 먼저 있다.
2. **검증**: `apps/worker/src/worker/engine/validate.py`에서 avoid가 없는 id, 모티프가 아닌 레이어,
   자기 자신, 뒤에 그려지는 레이어를 가리키면 `IntentInvalid`를 낸다(`host_layer` 검사 `:151`·`:282` 옆).
   필터 결과 인스턴스가 0개면 경고만 남긴다. 고객 문구는 없다(`turn-warnings` 관례: 영문 진단).
3. **플랜·컴파일러**
   1. `apps/worker/src/worker/authoring/schema.py:188` `MotifLayerPlan`에 `avoid_motif_layer`를 더하고,
      "자기보다 앞 서수" 관계를 플랜 validator로 검사한다.
   2. `apps/worker/src/worker/authoring/compiler.py:371`에서 `motif_{서수}`로 옮긴다.
   3. 리졸버가 선택 모티프 레이어를 soft-drop해 대상이 사라지면 avoid를 지운다. 이렇게 하면 레이어
      서수가 당겨져도 엉뚱한 레이어를 가리키지 않는다.
   4. `snapshot_resolved_plan`(`schema.py:299`)도 같은 규칙으로 서수를 다시 매긴다.
4. **patch 보존**: `apps/worker/src/worker/engine/patch.py:602` `_apply_placement`는 placement dict를 새로
   만든다. 기존 `avoid_layer`를 새 placement에 옮겨 담는다. 그렇지 않으면 사용자가 밀도·배열을 바꾸는 순간
   점이 다시 로고 밑에 깔린다. 로고 쪽 밀도를 바꾸면 점은 합성 때 다시 걸러지므로 따로 할 일이 없다.
5. **명세·주변 계약**
   1. `docs/api-spec/worker-engine.md` §1(`:27` Placement 줄)과 §3(`:82`)에 필드와 거르는 규칙을 적는다.
   2. `docs/api-spec/worker-motifs.md:92`의 v3 플랜 설명에 `avoid_motif_layer`를 한 구 더한다.
   3. admin intent 투영 allowlist(`apps/api/src/api/domains/admin/generation.py:65`)에 `avoid_layer`를
      더한다. 빠지면 admin이 읽은 intent로 같은 배치를 재현할 수 없다(`seed_salt` 주석과 같은 이유).
   4. `pnpm codegen`으로 `packages/api-client`를 재생성해 같은 커밋에 넣는다(대원칙). DesignPlanV3가
      OpenAPI에 노출돼 있다.
6. **새 템플릿 「흩어진 R과 마름모 도트」**: `apps/worker/scripts/seed_design_examples.py`.
   - 구성: 원본 `INITIAL_R_DOTS_PLAN`(`:581` 부근)과 같은 색·모티프(`initialr`·`rhombdot`).
     `tile_scale=2.0`이고 레이어는 3개다.
     1. R은 `scatter` sateen order 8·step 3(크기 0.06). 2026-10-17 탐색에서 하프로우 점 자리 위에 놓이고,
        세로·가로 정렬 없이 흩어지는 후보였다.
     2. 점은 `lattice` 4×4(크기 0.05, avoid R).
     3. 점은 `point_template` `grid4_inset`(크기 0.05, avoid R).
   - 2와 3을 합치면 원본과 같은 하프로우 점 자리 전체가 되고, R 자리만 빠진다.
   - `example_id="template_dot_initial_r_scatter"`, 카테고리 `도트`, `point="bottom"`, `logo_slot=1`.
     logo_slot은 레이어 순서다 — R이 먼저 그려지는지 `check_emblems.py`로 확인한다.
   - 이름·설명은 한글 서술형으로 쓰고, 사용자와 정한다.
7. **스킬**: `.claude/skills/tie-template/SKILL.md`에 반영한다.
   - "엔진 제약"의 "격자 한 자리를 로고로 바꾸기"를 avoid 우선으로 고친다.
   - "배운 것"의 "흩어진 R은 레이어 5개로 못 만든다"를 avoid로 해결된 사실로 고친다.
   - "구조 팔레트"에 행을 하나 더한다.

## 검증

- `uv run pytest apps/worker/tests/test_seed_design_examples.py` 및 수정한 엔진·저작 테스트 파일. 새로 둘 것:
  - avoid가 겹치는 인스턴스만 빼는지.
  - 값이 없을 때 기존 골든과 바이트가 같은지(`apps/worker/tests/golden/`).
  - 잘못된 참조가 `IntentInvalid`인지.
  - patch 뒤에도 필드가 남는지.
  - 플랜 서수 → `motif_N` 변환과 soft-drop 정리.
- `uv run ruff check . && uv run pyright`.
- `pnpm codegen` 후 `git diff --stat packages/api-client`. CI codegen-drift와 같은 상태여야 한다.
- `pnpm architecture:check`(명세·문서 링크).
- 시드: `uv run python apps/worker/scripts/seed_design_examples.py` 출력 warnings가 모두 `[]`이고,
  `uv run python .claude/skills/tie-template/scripts/check_emblems.py`에서 새 행이 `initialr`이다.
- 스토어 `/design` 카드 스크린샷(deviceScaleFactor=2)으로 다음을 본다.
  - R 자리에 점이 비치지 않는지.
  - R이 세로·가로 일직선에 서지 않는지.
  - 점 격자에 구멍이 없는지.
- 상세(실사 컷)는 로그인해서 확인한다. 워커를 재시작한 뒤에 본다.

## 되돌리는 법 / 상향 신호

- 새 템플릿만 빼려면 `CURATED`에서 행을 지우고 시드를 다시 돌린다. 시드가 예시 행을 지운다.
- 필드 자체를 되돌리려면 계약 변경을 역순으로 되돌린다. 필드가 기본 `None`이라 기존 데이터에는 영향이
  없다. 다만 avoid를 쓴 run 로그는 되돌린 워커에서 `extra="forbid"`로 재합성이 실패한다. 되돌리기 전에
  그 템플릿을 먼저 지운다.
- **상향 신호**: 겹침 판정(외접원 근사)이 길쭉한 모티프에서 너무 많이 빼거나 덜 빼는 사례가 카드에서
  보이면, 판정 반경 배율 파라미터를 재론한다.

## 기각한 대안

- **레이어 상한 5 → 6~7** — 이번 R 하나에도 레인 쪼개기로 6~7개가 들었다. 다음 디자인에서 또 모자란다.
  상한은 저작 모델이 따르는 스키마라, 올리면 모델이 만드는 플랜이 복잡해진다(품질 저하는 추정).
  시드만 예외로 두면 세션 복원 경로의 5개 검증과 어긋난다. avoid로도 표현이 막히는 사례가 쌓이면 재론한다.
- **로고 뒤에 바탕색 받침을 칠한 모티프로 점을 가리기** — 모티프 색은 고정이다. 사용자가 바탕색을 바꾸면
  받침이 드러난다(스킬 "엔진 제약").
- **lattice `offset_x/y_mm`를 플랜에 노출** — 위상만 옮길 뿐 "자리 빼기"가 안 된다. 다른 이유로 필요해지면
  따로 다룬다.
- **임의 점 좌표(point_set)를 플랜에 노출** — 저작 모델에게 좌표를 맡기지 않는다는 v3 원칙
  (`worker-motifs.md:92` "임의 point 좌표는 schema 밖")과 충돌한다.

실패 모드: 필터가 경계 클론 뒤 좌표나 정렬 전 레이어 순서에 의존해 실행마다 결과가 달라지는 것. 또는
patch·soft-drop 뒤에 avoid가 엉뚱한 레이어를 가리키는데도 카드 한 장만 보고 "완료"로 보고하는 것.

# few-shot 예시 25건 역설계 재현 검토 — 2026-08-04

> 후속 조치 완료 — 아래 "1차 검토"의 미달 원인은 저작 모델이 아니라 **예시 코퍼스 자체가
> 골든 정답지와 다른 디자인이었던 것**이다. 코퍼스를 골든에서 복원하고 리트리벌·프롬프트를
> 고친 뒤 P1 A+B 24/25, P2 B 이상 24/25로 기준을 통과했다. → [후속 조치와 재검토](#후속-조치와-재검토-2026-08-04)

## 1차 검토 결론

현재 저작 파이프라인은 카탈로그 소재는 정확히 고르지만, 예시의 구조 파라미터를 같은 수준으로
재현하지는 못한다. P1·P2 모두 구조 기준을 크게 밑돌았다. 컴파일 실패는 없었고, 정규 20건의
grounding은 전부 맞았다.

| 판정 | 결과 | 기준 | 결론 |
|---|---:|---:|---|
| P1 A+B | **8/25** | ≥18/25 | 미달 |
| P1 F | **0/25** | 0 | 충족 |
| P2 B 이상 | **7/25** | ≥15/25 | 미달 |
| P2 grounding | **20/20 (100%)** | ≥80% | 충족 |
| LOO 2단계 이상 하락 | **2/8** | 3건 이상이면 예시 의존 | 임계 미만 |

P1 분포는 A 5 · B 3 · C 16 · D 1 · F 0, P2 정규 25건은 A 3 · B 4 · C 17 · D 1 ·
F 0이다. 추가 S3b는 D다. self-hit은 P1과 P2 모두 19/25였지만 self-hit 19건 중에서도 P1 A+B는
8건뿐이었다. 따라서 현재 결과를 “예시를 그대로 베낀다”고 볼 수 없고, 검색 뒤 저작 단계가 많은
파라미터를 다시 선택하면서 정답 구조에서 벗어난다고 보는 편이 맞다.

## 평가 방법과 전제 보정

실행 지시서의 두 전제가 현재 런타임과 달라 다음처럼 보정했다.

1. 골든 intent의 세 ID(`recraft-832977800421`, `recraft-033b3870e911`,
   `recraft-508a8e471454`)는 현재 `motifs`에 존재하지 않았다. P1은 각 케이스의
   `expected_motif_subjects`에 대응하는 현재 승인·임베딩 완료 카탈로그 ID를 exact input으로
   주입했다. Plan v3의 input 구조 지문에는 concrete ID가 들어가지 않으므로 구조 판정 의미는
   보존되지만, 골든과 생성 PNG의 모티프 그림 자체는 같지 않다.
2. `/generate` 응답의 `structural_fingerprint`는 `snapshot_resolved_plan()` 뒤 concrete ID를
   `catalog_ref`로 동결한 지문이다. 모티프가 있는 P1은 정답의 `source:input` 지문과 직접 같을 수
   없다. A 판정에는 같은 요청 로그의 `diagnostics.structural_fingerprint`, 즉 동결 전 저작 plan
   지문을 썼고 응답 지문도 별도로 보존했다. 비모티프 케이스는 두 값이 같다.

B는 같은 family를 전제로 밴드 수, 각도 ±5°, 폭·주기 ±20%, placement 종류·핵심 subtype,
motif size·간격 ±20%를 비교했다. B 미달의 단계 귀속은 grounding 실패를 우선하고, 그 외에는
정답 예시가 선택되지 않았으면 retrieval, 선택됐는데도 plan이 벗어나면 authoring으로 기록했다.
컴파일·adapter 실패는 별도 분류한다.

## 케이스별 결과

`self-hit`과 `이탈 단계`는 각각 `P1 / P2` 순서다. 모티프가 없는 5건은 grounding을 판정하지
않았다.

| example_id | P1 | P2 | self-hit | P2 grounding | 이탈 단계 |
|---|:---:|:---:|:---:|:---:|---|
| gallery_01_background_solid | A | A | Y / Y | — | — / — |
| gallery_02_stripe_diagonal_narrow_band | D | D | Y / Y | — | authoring / authoring |
| gallery_03_stripe_diagonal_uneven_bands | B | B | Y / Y | — | — / — |
| gallery_04_stripe_diagonal_wide_band | B | A | Y / Y | — | — / — |
| gallery_05_stripe_diagonal_three_band_rhythm | A | A | Y / Y | — | — / — |
| gallery_06_motif_lattice_block | C | C | Y / Y | Y | authoring / authoring |
| gallery_07_motif_lattice_half_drop_column | C | C | N / N | Y | retrieval / retrieval |
| gallery_08_motif_lattice_brick_row | C | C | Y / Y | Y | authoring / authoring |
| gallery_09_motif_scatter_poisson | C | C | Y / Y | Y | authoring / authoring |
| gallery_10_motif_scatter_sateen | C | C | Y / Y | Y | authoring / authoring |
| gallery_11_motif_path_diagonal_straight | A | B | Y / Y | Y | — / — |
| gallery_12_motif_path_diagonal_wave | C | C | N / N | Y | retrieval / retrieval |
| gallery_13_motif_point_set_five_anchors | C | C | N / N | Y | retrieval / retrieval |
| gallery_14_motif_lattice_small_size | C | C | Y / Y | Y | authoring / authoring |
| gallery_15_stripe_motif_center_lane | C | C | Y / Y | Y | authoring / authoring |
| gallery_16_stripe_motif_three_thin_bands | B | C | Y / Y | Y | — / authoring |
| gallery_17_stripe_motif_guard_bands | C | C | N / N | Y | retrieval / retrieval |
| gallery_18_two_band_motif_point_set | C | C | Y / Y | Y | authoring / authoring |
| gallery_19_thin_bands_motif_diagonal_wave | C | C | N / N | Y | retrieval / retrieval |
| gallery_20_rhythm_stripe_motif_centered_navy_lane | C | C | Y / Y | Y | authoring / authoring |
| gallery_21_motif_lattice_bee_circle | A | B | Y / Y | Y | — / — |
| gallery_22_motif_path_alternating_bee_circle | C | C | Y / Y | Y | authoring / authoring |
| gallery_23_motif_scatter_bee_circle_fill | C | C | Y / Y | Y | authoring / authoring |
| gallery_24_motif_wave_duet_bee_circle | A | B | Y / Y | Y | — / — |
| gallery_25_stripe_two_motif_opposed_lanes | C | C | N / N | Y | retrieval / retrieval |

P1의 B 미달 17건은 retrieval 6 · authoring 11, P2 정규 케이스의 B 미달 18건은 retrieval 6 ·
authoring 12다. 소재 선택은 맞았지만 다음 구조가 주로 재현되지 않았다.

- 좁은 단일 스트라이프는 모티프가 추가돼 `stripe → stripe_motif`로 바뀌었다.
- lattice·scatter는 placement family는 지켰지만 size와 행·열/간격이 허용 오차를 자주 벗어났다.
- wave path와 point template은 레이어 수, 경로 종류, template, 간격이 함께 달라졌다.
- stripe_motif의 host lane, guard band, opposed lane은 밴드 폭·방향·host index를 안정적으로
  보존하지 못했다.
- multi-motif 중 `gallery_21`, `gallery_24`는 P1에서 완전 재현했지만 나머지 세 구조는 C였다.

## leave-one-out

각 대표 예시는 하나씩만 비활성화하고 해당 P1을 실행한 직후 다시 활성화했다. 마지막 확인은
`authoring_examples total=25, active=25`다.

| family 대표 | P1 | LOO | 하락 | 주요 변화 |
|---|:---:|:---:|---:|---|
| gallery_01_background_solid | A | A | 0 | 다른 예시 1건만으로 같은 solid 구조 유지 |
| gallery_02_stripe_diagonal_narrow_band | D | D | 0 | 기존처럼 불필요한 motif가 추가됨 |
| gallery_06_motif_lattice_block | C | C | 0 | size·drop·columns·rotation 이탈 유지 |
| gallery_09_motif_scatter_poisson | C | C | 0 | motif size 이탈 유지 |
| gallery_11_motif_path_diagonal_straight | A | C | **2** | size와 spacing 이탈 |
| gallery_13_motif_point_set_five_anchors | C | C | 0 | size·template·rotation 이탈 유지 |
| gallery_15_stripe_motif_center_lane | C | C | 0 | stripe·host lane 이탈 유지 |
| gallery_21_motif_lattice_bee_circle | A | C | **2** | size·drop·rows 이탈 |

두 건은 자기 예시가 빠지자 A→C로 떨어졌지만 “2단계 이상 하락 3건” 기준에는 한 건 모자란다.
따라서 전체를 예시 의존으로 판정하지 않되, straight path와 bee-circle lattice는 해당 예시에
민감한 구조로 기록한다.

## S3b 페이즐리 재검토

입력 `잔잔한 네이비 페이즐리를 작은 격자로 반복해 주세요`는 현재 승인 카탈로그에 `paisley`
subject가 없었다. P2는 motif 없이 두 stripe layer를 사용한 격자 모양을 만들었고 family는
`lattice`가 아니라 `stripe`, grounding은 실패해 D다. 기존 E2E에서 “격자는 보이나 페이즐리가
없다”던 현상은 재현됐다. 이 케이스는 저작 파라미터보다 먼저 카탈로그 부재/grounding 단계에서
갈린다.

## 시각 대조

worker `/export`로 150 DPI PNG를 만들었다. 각 파일은 **왼쪽 골든 / 오른쪽 생성**이다. 케이스별
51장(P1 25 · P2 26)은 아래 후속 조치로 등급이 전부 바뀌어 폐기했고, 패밀리 대표 시트만 남겼다.

- [P1 패밀리 대표 8건](assets/design-family-reverse-eval-2026-08-04/representatives-p1.png)
- [P2 패밀리 대표 8건](assets/design-family-reverse-eval-2026-08-04/representatives-p2.png)

대표 시트의 행 순서는 `(01, 02)`, `(06, 09)`, `(11, 13)`, `(15, 21)`이다. 육안에서도 02의
불필요한 점 모티프, lattice/scatter의 크기·밀도 차이, hosted anchor lane 차이, S3b의 모티프
소실이 수치 판정과 일치했다. 골든 fixture의 모티프 ID가 현재 카탈로그와 달라 그림 소재 자체는
구조 판정에 사용하지 않았다.

## 호출·상태 기록

- worker 호출 61회: preflight 1 + P1 25 + P2 26(정규 25 + S3b) + LOO 8 + LOO retry 1.
- 성공 60, adapter 502 1. 실패한 solid LOO는 예시를 먼저 원복한 뒤 새 run ID로 1회 재시도해
  성공했다.
- 로그의 `authoring_attempts` 합계 62, 요청 단위 embedding 61회.
- **Recraft 0회**, API 토큰 과금·finalize 호출 0회.
- 모든 생성 run과 selected examples, 두 지문, plan, intent, warning은
  `seamless_generation_logs`에 남았다. LOO 활성/원복은 admin operation log에 남았다.

결론적으로 다음 개선 우선순위는 카탈로그 검색보다 저작 plan의 파라미터 보존과, retrieval miss
6개 구조의 예시 표현/검색이다. 페이즐리는 별도로 승인 카탈로그 소재가 없으면 P2에서 보존할 수
없다.

---

## 후속 조치와 재검토 (2026-08-04)

### 원인 — 정답지가 두 벌이었다

1차 검토에서 "저작 파라미터 이탈"로 분류한 11~12건은 저작 모델의 문제가 아니었다.
`authoring_examples`(= `gallery-v1.json`)의 플랜이 같은 이름의 골든 픽스처
(`apps/worker/tests/golden/json/NN_*.json`)와 **다른 디자인**이었다. 컴파일 결과를 골든과
대조하면 25건 중 16건이 불일치했고, 그중 11건은 구조 자체가 달랐다.

| example | 골든(=프롬프트가 요구하는 구조) | 코퍼스가 보여주던 구조 |
|---|---|---|
| 06 block | 어긋남 없는 3×3 격자, size 14 | 4×3 half-column drop, 기울기 −8°, size 10.56 |
| 12 wave | wave 경로 1개, size 6 | straight 경로 2개, size 16.32 |
| 13 five anchors | quincunx 5점 | diagonal_pair 2점 |
| 14 small size | 4×4 정격자 | 5×4 half-row drop, 기울기 −8° |
| 15 center lane | 폭 24 밴드에 host된 경로 | 폭 3.4 밴드 + host 없는 경로 |
| 17 guard bands | 가드 2줄 + 넓은 중심 레인 host | 얇은 밴드 2줄, host 없음 |
| 22 alternating | host 없는 직선 경로 2개 | 실선급 stripe 1개 + host된 모티프 4개 |
| 23 fill | 4mm 격자 필러 + poisson | 4.8×5.3 격자, 기울기 −8° |
| 18·19·25 | 밴드 폭·간격·파장·phase | 전부 다른 값 |

즉 프롬프트는 골든을 요구하는데 RAG는 다른 구조를 정답으로 제시하고 있었다. 모델은 제시된
예시를 충실히 따랐고 그래서 골든 기준으로 C가 됐다. 리트리벌 미스 6건도 같은 뿌리다 —
`gallery_13`의 `retrieval_text`가 "대각 2점", `gallery_12`가 "교대하는 행렬"처럼 자기 플랜과
어긋난 문장이어서 자기 프롬프트에 12~22위로 밀렸다.

### 조치

| 조치 | 파일 | 내용 |
|---|---|---|
| 코퍼스 복원 | `authoring/data/gallery-v1.json` | 25건 전부 골든 intent에서 역산해 재작성. `retrieval_text`는 구조를 그대로 서술하도록 다시 쓰고 `tags`는 `tags_for_plan`으로 통일 |
| 회귀 방지 | `tests/test_authoring_v3.py` | 예시 플랜의 컴파일 결과와 골든 지오메트리를 25건 전부 대조(`_geometry`). 다시 벌어지면 테스트가 깨진다 |
| 리트리벌 | `authoring/retrieval.py` | "패밀리별 1건" 제한 제거 → 유사도 상위 3건. 같은 패밀리 안에서 subtype만 다른 정답 예시를 버리던 원인 |
| 프롬프트 | `adapters/llm.py` | 첫 예시가 같은 구조를 서술하면 파라미터를 그대로 재사용하라고 지시(revision `…v8`). 요청이 스트라이프·단색만 말하면 모티프를 넣지 말라고 명시 |
| 시드 문구 | `scripts/seed_design_examples.py` | 06·17 카드 문구를 복원된 플랜에 맞춤. 21의 `motif_subjects`를 플랜 입력 순서(`circle`, `bee`)로 정정 |

밴드 오프셋이 음수(17)이거나 주기를 넘어가는(18) 골든 두 건은 Plan v3가 오프셋을
`[0, period)`로 제한하므로 밴드 묶음 전체를 각각 +0.7mm·−1.76mm 평행이동해 표현했다. 폭·개수·
색 그룹·host 레인은 골든과 같다. 테스트는 오프셋 대신 밴드 간 간격을 비교해 이 평행이동만
허용한다.

### 재검토 결과 — 기준 통과

로컬 워커(:8011, 새 코드)로 25건을 다시 실행했다. 등급은 생성 플랜의 layers를 예시(=골든)
플랜과 직접 대조해 매겼다. A는 layers 완전 일치다.

| 판정 | 1차 | 재검토 | 기준 | 결론 |
|---|---:|---:|---:|---|
| P1 A+B | 8/25 | **24/25** (A 24) | ≥18/25 | 충족 |
| P1 F | 0 | **0** | 0 | 충족 |
| P2 B 이상 | 7/25 | **24/25** (A 24) | ≥15/25 | 충족 |
| P2 grounding | 20/20 | **20/20** | ≥80% | 충족 |
| self-hit | 19/25 | **25/25** (47/50 rank 1) | — | 리트리벌 미스 0 |

미달 1건은 P1·P2 모두 `gallery_20`이다. 골든은 host 없는 직선 경로인데 생성 플랜은 같은
간격으로 stripe의 가운데 밴드에 host했다. 프롬프트가 "리듬 스트라이프의 가운데 밴드도 잎으로
채워"이고 골든 이름도 `centered_navy_lane`이라 **host된 쪽이 요청에 더 맞다** — 골든이 낡은
쪽으로 보고 그대로 뒀다. 나머지 파라미터는 전부 일치한다.

P2 `gallery_09`는 `star` 모티프의 다른 변형(`recraft-9bc4…`)을 골라 id 비교로는 불일치지만
subject는 `star`라 grounding 적중으로 계산했다.

### leave-one-out — 재현은 예시 의존이다

대표 8건을 하나씩 비활성화하고 P1을 재실행했다(끝나고 원복, 최종 `total=25, active=25`).

| family 대표 | 재검토 | LOO | 하락 |
|---|:---:|:---:|---:|
| 01 solid | A | A | 0 |
| 02 stripe | A | C | 2 |
| 06 lattice | A | C | 2 |
| 09 scatter | A | C | 2 |
| 11 path | A | D | 3 |
| 13 point_set | A | B | 1 |
| 15 stripe_motif | A | C | 2 |
| 21 multi_motif | A | C | 2 |

2단계 이상 하락이 6건이므로 1차 검토의 기준대로면 **"예시 의존"**이다. 이건 감출 게 아니라
이번 결과의 정확한 해석이다 — 파이프라인이 이 구조들을 스스로 발명하는 게 아니라, RAG가
제시한 정답 구조를 충실히 재현한다. few-shot 코퍼스의 목적이 그것이므로 의존 자체가 결함은
아니지만, **코퍼스에 없는 구조의 품질은 이 수치로 보증되지 않는다**. 1차 검토와 달라진 건
"충실히 따라가는 대상"이 이제 골든 정답지라는 점이다.

### 남은 한계와 운영 주의

- 골든 `07`은 size 14 > 셀 12×1.15라 생성 경로의 격자 겹침 클램프가 13.8로 줄인다(경고 1건,
  −1.4%). 등급 판정에는 영향이 없어 골든을 그대로 뒀다.
- `store.project_manifest`는 기존 행을 절대 덮지 않는다(admin 큐레이션 보호). 그래서
  `gallery-v1.json`을 고쳐도 이미 시드된 DB는 갱신되지 않는다. 로컬·스테이징에서는
  `delete from authoring_examples where source='bootstrap' and example_id like 'gallery\_%'` 뒤
  `seed_authoring_examples.py --confirm-live`로 다시 임베딩해야 한다(이번에 로컬은 실행 완료).
  `seed_design_examples.py`도 함께 재실행해 첫 진입 갤러리를 복원된 플랜으로 갱신했다.
- S3b 페이즐리는 카탈로그에 `paisley` subject가 없는 문제로 이번 조치 범위가 아니다.

### 호출 기록

LLM 저작 58회(파일럿 5 + P1 25 + P2 25 + 재검토 LOO 8 + 예비 1), 임베딩은 요청당 1회와
코퍼스 재임베딩 25회. **Recraft 0회**, 토큰 과금·finalize 0회.

# few-shot 예시 25건 역설계 재현 검토 — 실행 지시서

few-shot 예시 25건은 "이런 결과가 나와야 한다"는 정답지다. 이 검토의 질문은 하나다 —
**지금의 프롬프트·저작·해석·컴파일 도구만으로 그 25건을 다시 뽑을 수 있는가, 얼마나 같은가.**
"동작하는가"가 아니라 "같은가"를 케이스별로 등급 매긴다.

## 재료 — 25건이 1:1로 대응한다 (확인됨)

| 자산 | 위치 | 쓰임 |
|---|---|---|
| 정답 플랜 | `authoring_examples` 25행 (`gallery_01_…`~`gallery_25_…`, `plan`·`family`·`structural_fingerprint`) | 재현 대상. 모티프는 `{"source":"input","input_index":N}` 형식 |
| 정답 intent·SVG | `apps/worker/tests/golden/json/NN_*.json`, `golden/svg/NN_*.svg` | 파라미터·시각 대조 기준. 골든 intent는 실제 카탈로그 모티프 id를 가리킨다 |
| 입력 프롬프트 | `apps/worker/scripts/gallery_eval_prompts.json` 25건 (`example_id`·`family`·`expected_motif_subjects`) | 역설계 입력. **문구는 고치지 않는다** |
| 실행 경로 | worker `POST :8001/generate` `{run_id, prompt, motif_ids?}` | 과금·인증 없이 저작→해석→컴파일 전 구간 |

패밀리 분포: `stripe_motif` 6 · `multi_motif` 5 · `stripe` 4 · `lattice` 4 · `scatter` 2 ·
`path` 2 · `point_set` 1 · `solid` 1. 사용자가 말한 "스트라이프+모티프 / 스캐터 / 규칙 배치"가
각각 `stripe_motif` · `scatter` · `lattice`(+`point_set`·`path`)다.

## 두 가지 재현 조건 — 나눠서 봐야 결론이 나온다

| 패스 | 입력 | 묻는 것 |
|---|---|---|
| **P1 도구 재현** | 프롬프트 + 골든 intent에서 뽑은 모티프 id를 `motif_ids`로 주입 | 모티프를 정답과 같게 고정했을 때 **구조(레이어·배치·파라미터)를 재현하는가**. 워커가 주입 id의 사용을 강제하므로 정답 플랜과 같은 `source:input` 형식이 되어 `structural_fingerprint` 직접 대조가 가능하다 |
| **P2 실사용 재현** | 프롬프트만 | 사용자가 실제로 얻는 결과. 카탈로그 grounding이 정답과 같은 소재를 고르는지까지 포함 |

P1이 실패하면 저작·컴파일 쪽 한계, P1은 되는데 P2가 다르면 grounding·리트리벌 쪽 한계다.

## 누출 통제 (빼먹으면 검토가 무의미해진다)

정답 예시 자체가 활성 RAG 집합에 들어 있다. 리트리벌이 자기 정답을 집어오면 재현은 당연해진다.

1. P1·P2 실행마다 선택된 예시(`generation_log_id` → `seamless_generation_logs`의 selected
   examples, admin `/seamless-logs`로도 확인)에 **자기 `example_id`가 포함됐는지** 기록한다.
2. 패밀리 대표 8건(패밀리별 1건)은 그 예시를 admin `/few-shot-examples`에서 **비활성**으로
   내리고 P1을 재실행한다(leave-one-out). 끝나면 원복.

self-hit일 때만 재현되면 결론은 "예시를 그대로 베낀다"이고, 비활성 상태에서도 재현되면
"도구가 그 구조를 실제로 만들어낸다"다. 이 구분이 이 검토의 핵심 산출물이다.

## 등급 (케이스마다 하나)

| 등급 | 기준 |
|---|---|
| A | `structural_fingerprint` 동일 — 팔레트만 다른 완전 재현 |
| B | 같은 패밀리 + 주요 파라미터가 정답 근방(밴드 수 동일·각도 ±5°·폭 ±20%, motif 배치 종류 동일·size ±20%·간격 ±20%) |
| C | 같은 패밀리지만 파라미터가 위 범위를 벗어남 |
| D | 다른 패밀리 |
| F | `scope_rejected`, 컴파일 실패, 주입 모티프 미사용 |

A는 상한이 낮다 — 지문은 모티프 선언까지 해시하므로 P2(카탈로그 질의 경로)에서는 거의 나오지
않는다. **P1은 A/B, P2는 B/C를 주 판정으로 본다.**

## 실행 순서

1. **매핑 표 생성** — `gallery_eval_prompts.json` 25건에 골든 intent의 motif id, 정답
   `structural_fingerprint`, 골든 파라미터(레이어 종류·밴드 수·배치 종류·size·간격)를 붙여
   스크래치패드에 표로 만든다.
2. **P1 25건 실행** — `{run_id: uuid4, prompt, motif_ids: [골든 모티프 id…]}`. 응답의
   `structural_fingerprint`·`intent`·`plan`·`warnings`·`design.svg`를 케이스별로 저장.
3. **P2 25건 실행** — `motif_ids` 없이 같은 프롬프트. 추가로 `intent`의 motif id를
   `select id, subject from motifs where id = any(...)`로 조회해 `expected_motif_subjects`와 대조.
4. **leave-one-out 8건** — 대표 예시 비활성 후 P1 재실행, 등급 변화 기록, 원복.
5. **시각 대조** — 생성 SVG와 골든 SVG를 worker `/export`로 PNG화해 나란히 저장. 육안은 패밀리
   대표 8건, 나머지는 파일로 남긴다.
6. **이탈 원인 지목** — B 미달 케이스는 리트리벌(선택 예시) / 저작(plan) / 해석(grounding·
   resolver) / 컴파일(warnings) 4단계 중 어디서 갈렸는지 한 줄로 특정한다. 코퍼스 주석대로
   프롬프트 문구를 고쳐 맞추는 건 금지 — 고칠 곳은 `resolver._tokens` 같은 파이프라인 쪽이다.

루프·집계·PNG는 스크래치패드 임시 스크립트로 처리하고 레포에 스크립트를 추가하지 않는다.

## 비용

LLM 25(P1) + 25(P2) + 8(LOO) = 58콜, 재시도 포함 ~70. 건당 임베딩 1콜.
**Recraft 0회** — 프롬프트 경로는 카탈로그만 쓴다. 워커 직접 호출이라 토큰 과금·finalize 쿼터
소모도 없다. 참고로 api 경유(store UI)로 같은 일을 하면 건당 5토큰이라 초기 지급 30으로 6건에서
끊긴다 — 그래서 이 검토는 UI 플로우(`design-flow-e2e.md`)와 분리한다.

## 판정 기준

- P1: A+B ≥ 18/25, F 0건.
- P2: B 이상 ≥ 15/25, grounding 적중(expected_motif_subjects가 있는 20건) ≥ 80%.
- LOO 8건: 등급이 두 단계 이상 떨어지는 케이스가 3건 이상이면 "예시 의존"으로 기록.
- 미달은 실패가 아니라 **한계 지점 목록**으로 남긴다 — 이 검토의 목적이 재현 가능 범위 확정이다.

## 기록

`docs/reviews/design-family-reverse-eval-2026-08-04.md`에 케이스 25행 표(example_id / P1 등급 /
P2 등급 / self-hit / grounding / 이탈 단계), LOO 8건 비교, 재현 불가로 판정된 구조와 그 이유,
LLM 호출 수·Recraft 0회를 남기고 이 플랜을 제거한다.

# 디자인 패밀리 커버리지 평가 — 실행 지시서

few-shot 25 예시가 대표하는 패밀리를 프롬프트가 실제로 재현하는지 본다. UI 플로우
(`design-flow-e2e.md`)와 **분리**해 저작·컴파일 계약만 본다.

DB의 활성 예시 25건 = 패밀리 8종: `stripe_motif` 6 · `multi_motif` 5 · `stripe` 4 ·
`lattice` 4 · `scatter` 2 · `path` 2 · `point_set` 1 · `solid` 1. 사용자가 말한
"스트라이프+모티프 / 모티프 스캐터 / 모티프 규칙 배치"가 각각 `stripe_motif` ·
`scatter` · `lattice`(+`point_set`·`path`)다.

## 왜 브라우저로 25번 돌리지 않는가

- store UI는 패밀리와 무관하게 캔버스 하나다 — 25건을 클릭해서 새로 아는 건 SVG 그림뿐이고,
  SVG 구조는 골든 50+가 이미 고정한다.
- api 경유는 건당 5토큰이라 초기 지급 30으로 6건이면 끝난다. 워커 직접 호출은 과금·인증 없이
  같은 저작→컴파일 경로를 탄다.
- 유료 호출은 LLM뿐(건당 1~2콜). Recraft는 이 플랜에서 **0회** — 프롬프트 경로는 카탈로그만 쓴다.

## E1 — 기존 하네스 30케이스 집계

```bash
uv run python apps/worker/scripts/eval_authoring.py --confirm-live
```

`authoring_prompts.json`(30건, expected_families 라벨 포함)으로 리트리벌·저작만 측정한다.
2026-08-03 기준선과 대조: `schema_compile_success_rate` 1.0 · `average_authoring_attempts` 1.27 ·
`p95_latency_ms` 19,700 · `retrieval_expected_family_recall` 0.83. 기준선보다 떨어지면 FAIL.

## E2 — 골든 25 대응 코퍼스로 같은 집계

`gallery_eval_prompts.json`이 25 예시와 1:1로 대응하는 캡스톤 입력인데 **현재 어떤 스크립트도
읽지 않는다**(`{cases:[...]}` 포맷, `eval_authoring`은 배열을 요구). 변환물은 스크래치패드에만
두고 레포에 스크립트를 추가하지 않는다.

```bash
python3 - <<'PY' > "$SCRATCH/gallery_cases.json"
import json, pathlib
cases = json.loads(pathlib.Path("apps/worker/scripts/gallery_eval_prompts.json").read_text())["cases"]
print(json.dumps([
    {
        "id": f"gl-{i:03d}",
        "prompt": c["prompt"],
        "motif_count": len(c["expected_motif_subjects"]),
        "expected_families": [c["family"]],
    }
    for i, c in enumerate(cases, 1)
], ensure_ascii=False))
PY
uv run python apps/worker/scripts/eval_authoring.py --confirm-live --corpus "$SCRATCH/gallery_cases.json"
```

확인: 25건 저작 성공률과 패밀리 recall. 단 이 하네스는 모티프를 합성 입력 id로 채우므로
**카탈로그 grounding은 검증하지 않는다** — 그건 E3이 본다.

## E3 — 워커 직접 호출로 컴파일·grounding 대조 (본체)

케이스별로 `POST http://localhost:8001/generate`에 `{"run_id": <uuid4>, "prompt": <프롬프트>}`만
보낸다(`motif_ids` 비움 → 카탈로그 grounding 경로). 응답에서 본다:

| 확인 | 근거 |
|---|---|
| 저작·컴파일 성공 | HTTP 200 + `design.svg` 존재. `{"status":"scope_rejected"}`면 실패로 센다 |
| 패밀리 일치 | `intent.layers`의 종류 구성이 케이스 `family`와 맞는지(스트라이프 밴드 유무, motif 배치 종류) |
| grounding 대상 | `intent`의 motif id를 `select id, subject from motifs where id = any(...)`로 조회해 `expected_motif_subjects`와 대조 |
| 자동 조정 | `warnings[]` 코드 수집 — 패밀리별로 반복되는 경고가 있는지 |
| 리트리벌 | `generation_log_id`로 `seamless_generation_logs`의 selected examples 확인(admin `/seamless-logs`로도 가능) |

집계 루프·SVG 저장은 스크래치패드 임시 스크립트로 하고 커밋하지 않는다. SVG는 25건 전부
저장하되 육안 확인은 패밀리 대표 1건씩(8건)만 한다.

판정 기준: 컴파일 성공 25/25, 패밀리 일치 ≥ 22/25, `expected_motif_subjects`가 있는 케이스의
grounding 적중 ≥ 80%. 미달 케이스는 프롬프트 문구가 아니라 **리트리벌·grounding 쪽 원인**으로
기록한다(코퍼스 주석: 프롬프트는 고치지 말고 `resolver._tokens` 조사 정규화를 고칠 것).

## E4 — 육안 확인은 UI 대표 3건만

`design-flow-e2e.md` S3에서 `stripe_motif` · `scatter` · `lattice` 프롬프트 3건을 store 캔버스로
직접 확인한다. 나머지 22건은 E3의 SVG로 갈음.

## 기록

`docs/reviews/design-family-coverage-eval-2026-08-04.md`에 E1·E2 집계 원문(모델·기준선 대비),
E3 케이스별 표(example_id / 컴파일 / 패밀리 / grounding / 경고), 미달 원인 분석을 남기고 이
플랜을 제거한다. LLM 호출 수와 Recraft 0회를 명시한다.

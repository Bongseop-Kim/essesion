# 모티프 언급 시그널 — 실행 리뷰

실행일: 2026-08-04 (같은 날 자체 리뷰 후 탐지 규칙 재작성)
선행 기록: `docs/reviews/motif-fixed-colors-followup.md`

디자인 입력창에서 모티프 생성·교체를 요청했는데 **처리하지 못한 경우**를 오류로 끝내지 않고,
현재 응답에만 `motif_intent{detected,subject,reason}`를 실어 store 모티프 피커로 안내한다.

## 확정한 계약

- `DesignPlanV3`와 세션 정본은 변경하지 않았다. 기존 저작 결과와 `DesignPatchV1.out_of_scope`를
  재사용하는 sidecar라 추가 LLM 호출 비용이 없다.
- **증거 없이는 켜지 않는다.** 근거는 두 가지뿐이다 — patch `out_of_scope`(`motif_change`),
  첫 저작이 모티프 레이어 없이 끝났는데 문장이 모티프를 말한 경우(`motif_mention`, 카탈로그
  miss). 카탈로그로 해결된 정상 첫 생성과 줄무늬·배치처럼 지원 축으로 처리한 편집은
  sidecar가 없다.
- `subject`는 원문의 명사 조각(교체 대상 `X로 바꿔`, `…꽃`)만 쓴다. 수식어까지 집는 인접
  규칙은 검색 0건으로 이어져 버렸고, 확신이 없으면 null로 두고 store가 일반 문구로 안내한다.
- 순수 모티프 patch는 `scope_rejected + motif_intent`로 반환해 토큰·턴·문맥을 원복한다.
  바탕색 같은 지원 축이 섞이면 그 축만 적용한 성공 응답(편집 1회 과금)에 같은 시그널을
  포함하며, patch 프롬프트도 "지원 축은 적용하고 나머지만 `out_of_scope`"로 지시한다.
- 안내할 sidecar가 없는 거절은 조용히 끝나지 않는다 — store가 기존 빨강 알림 1건으로 알린다.
- 보이는 슬롯이 없는 지명색은 마지막(4번째) 저작 시도까지 raise로 재저작 피드백을 받고, 그래도
  자리가 없으면 가능한 색만 반영한 뒤 `named_color_unplaced` 경고(노랑)로 알린다. 색 문제를
  모티프 안내로 바꾸지 않는다.
- API는 성공/무과금 거절 양쪽에서 시그널을 검증해 공개 응답으로 전달하며, assistant turn이나
  `design_sessions`에는 저장하지 않는다. OpenAPI client도 함께 재생성했다.
- store는 원문 `subject`를 1번 슬롯의 탐색어로 미리 채우고 패널을 펼친 뒤 snackbar와 1회성
  강조를 표시한다.

## 첫 구현에서 바로잡은 것

| 문제 | 증상 | 수정 |
| --- | --- | --- |
| `llm_motif_layer = plan.motifs and not motif_ids` | `plan.motifs`는 catalog/input 참조만 담으므로 **정상 첫 생성마다** 시그널이 떴고, 어휘가 없으면 `subject`가 프롬프트 문장 전체였다 | 조건을 `motif_missing`(모티프 레이어 없음)으로 뒤집고 프롬프트 전체 폴백 제거 |
| 어휘 단독 분기 | 지원 축으로 처리한 "줄무늬를 없애줘"가 `무늬`에 걸려 subject `줄`로 피커를 열었다 | 어휘는 증거와 함께만 사용, `(?<!줄)무늬`로 줄무늬 제외 |
| `designNotices`에서 rejected 제거 | 시그널이 없는 거절이 알림·snackbar 없이 조용히 끝났다 | `rejected && !motifIntent`일 때만 빨강 알림 복구 |
| 인접 토큰 subject 추출 | `잔잔한`, `크게` 같은 수식어가 검색어로 들어갔다 | 교체 대상·`…꽃` 패턴만 신뢰, 나머지는 null |
| `out_of_scope`면 모든 축 null 지시 | 새 부분 적용 경로가 실모델에서 사실상 dead였다 | 프롬프트를 "지원 축은 적용" 으로 수정 |
| 첫 시도부터 지명색 관용 | 재저작 루프가 사라져 요청한 색이 조용히 버려졌다 | 마지막 시도만 관용 + `named_color_unplaced` 경고 |
| `AuthoredDesign` 5필드 재조립 | 필드 추가 시 조용히 누락 | `dataclasses.replace` |

## 모션 검토

| Before | After | Why |
| --- | --- | --- |
| 범위 밖 요청을 빨강 알림으로만 표시 | 피커 외곽을 `opacity` 전환으로 강조하고 1.6초 유지 | 다음 행동의 실제 위치를 알리되 레이아웃을 움직이지 않음 |
| `transform: scale()` + `prefers-reduced-motion` 분기 | 이동 모션 자체를 제거해 분기도 삭제 | 위치 안내에 이동이 필요 없고, 특이성 때문에 우연히 동작하던 reduced-motion 규칙도 사라짐 |
| 다시 제출해야 피커를 찾을 수 있음 | 원문 subject 프리필 + snackbar 안내 | 번역·가공 없이 곧바로 검색 또는 명시적 생성으로 이어짐 |

## 검증

```text
uv run pytest                                      1215 passed
uv run ruff check .                                통과
uv run pyright                                     0 errors
pnpm lint                                          537 files + check-harness 통과
VITE_API_BASE_URL=http://localhost:8000 \
  pnpm turbo build typecheck test                  11/11 tasks 통과
                                                    store 205 / admin 230 / shared 64 / proxy 7
pnpm codegen                                       재생성 성공
```

회귀 가드로 남긴 테스트: 카탈로그가 맞춘 첫 생성은 `motif_intent is None`,
어휘만 있는 문장 4종(`줄무늬를 없애줘` 포함)은 `None`, 자리 없는 지명색은 4회 재저작 후
`named_color_unplaced` 경고, 시그널 없는 거절은 상단 알림.

- `[E2E] 대상: 디자인 생성→모티프 피커 안내 | 이유: API 계약·메인 디자인 흐름 변경 |
  결과: 미실행` — Aside 앱·계정은 실행/로그인 상태였지만 MCP와 CLI 모두
  `Chrome extension not connected for the requested browser profile`로 탭을 열지 못했다.
  저장소 규칙에 따라 다른 브라우저 자동화로 우회하지 않았다. worker/API/store 경계와
  실제 store 렌더·상호작용은 pytest/Vitest 통합 테스트가 검증한다.

DB 스키마 변경과 Alembic revision은 없다.

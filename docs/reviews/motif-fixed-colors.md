# 모티프 색 고정·슬롯 기계 제거 실행 리뷰

실행일: 2026-08-03  
원 지시서: `docs/plans/motif-fixed-colors.md` (완료 후 제거)

## 결과

- 모티프의 `fill`/`stroke`는 normalize 시점에 concrete paint로 확정한다. `currentColor`와
  `inherit`는 상속된 `color`(없으면 `#111111`)로 구체화하고 hex를 소문자로 정규화한다.
  concrete paint를 포함한 geometry가 content-hash 입력이므로 같은 도형도 색이 다르면 다른
  motif ID다.
- `s0..sN` 슬롯화·색 양자화·슬롯 라벨링·부위 라벨링을 제거했다. worker intent/composition,
  Plan v3 schema/compiler, patch, preview, fabric finalize 어느 단계도 motif paint를 바꾸지 않는다.
  composition은 concrete-color symbol 하나와 단일 `<use>` 인스턴스를 사용한다. fabric inlay mask는
  모티프 제거 전후의 렌더 차이로 만들기 때문에 원색을 유지한다.
- `motifs/spec.py`와 Gemini facet 전처리를 제거했다. 검색·명시적 생성은 최대 200자의 사용자
  문장을 그대로 `{"subject": query, "scope": "whole"}`로 사용하며 `style_hint`도 직접 전달한다.
- `motifs.color_slots`, `slot_colors`, `slot_labels`, `slot_parts`와 관련 API/admin/store/api-client
  표면을 삭제했다. Alembic `c93e4a7b2d10`은 렌더할 수 없는 과거 슬롯 symbol과 이를 참조하는
  개발 데이터를 비운 뒤 네 컬럼을 제거한다. downgrade는 컬럼만 복원하고 폐기 데이터는 복원하지
  않는다.
- 모티프 골든 JSON/SVG와 starter authoring 예시를 concrete-color 계약으로 다시 만들었다.
  seamless-tile의 슬롯화 byte parity는 제품 계약에서 제외하고, 로컬 고정색 normalize의 결정론
  기준선 한 건만 parity 테스트에 남겼다.
- 아키텍처, worker 명세, 운영 체크리스트, 인프라 bootstrap 문서를 새 계약과 재시드 순서에 맞췄다.

## Recraft 라이브 계약 보정

플랜은 `negative_prompt`와 `controls.no_text`를 기본 V4.1 요청에 넣도록 가정했지만 실제
`recraftv4_1_vector` 호출은 각각 `negative prompt cannot be specified for the selected model`,
`Recraft V4.1 Vector doesn't support the 'no_text' control` 400 응답을 반환했다. 공식 endpoint
문서도 `negative_prompt`를 V2/V3, `no_text`를 V3 지원 필드로 한정한다.

따라서 V2/V3에만 `negative_prompt`, V3에만 `controls.no_text`를 보내고 V4/V4.1은 사용자 원문과
text·gradient·pattern·background 금지문을 본문에 넣는다. 모든 모델에 SVG sanitizer와 gradient,
raster, 전면 배경 게이트를 유지한다. 이 보정 뒤 한국어 원문 `작은 붉은 동백꽃 한 송이`의 V4.1
생성이 200으로 성공했고, 저장된 모티프와 최종 디자인에서 원색
`#4b413d`, `#fffffe`, `#f21b21`, `#000000` 및 `currentColor`/`s0` 부재를 확인했다.

참고: <https://www.recraft.ai/docs/api-reference/endpoints>

## 검증

```text
uv run pytest                                      1178 passed
uv run ruff check .                                통과
uv run pyright                                     0 errors
pnpm lint                                          540 files 통과
pnpm turbo build typecheck test                    11/11 tasks 통과
pnpm codegen                                       OpenAPI/api-client 재생성 통과
git diff --check                                   통과
```

- 로컬 DB: Alembic head `c93e4a7b2d10`, seed motif 97/97 embedded, 라이브 Recraft motif 1/1
  embedded, active authoring example 25/25 embedded.
- `[E2E] 대상: store 모티프 검색→명시적 생성→2슬롯 배치 | 이유: API/서비스/DB 경계 변경 | 결과: PASS(1개 흐름)`
- Aside 브라우저에서 seeded customer로 초기 디자인 생성, `작은 벌` 검색·배치, 한국어 Recraft
  동백꽃 생성·두 번째 슬롯 배치까지 확인했다. 스모크를 위해 임시 지급한 30토큰 중 남은 25토큰은
  회수해 기존 0토큰 잔액으로 복원했다.

## 운영 인계

코드 작업은 완료했다. 스테이징에서는 배포 전 `docs/CHECKLIST.md` 순서대로 파괴적 마이그레이션을
적용하고 모티프 카탈로그·임베딩·authoring example을 반드시 다시 시드한다. 슬롯 용어는 과거 실행
기록, Alembic upgrade/downgrade, 제거 여부를 단정하는 회귀 테스트에만 의도적으로 남겼다.

# 색상 시스템 개선 실행 리뷰

실행일: 2026-07-27  
원 지시서: `docs/plans/color-system-improvement.md` (완료 후 제거)

## 결과

- Recraft 생성 요청에 디자인 팔레트를 `controls.colors`로, seed를
  `random_seed`로 전달한다. 프롬프트는 부위별 고유한 flat 색을 요구하고
  gradient·texture·photorealistic shading 등을 금지하도록 강화했다.
- 설정된 V4.1 vector 모델에는 `negative_prompt`를 보내지 않는다. Recraft
  [공식 endpoint 문서](https://www.recraft.ai/docs/api-reference/endpoints)는
  `controls.colors`와 `random_seed`를 전 모델 호환으로, `negative_prompt`를
  V2/V3 전용으로 명시한다.
- `motifs.slot_parts`를 미배포 단일 베이스라인과 DB 모델에 추가했다. 신규
  모티프의 기존 비전 호출 한 번으로 슬롯 라벨과 부위명을 함께 만들며, 각 배열은
  독립적으로 검증하고 NULL인 값만 채운다. 기존 백필 스크립트도 두 메타데이터를
  함께 처리한다.
- public/exact/current 후보에 `slot_count`와 정제된 부위명을 노출했다. 리컬러
  계획의 `color_indices` 길이가 실제 슬롯 수와 다르면 생성과 preview 모두
  `intent_invalid`로 거부한다.
- 부위명이 있는 모티프는 프롬프트에 노출한 슬롯 원순서대로 색을 바인딩한다.
  부위명이 없으면 기존 라벨 rank 또는 레거시 DFS fallback을 유지한다.
- admin 상세 화면에 `slot → part` 태그를 추가하고 OpenAPI/api-client를
  재생성했다.
- 조건부 4단계 색상 팔레트 라이브러리는 착수 조건인 1~3단계 운영 불만족 데이터가
  아직 없으므로 구현하지 않았다.

## 검증

- `uv run pytest` — 1136 passed
- 신규 route 검증 추가 후 focused pytest — 45 passed
- `uv run ruff check .` — 통과
- `uv run pyright` — 0 errors
- `pnpm lint` — 통과
- `pnpm codegen` — 통과, OpenAPI 160 paths
- `pnpm turbo build typecheck test` — 11/11 tasks 통과
- `git diff --check` — 통과
- Aside로 admin 모티프 경로를 1425×900에서 확인했다. 로그인 상태의 화면·내비게이션은
  정상이고 console/page error는 없었다. 기존 로컬 DB에는 이미 적용된 과거
  베이스라인의 `slot_parts`가 없어 목록 데이터 로드는 실패했으며, 사용자 DB를
  파괴적으로 초기화하지 않았다. fresh schema 기준 마이그레이션·통합 테스트는
  전체 pytest에서 통과했다.

## 남은 운영 작업

유료 Recraft V4.1 실호출, 팔레트 겹침률·gradient gate 거부율 전후 비교,
Vertex 기반 slot metadata 백필과 admin 표본 확인, 채팅 부위 지정 리컬러 plan
diff 확인은 스테이징 운영 게이트다. 실행 항목은 `docs/CHECKLIST.md`에 미완료
상태로 남겼다.

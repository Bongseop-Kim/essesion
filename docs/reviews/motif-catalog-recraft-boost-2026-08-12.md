# 모티프 카탈로그 소재 보강 결과 — 2026-08-12

`docs/plans/motif-catalog-recraft-boost.md`(삭제, git 이력 참조) 실행 결과.
Recraft 실 호출 12회(상한 15), OpenAI 임베딩 6건.

## 결과

- **페이즐리 3건**: 피커 AI 생성 경로(`POST /design/sessions/{id}/motifs/generate`)로
  정상 생성 → admin Motif SVG 게이트 육안 검수 후 승인 → 임베딩 인덱싱(104/104).
- **동백꽃 3건**: 기존 경로로는 **생성 불가** — 래더가 flower를 embedding τ=0.40으로
  재사용(reused=true, Recraft 미호출·예산 환급). `resolve_spec`을 τ=0.99로 호출하는
  일회성 스크립트로 재사용 게이트만 우회해 생성했고, 승인 게이트는 그대로 거쳤다
  (pending → admin 검수·승인).
- **고래: 보강 불필요 판명** — 시드 카탈로그에 whale(tags: 고래)이 이미 있었다.
  e2e D10의 사이드카는 카탈로그 부재가 아니라 저작 plan이 모티프 없이 나온 케이스.
- subject가 한글(동백꽃·페이즐리)로 저장되므로 별도 한글 tag 없이 lexical
  exact-token 검색이 잡는다(아래 검증으로 확인).

## 검증

- 동백꽃 scatter 프롬프트 → grounding `exact_token 1.000`(신규 동백꽃 모티프),
  **warnings 빈 배열**(노랑 경고 미발화), 사이드카 없음.
- 페이즐리 lattice 프롬프트 → `exact_token 1.000`, 모티프 포함 plan, 사이드카 없음
  (크기 자동 조정 안내만).
- worker 테스트 통과.

## 후속 검토거리 (이번 범위 밖)

**피커 "AI 생성"의 구조적 한계**: 래더가 τ=0.40으로 기존 모티프를 재사용하므로,
카탈로그와 어렴풋이 비슷한 소재(동백꽃↔flower 0.4x)는 사용자가 몇 번을 눌러도 새로
생성되지 않는다. 노랑 경고("왼쪽 모티프에서 바꿀 수 있어요")가 유도하는 복구 루프가
바로 그 대체 케이스에서 같은 대체를 돌려주는 셈. 임계 조정안은 폐기했고,
재사용 래더 자체를 제거하는 방향으로 결정 —
`docs/plans/motif-generate-always-create.md`.

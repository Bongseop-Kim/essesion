# 저작 시범 스튜디오 + starter 시드 정리 완료 기록

- 완료일: 2026-07-25
- 실행 지시서: `docs/plans/authoring-example-studio.md` (완료 후 제거)

## 결과

- `gallery-v1`을 골든 SHA·고정 개수·동기화 계약에서 분리해, 빈 DB에 없는 ID만 넣는
  소량 starter로 전환했다. 기존 DB 행은 덮어쓰지 않고 현재 모델의 누락 embedding만
  보충하며, 골든 회귀는 테스트의 ID-파일명 규약으로 독립 검증한다.
- worker에 catalog-only Plan v3 SVG 프리뷰, 구조 메타데이터 분석, document embedding,
  현재 embedding model 확인 계약을 추가했다. 저작 프리뷰는 Gemini·Recraft·embedding·
  object storage를 호출하지 않으며 미해석 motif layer는 경고와 함께 제외한다.
- API에 admin-only 프리뷰와 `authored` 시범 생성·편집·삭제를 추가했다. Plan 파생값과
  embedding은 worker가 재계산하고, 활성화는 현재 contract·vector·embedding model·검증
  시각·중복을 다시 확인한다. bootstrap/promoted 본문 편집은 403, hard delete는 409다.
- 기존 `/authoring-examples`의 활성 시범 탭에 motif picker, Plan JSON 편집, 실제 SVG
  프리뷰, 프리뷰 후 저장 gate를 넣었다. authored 상세에서는 재프리뷰·편집·영구 삭제가
  가능하며 manager는 읽기만 한다.
- 실제 모델에는 `source` CHECK가 남아 있어 계획서의 “자유 문자열이라 스키마 변경 없음”과
  달랐다. 아직 미배포 단일 베이스라인이라는 아키텍처 결정에 맞춰 별도 revision을 만들지
  않고 모델과 현행 Alembic baseline에서 해당 CHECK를 제거했다.

## 검증

- Aside 브라우저로 모바일 관리자 화면에서 로그인 → motif 검색·선택 → SVG 프리뷰 →
  비활성 authored 저장 → 최초 활성화 → motif 재선택·재프리뷰와 intent 편집 → embedding 갱신 →
  hard delete까지 실제 API·PostgreSQL 흐름을 확인했다. 검증용 embedding만 결정적
  3072차원 대역으로 주입해 유료 provider 호출은 하지 않았고, 임시 DB와 프로세스는 종료·
  삭제했다.
- `uv run pytest`: 936 passed (실제 testcontainers PostgreSQL과 Alembic autogenerate
  drift 포함), upstream Starlette deprecation warning 1건.
- `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyright`: 통과.
- 검증용 Vite 공개값을 명령에만 주입한 `pnpm turbo build typecheck test`: 11/11 task
  통과(admin 211, store 233, shared 62, api-proxy 7 tests).
- `pnpm codegen`: 161 paths, 재실행 전후 생성물 diff SHA 동일. Alembic head는
  `dadd999bf858` 하나다.
- 변경 범위 Biome 149개 파일과 디자인 하네스, JSON parse, `git diff --check`: 통과.
- 저장소 전체 `pnpm lint`는 git에서 무시되는 사용자 로컬
  `.claude/settings.local.json`의 기존 포맷 1건 때문에만 실패했다. 해당 파일은 수정하지
  않았다. `tofu` CLI는 로컬에 없어 `fmt -check`를 실행하지 못했으며 Terraform 변경은
  scheduler 주석 한 단어뿐이다.

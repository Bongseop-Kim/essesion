# 모티프 생성 GPT Image 전환 결과 — 2026-08-12

`docs/plans/motif-adapter-gpt-image-transition.md`(삭제, git 이력 참조) 실행 결과.

## 판정

로컬 코드·스키마·API·생성물·테스트·IaC 전환을 완료했다. 명시적 새 모티프 생성은
GPT Image 2 `quality=low`, `size=1024x1024`, `n=1`만 사용하고, 생성 PNG를 로컬에서
border-connected 배경 제거 → alpha 이진화 → 중간색 정리 → VTracer medium →
팔레트 snap → canvas frame 보존 순서로 정규화한다. 플랫함은 색 수가 아니라 생성 prompt의
그라데이션·음영 금지로 제약하며, 팔레트 색 수는 모티프에 따라 달라진다. 이전 provider fallback이나 선택
설정은 남기지 않았다.

## 적용 내용

- worker adapter를 `gpt_image`로 배선하고 생성 결과를 `gpt-image-*`,
  `source=gpt_image`, `pending`으로 저장한다. 검색 결과와 무관하게 사용자가 “새로
  만들기”를 명시적으로 고른 경우에만 호출하며 디자인 저작의 catalog miss에서는
  자동 생성하지 않는다.
- 세션 예산을 `motif_generation_used`, `motif_generation_remaining`,
  `design_motif_generation_budget`, `motif_generation_budget_exhausted`로 일반화했다.
  선차감·worker 실패 환급·세션당 3회 의미는 유지했다.
- 미개통 DB의 Alembic baseline을 clean break하고 `motifs.source`의 provider 기본값을
  제거했다. normalize와 upsert도 모든 ingress가 `seed`, `gpt_image`, `user_upload`
  source/prefix를 명시하게 했다.
- 이전 adapter·비교 스크립트·설정·환경 변수·Secret Manager 선언·worker IAM/env를
  제거했다. fixture는 `provider_samples`, 테스트·golden ID는 provider 중립
  `fixture-*` 또는 `seed-*`로 재생성했다.
- OpenAPI client, store/admin 명칭과 문구, 개인정보처리방침, 아키텍처·worker spec·DB
  mapping·운영 체크리스트를 같은 계약으로 맞췄다.

## 검증

- GPT Image payload·10% 여백·플랫 색면·가변 팔레트 prompt·canvas frame·gate 1회 재시도·오류
  매핑·pending/provenance/source·예산/환급 테스트 통과.
- 후속 가변 팔레트 교정에서 중간색 병합·8색 모티프의 실제 VTracer 색 보존을 포함한 직접
  영향 테스트를 통과했다. 이어 사진 업로드의 1~6색·단순화 옵션도 API와 store에서 제거해
  GPT Image 생성과 같은 가변 팔레트 중간색 정리·VTracer medium 경로로 통일했다. 직접 영향
  Python 테스트 140개, store 테스트 212개, JS lint/harness, Ruff·Pyright, API client 타입체크와
  OpenAPI 재생성·재실행을 통과했다.
- 로컬 Aside 사진 E2E는 로그인까지 통과했지만 선행 예시 세션 생성이 사진 요청 전에 기존
  `/design/sessions/from-example` 500으로 실패해 완료하지 못했다. 사진 흐름의 스테이징 확인은
  `docs/CHECKLIST.md`에 미완료로 유지했다.
- 빈 PostgreSQL에서 baseline→head와 `alembic check` 통과. 별도 fresh DB에서 motif seed를
  두 번 실행해 각 97행, `source=seed`, 잘못된 ID 0건을 확인했다.
- `pnpm codegen`: 163 paths 재생성, 재실행 drift 없음.
- `pnpm lint`: 통과.
- `pnpm turbo build typecheck test`: 11/11 통과. 최초 강제 병렬 실행에서 변경과 무관한
  admin 상품 목록 1건이 5초 타임아웃됐으나 단독 5/5와 전체 재실행 230/230이 통과했다.
- `uv run pytest`: 1,220 passed, warning 1건(Starlette TestClient deprecation).
- `uv run ruff check .`: 통과. `uv run pyright`: 0 errors, 0 warnings.
- `tofu -chdir=infra fmt -check`와 `validate`: 통과.
- 현행 코드·DB·fixture·golden·설정·IaC·spec에서 이전 provider 명칭 검색 0건. 역사 기록은
  `docs/reviews/`와 git 이력에만 남겼다.
- E2E 판단: 현재 Playwright에는 모티프 생성 흐름이 없고 유료 실호출은 플랜상 스테이징
  1건으로 제한되어 로컬 브라우저 E2E는 실행하지 않았다. API→worker→DB 경계는 실제
  PostgreSQL 통합 테스트로 검증했다.

## 배포 전 운영 게이트

로컬에서 수행할 수 없는 다음 항목은 `docs/CHECKLIST.md`에 미완료로 유지했다.

- 스테이징에서 한국어 subject 1건 실생성, 10% 여백·색·비율·pending 격리·승인 노출·
  registry fingerprint·세션 예산 차감/환급 확인.
- OpenTofu apply 뒤 기존 Secret Manager 리소스·worker env·IAM 제거 확인.
- 이전 외부 provider 계정에서 API credential 폐기 확인.

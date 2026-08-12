# 모티프 메타데이터 자동 태깅·편집 결과 — 2026-08-12

`docs/plans/motif-metadata-enrichment.md`(삭제, git 이력 참조) 실행 결과.

## 판정

완료. GPT Image로 정규화한 모티프는 저장 전에 OpenAI 비전 태깅을 한 번 거쳐
설명·한/영 태그·스타일을 얻는다. 결과는 기존 facet 안전 검사를 통과한 경우에만
병합하고, 태깅 실패나 의심스러운 출력은 생성 성공을 막지 않는다. `user_upload`은
생성 시점 태깅과 기존 행 백필 모두에서 제외했다.

## 적용 내용

- OpenAI 이미지 입력과 strict structured output을 사용하는 `motif_tagging` 어댑터를
  worker lifecycle에 연결했다. 정규 SVG를 기존 래스터 경로로 PNG 변환해 입력한다.
- 설명이 없는 공개 계열 모티프만 처리하는 멱등 백필 스크립트를 추가했다. 성공 행은
  `embedding_openai`를 NULL로 만들어 기존 임베딩 인덱서가 다시 채우도록 했다.
- `PATCH /admin/motifs/{motif_id}`와 생성 API client를 추가했다. admin만
  `subject/description/tags/style`을 수정할 수 있고, 실제 변경이 있을 때만 같은
  트랜잭션에서 임베딩을 무효화한다. manager는 상세 화면에서 읽기 전용이다.
- 관리자 상세 화면에 검색 메타데이터 편집 폼을 배치하고 목록·상세에서 죽은
  `view`·`expression` 표시를 제거했다.
- Alembic `b9e4f61a2c73`에서 `motifs.view`와 `motifs.expression`을 제거하고 모델,
  검색 문서, resolver, API, UI, 테스트, 운영 문서를 함께 정리했다.

## 검증

- 빈 PostgreSQL에서 baseline → `b9e4f61a2c73` upgrade, base downgrade, head 재upgrade,
  `alembic check` 통과.
- 관련 worker 테스트 150개 통과. 생성 태깅 성공, 출력 길이 경계, fail-soft, 안전 검사 거부,
  백필 멱등성, `user_upload` 제외, 임베딩 무효화·재인덱싱, fingerprint 불변을 포함한다.
- admin API 통합 테스트 통과. admin/manager 인가, 허용 필드 제한, 텍스트 안전 검사,
  중복 태그 정리, 빈 태그 거부, 변경/무변경 임베딩 동작을 확인했다.
- `pnpm codegen`, `pnpm lint`, `pnpm turbo build typecheck test` 통과. Turbo는 11/11,
  admin은 53 files / 231 tests를 통과했다.
- `uv run ruff check .` 통과, `uv run pyright` 0 errors / 0 warnings,
  `git diff --check` 통과.
- `[E2E] 대상: 관리자 모티프 메타데이터 편집 | 이유: API 계약·DB 경계 변경 |
  결과: PASS(1건)`. Aside로 `http://localhost:3001/motifs`에서 실제 설명·한/영 태그·
  스타일 저장과 상세 반영, 콘솔 오류 없음을 확인하고 검증용 값은 원복했다.
- 백필 스크립트는 `--confirm-live` 없이 유료 호출 전에 차단되는 것을 확인했다.
  실제 OpenAI 백필 호출은 실행하지 않았다.

## 배포 전 운영 게이트

스테이징에서는 migrate 후 아래 순서로 유료 작업을 명시 실행한다.

```bash
uv run python apps/worker/scripts/backfill_motif_tags.py --confirm-live
uv run python apps/worker/scripts/index_motif_embeddings.py --confirm-live
```

완료 뒤 자동 태그 표본, 새 태그의 exact-token 검색, `embedded=total`을 확인한다.

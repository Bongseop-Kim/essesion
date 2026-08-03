# 디자인 생성과 모티프 생성 분리

실행일: 2026-08-03

범위: `docs/plans/design-generate-motif-separation.md` 전체. 디자인 생성과 아이디어 제안에서
참고 사진 및 암묵적 Recraft 모티프 생성을 제거하고, 새 모티프 생성은 모티프 모달의 명시적
경로로 한정했다.

## 결과

- worker 저작 계약의 모티프 소스를 `input | catalog`로 축소했다. `/generate`와 `/ideas`는
  사진을 받지 않고, 디자인 생성 중 카탈로그 miss가 나도 Recraft를 호출하지 않는다.
- `resolve_spec`, 후보 제시, 세션 Recraft 예산은 모티프 모달의 검색·명시적 생성 경로에
  그대로 남겼다. 사진→SVG와 팔레트 추출도 로컬 staged upload 경로를 계속 사용한다.
- API의 디자인 생성·아이디어 요청과 생성 턴 문맥에서 사진 필드를 제거하고 OpenAPI client를
  재생성했다. store의 참고 사진 상태·모달·진입점을 삭제하고, 색 모달의 사진은 팔레트 추출에만
  쓰며 생성 요청으로 전달하지 않음을 명시했다.
- admin 생성 로그에서 참고 사진 썸네일, 입력 타입, Recraft 호출 표시를 제거했다.
- Alembic `6c4f2a9d1b7e`가 참고 사진 전용 이미지와 첨부, 레거시 로그, `generate|reference`
  authoring example/promotion candidate를 정리한다. `design_turn_attachments`는 concrete motif만
  저장하며 `seamless_generation_attachments`는 삭제된다.
- 아키텍처, DB 매핑, worker/API 명세, 과금 문서와 실행 체크리스트를 현재 계약에 맞췄다.

## 검증

- `pnpm codegen` — 163 paths, 생성물 갱신
- `uv run pytest` — 1,202 passed
- `uv run ruff check .` / `uv run ruff format --check .` / `uv run pyright` — 통과
- `pnpm lint` — 통과
- 환경값을 명시한 `pnpm turbo build typecheck test` — 11/11 tasks 통과
  (store 205 tests, admin 230 tests 포함)
- Aside E2E — 갱신 코드용 임시 store/API/worker에서 로그인 → 참고 사진 없는 첫 디자인 생성 →
  SVG 미리보기 → 아이디어 4건 제안까지 통과. 디자인 화면의 `참고 사진` 노출 0건,
  console error와 page error 0건을 확인했다.

## 운영 인계

- 실행 중이던 사용자 로컬 DB에는 데이터 삭제를 수반하는 새 migration을 적용하지 않았다.
  로컬·스테이징 DB를 `6c4f2a9d1b7e`까지 올린 뒤 계정·설정, 모티프, authoring example과
  embedding index를 다시 시드해야 한다.
- 기존 `:8001` worker는 `--reload` 없이 수정 전부터 실행 중이어서 갱신 코드를 읽으려면
  재시작해야 한다. 검증용 임시 서비스만 종료했고 사용자 프로세스는 건드리지 않았다.
- Vertex ADC와 live provider 확인이 필요한 authoring example 재시드·embedding 인덱싱은
  실행하지 않았으며 스테이징 리허설 항목으로 남겼다.

## 후속 보완 (2026-08-03, 검토 후)

- 레거시 턴 payload 호환: `_build_conversation_context`가 attachment_refs를 `{filename}`으로
  정규화해 전달한다 — 참고 사진 시절 payload(`kind:"photo"`·`purpose`)가 남은
  세션의 구성 수정이 워커 StrictRequest에서 422로 깨지지 않는다. 마이그레이션은 턴 payload
  JSON을 다시 쓰지 않는다(전송 시 정규화가 방어선).
- admin 로그 상관 복원: worker `GenerateRequest`에 로그 표식 전용 `session_id`·`user_id`를
  추가하고 API가 채운다. 과금·모티프 유입 provenance(`MotifIngressProvenance`)와는 무관하며,
  admin의 요청자 링크·턴 상관이 새 로그에서도 동작한다.
- 죽은 코드 삭제: `prepare_reference_image`·`ReferenceImage.purpose`·
  `MAX_REFERENCE_IMAGE_PIXELS/SIDE` (프로덕션 호출자 0).
- `ConversationHistoryItem.attachments` 상한 7→2 (사진 5 + 모티프 2 시절 값 정리).

# 로컬 스토리지·finalize 기본값 적용 리뷰 — 2026-08-04

스토리지·finalize task queue의 DryRun/Unavailable 구현을 제거했다. local/test는 환경 변수
없이 fake-gcs-server(`dev-uploads`·`dev-assets`)와 worker 직접 호출(`InlineTaskQueue`)을
쓰고, 비로컬은 GCS 버킷·Cloud Tasks 설정이 빠지면 lifespan에서 기동 실패한다. Toss·Solapi
DryRun은 계획대로 유지.

죽은 코드도 같이 걷어냈다 — 클라이언트가 `RealGcsClient` 하나뿐이라 항상 `true`이던
`upload_required`(스키마 4곳·프론트 분기 3곳), 상수를 반환하던 `assets_capability_mode`와
`gcs`/`gcs_assets` capability. 테스트는 프로덕션 DryRun 대신 `tests/fakes.py`의 명시적
fake(builder monkeypatch)와 실제 fake-gcs-server를 쓴다. OpenAPI 표면이 바뀌어
api-client 재생성물을 동봉했다.

## 계획 대비 기록

- GitHub Actions `services` 문법으로는 fake-gcs-server의 command 플래그를 넣을 수 없어
  CI도 `docker compose up -d --wait gcs`를 쓴다(healthcheck 추가 — `up -d`만으로는
  리스닝을 보장하지 않아 레이스가 났다).
- `docs/CHECKLIST.md`의 스테이징 E2E는 Cloud Tasks 경로가 남아 미체크. 이번 local
  fake-gcs + inline finalize 통과만 진행 메모로 남겼다.

## 검증

`uv run pytest` 1,203 passed · Ruff·Pyright 통과 · `pnpm lint` 통과 ·
`pnpm turbo build typecheck test` 11 task 통과. 로컬 E2E(Aside): 게시 예시 선택 →
inline finalize → 완성본 표시, `dev-assets`에서 PNG 200(494,785 bytes), console error 0건.

전체 스위트 1회차에서 `test_contract.py::test_api_contract[GET /reviews]`가 sqlalchemy
오류로 실패했으나 재실행·단독 실행에서 재현되지 않았다(schemathesis 플레이크로 판단, 미해결).

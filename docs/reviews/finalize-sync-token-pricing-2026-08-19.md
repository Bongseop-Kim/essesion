# 실사화(finalize) 개편 — 동기 전환 · 소액 토큰 과금 · 프리뷰 통합

실행일: 2026-08-19

상태: 완료 (플랜 `docs/plans/finalize-sync-token-pricing.md` 전 항목 — 실행 후 플랜 삭제)

## §0 실측 게이트

프로덕션 표본이 없어 로컬 수동 벤치(플랜 지정 최악 케이스: 선염 + 모티프 +
material_map + relief, 300 DPI, compose+rasterize 4회 경로):

| 타일 | 소요 | PNG |
|---|---|---|
| 48mm | 0.27~0.73s | 553KiB |
| 96mm | 0.79s | 1.9MiB |
| 150mm | 1.55s | 3.9MiB |

Cloud Run 2vCPU가 로컬 M-시리즈보다 10배 느려도 p95 ≤ 30초를 크게 밑돈다 → §1 진행.

## §1 동기 전환

- worker: `/tasks/finalize`(잡 claim·lease·attempt 기계) 삭제, **stateless 동기
  `POST /finalize`** 신설 — 입력은 `GenerationJob.params`와 동일 형태(strict),
  영구 실패는 422 `FINALIZE_INVALID_INPUT`, 일시 실패는 5xx. `_finish_job`,
  `finalize_lease_seconds` 삭제.
- api: `create_finalize_job` 재작성 — provenance 검증(불변) → 토큰 차지 →
  `_shielded` 동기 워커 호출 → 성공 시 `GenerationJob(status="succeeded")` 한 번에
  INSERT. 실패는 행 없이 work_id 멱등 환불. 삭제: cancel 엔드포인트(죽은 경로),
  단건 `GET /design/jobs/{id}`(폴링 전용이었음 — order-reference는 POST만 사용),
  `_fail_finalize_dispatch`, `job_lifecycle.py`(STALE_GENERATION_JOB_AFTER는
  generate stale 회수용으로 router로 이동), `integrations/tasks.py` 통째,
  배치 `reconcile-stale-generation-jobs`, `cloud_tasks_*` 설정.
- infra: Cloud Tasks 큐·tasks-invoker SA·enqueuer 롤·reconcile 스케줄러 잡 제거,
  worker-finalize timeout 900s → 180s(api `worker_timeout_seconds`와 정합).
  1회성 정리 절차는 `infra/README.md` 배치 절에 기록.
- store: `use-finalize-job.ts`(폴링 전부) 삭제, 생성 뮤테이션은
  `use-design-output.ts`로 이동. 스낵바 2종 → 완료 1종, 성공 시 완성본 모달을
  바로 연다. 페이지 이탈 마커는 만들지 않음(성공이 보관함에 남는다).

## §2 쿼터 → 소액 토큰 과금

- `design_finalize_cost` = "5" 신설(`config_defaults.ADMIN_SETTINGS`),
  `design_finalize_daily_limit` 폐기 + `_RETIRED_ADMIN_SETTING_KEYS`로 운영 DB
  유령 행 삭제. admin allowlist·검증 범위(1~1000)·화면 항목 교체.
- api: `quota.py` 삭제, `finalize_quota_exhausted`·finalize `missing_configuration`
  에러 소멸. 세션 단건 GET의 `finalize_quota` 필드 삭제(**api-client breaking**,
  codegen 반영). work_id `design_finalize_{job_id.hex}` — 환불 지점은 동기 경로
  1곳. `GET /tokens/balance`에 `finalize_cost` 추가.
- store: 잔여 횟수·리셋 Callout 삭제, 다이얼로그 제출 버튼에 "실사화 만들기 ·
  N토큰" 표기(모티프 생성 버튼과 같은 방식). 토큰 부족이어도 다이얼로그는 열린다
  — **U23 결함 소멸**.

## §3 프리뷰 통합

`finalized-list-modal.tsx`의 평면 `ImageFrame` → `TieCanvas` + 캔버스와 같은
`ViewToggle`(넥타이/타일, 모달 상단 1개). 실사화 PNG가 seamless 타일이라
`imageSrc`에 `result_url`을 그대로 배선. finalize 성공 직후 이 모달이 열려 결과를
즉시 같은 뷰로 본다. 주문제작 피커는 평면 썸네일 유지.

## §4 명세·문서·검증

- `worker-pipeline.md` §4·§5(동기 계약·과금), `domains.md` finalize/jobs 행,
  `money.md` §6 표(실사화 5토큰 행), `ARCHITECTURE.md`(다이어그램·ADR·배치 4종),
  `token-pricing-recalibration.md` 실사화 행 갱신. `pnpm codegen` 생성물 포함.
- 테스트: api 쿼터 테스트(`test_finalize_quota.py`) 삭제 → 과금·환불 테스트로 대체
  (`test_design.py`, testcontainers), worker `test_finalize_jobs.py` 동기 계약으로
  재작성(골든 렌더 실경로 유지), 폴링·취소·task queue 테스트 삭제.
- 통과: `test_design.py` 74건, worker finalize/config/health 31건, batch·admin·
  authz·tokens 스위트, store 218건, admin 235건, `pnpm build/typecheck/lint`,
  `ruff`/`pyright` 클린.

## 잔여 확인 사항

- **U12(실사화 끝낸 세션이 "작업 중" 표시)**: 동기 전환으로 폴링·jobId 상태가
  사라져 구조적으로 재현 경로가 없어졌다 — 배포 후 실화면에서 최종 확인할 것.
- worker-finalize Cloud Run 배포 시 timeout 180s 적용 확인(tofu apply).
- 프로덕션 legacy `queued`/`processing` 행: 폴링 클라이언트가 없어 무해, 사용자
  삭제 가능(삭제 가드 제거됨).

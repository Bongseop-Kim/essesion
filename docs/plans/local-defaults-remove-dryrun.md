# 플랜 — 스토리지·finalize DryRun 제거, 로컬 기본값을 config로

> 상태: **미실행 제안** (2026-08-03).
>
> 원칙: "미설정이면 조용히 no-op(DryRun)"을 버린다. 로컬/테스트는 docker compose의
> fake-gcs-server가 항상 떠 있는 것을 전제로 **에뮬레이터가 config 기본값**, 배포
> 환경에서 미설정이면 **기동/요청 시 에러**(fail-fast). 환경별 토글 env 변수는
> 파생 규칙으로 대체해 삭제한다.
>
> 결과: `.env.example`은 시크릿만 남는다.

## 확정된 설계 결정

- **DryRun 삭제 범위는 스토리지·태스크큐만.** `DryRunGcsClient`(api),
  `DryRunObjectStore`(worker), `DryRunTaskQueue`(api)와 `capability_mode="dry_run"`
  분기 전부. Toss/Solapi DryRun은 범위 외 — 외부 실계정 서비스라 로컬 에뮬레이터
  대체물이 없다.
- **로컬 기본값은 Settings 필드가 아니라 빌더에서 env 분기로 준다** —
  `build_task_queue`가 이미 쓰는 패턴(`env in ("local", "test")`)과 동일.
  Settings 기본값은 "" 유지: "명시 안 함"과 "로컬 기본"을 빌더 한 곳에서만 해석.
  - `env in ("local","test")` + 미설정 → `http://localhost:4443` / `dev-uploads` /
    `dev-assets`.
  - 그 외 env + 미설정 → 기동 시 RuntimeError (지금처럼 Unavailable로 눕지 않는다).
- **`worker_finalize_inline` 설정 삭제 — 파생 규칙으로 대체.**
  `build_task_queue`:
  - Cloud Tasks 3요소 구성됨 → `CloudTasksRestQueue` (기존).
  - `env in ("local","test")` → **`InlineTaskQueue`**: `enqueue_finalize`가
    worker 클라이언트로 `finalize_job`을 직접 await (기존 inline 분기와 동일 동작).
  - 배포 env + 미구성 → 기동 시 RuntimeError (`UnavailableTaskQueue` 삭제 —
    "떠 있지만 503"보다 안 뜨는 게 낫다).

## 작업 항목

### 1. api

- `integrations/tasks.py`: `DryRunTaskQueue`·`UnavailableTaskQueue` 삭제,
  `InlineTaskQueue(worker_client)` 추가, `build_task_queue`를 위 규칙으로.
  worker 클라이언트 의존이 생기므로 `main.py` 배선 순서 확인
  (`app.state.worker` 생성 후 큐 생성).
- `domains/design/router.py`: `worker_finalize_inline` 분기 삭제 —
  `tasks.enqueue_finalize` 단일 경로. InlineTaskQueue가 완료까지 await하므로
  기존 inline 응답 의미(완료된 job 반환) 유지 확인.
- `integrations/gcs.py`: `DryRunGcsClient` 삭제, `build_gcs_client`에 로컬 기본값
  분기. `assets_capability_mode`/`public_assets_bucket`의 `dry_run`·추측 분기 제거 —
  모드는 "real" 아니면 기동 에러.
- `config.py`: `worker_finalize_inline` 삭제.
- `capability_mode` 소비처 정리: `deps.py`, `main.py`, `domains/admin/products.py`,
  `integrations/worker.py`·`solapi.py`·`toss.py` 중 스토리지/태스크의 dry_run 분기만
  제거 (Toss/Solapi capability는 유지).

### 2. worker

- `integrations.py`: `DryRunObjectStore` 삭제, `build_object_store`에 로컬 기본값
  분기(`gcs_bucket` 미설정: local/test → `dev-assets`+에뮬레이터, 그 외 → 기동 에러).
- `adapters/__init__.py` docstring의 "진짜 DryRun은 GCS ObjectStore뿐" 문구 갱신.

### 3. 테스트·CI

- `.github/workflows/ci.yml` `services:`에 `fsouza/fake-gcs-server` 추가
  (docker compose와 같은 :4443, 커맨드 플래그 동일하게).
- `dry_run`을 assert하거나 DryRun에 기대던 테스트 정리 (test_images, test_reviews,
  test_quotes, test_admin_products, test_contract, test_admin_hardening, test_design,
  test_api_generate, test_object_store 등 grep 히트 전수): 에뮬레이터 경유로 전환
  (`test_gcs_emulator.py` 패턴) 또는 fake 주입 명시.
- 배포 env + 미설정 → 기동 에러 나는지 테스트 1개 추가.

### 4. env·문서

- `.env.example`: `WORKER_FINALIZE_INLINE`·`GCS_EMULATOR_HOST`·`GCS_UPLOAD_BUCKET`·
  `GCS_ASSETS_BUCKET`·`GCS_BUCKET` 삭제 → 시크릿만 남음.
- `AGENTS.md`("시크릿 없으면 … GCS는 `.env`의 `GCS_EMULATOR_HOST`" 문구,
  api 실행 설명), `README.md`, `ARCHITECTURE.md`(§6 스토리지), `docs/OPERATOR-CHECKLIST.md` 갱신.
- `infra/cloudrun.tf`는 변경 없음 — 이미 버킷을 전부 명시 주입하고 있고, 배포 env는
  미설정 시 이제 기동 에러로 드러난다.

## 리스크

1. **CI가 진짜 GCS 경로를 타게 됨** — fake-gcs 컨테이너 기동 실패/포트 충돌 시 CI
   전체가 눕는다. compose와 이미지 태그·플래그를 고정해 드리프트를 막을 것.
2. **기동 에러로의 전환** — 지금은 배포 환경에서 미설정이어도 서비스가 뜨고 503을
   준다. 바뀐 뒤에는 아예 안 뜬다(크래시 루프). 의도된 fail-fast지만, staging 첫
   배포 시 누락 변수를 여기서 발견하게 됨을 인지할 것.
3. **InlineTaskQueue의 요청 시간** — 로컬 finalize는 요청 안에서 렌더를 기다린다
   (기존 inline과 동일, 새 리스크 아님). 프로덕션은 Cloud Tasks 구성이 있는 한
   inline 경로에 절대 들어가지 않는다.

## 검증

- `uv run pytest` (fake-gcs 필요 — 로컬은 docker compose up 상태에서),
  `uv run ruff check .`, `uv run pyright`
- 레거시 0 확인: `grep -rn 'DryRun\|dry_run\|worker_finalize_inline\|WORKER_FINALIZE_INLINE' apps/` 히트가 Toss/Solapi 외 0건.
- 로컬 E2E: `.env`에서 GCS_*·WORKER_FINALIZE_INLINE 줄 삭제 후 api·worker 재기동 →
  store에서 생성→finalize→산출물 다운로드 1회.

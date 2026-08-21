# assets 프록시 개통 실행 기록 (2026-08-21)

`docs/plans/assets-proxy-cutover.md`를 전부 실행했다. `perf-cost-reduction-2026-08-19.md`
7번의 남은 절반(스위치 켜기)이 이걸로 닫힌다.

## 실행 조건 확인

- 배포: `deploy.yml` 2026-08-21T00:27Z 성공(main `fec6388`, CI 00:23Z 성공).
- 프록시 생존: `assets.essesion.shop/products/staging/46b4a305….jpeg` → **200**,
  `cache-control: public, max-age=31536000, immutable`, 2회 요청에서
  `cf-cache-status` **MISS → HIT** 확인. 절차 2 통과.
- tfvars 정본은 절차 1대로 `gs://essesion-tfstate/production.tfvars`에서 내려받아 사용
  (로컬 사본은 08-19자로 낡아 있었다).

## plan에 예상 외 변경 2건 — 원인 규명 후 함께 apply

플랜은 "api env 1건 외에 뜨면 멈춘다"였고, 실제로 3건이 떴다.

- `google_cloud_run_v2_service.api` — `PUBLIC_ASSETS_ORIGIN` 추가 (의도한 변경)
- `google_cloud_run_v2_service.worker_finalize` — `OPENAI_API_KEY` 시크릿 env 추가
- `google_secret_manager_secret_iam_member.worker_finalize_secrets["openai-api-key"]` — 생성

뒤 2건은 tfvars와 무관하고 **`b536af5`(Feat/motif #78)의 "Migrate worker LLM and
embeddings to OpenAI"에서 들어온 infra 코드가 아직 apply되지 않은 드리프트**였다.
`openai-api-key` 시크릿 버전 1이 enabled(2026-08-14 생성)임을 확인하고 — 없으면 새
revision이 기동 실패한다 — 3건을 한 번에 apply했다. 플랜이 예외로 적어둔 "3차 변경
묶음"(cloudrun 인스턴스·풀, Artifact Registry cleanup, scheduler 30분)은 뜨지 않았다.
이미 apply된 상태다.

## 결과

- `Apply complete! Resources: 1 added, 2 changed, 0 destroyed.`
- 절차 6(버킷 업로드) 수행 완료 — 버킷 정본 29행이 주석 해제 상태임을 재확인.
  **이 플랜의 실패 모드였다.**
- 재plan: `no differences`. 드리프트 없음.
- 라이브 env: api `PUBLIC_ASSETS_ORIGIN=https://assets.essesion.shop`,
  worker-finalize `OPENAI_API_KEY -> secret:openai-api-key`.
- 두 서비스 Ready=True (`api-00022-th7`, `worker-finalize-00018-qnw`).
- 기존 직통 URL(`storage.googleapis.com/ysindustry-assets/…`) 여전히 200 — 버킷 공개
  읽기가 유지되므로 정상.

## 남은 관측 (코드 작업 아님)

- **새로 발급되는 URL**: 프로덕션에 쓰기를 만들지 않았으므로 미확인. 다음에 상품을
  재저장하거나 생성물을 만들 때 반환 URL이 `assets.essesion.shop`인지 보면 된다.
  아니면 api가 env를 못 읽고 있다는 뜻이다.
- **비용 신호**: 며칠 뒤 GCS DATA_READ 로그 볼륨·Class B 요청 감소
  (`gcp-cost-reduction-2026-08-17.md`의 관측 방법).

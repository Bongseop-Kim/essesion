# 실사화 저품질 전환 + 단가 확정 (5 → 200토큰) — 2026-08-20 실행

`docs/plans/finalize-pricing-low-quality.md` 실행 기록. AI 실사화 컷오버(같은 날,
`finalize-ai-cutover-2026-08-20.md`)가 미확정으로 남긴 `design_finalize_cost`를 확정했다.

## 결정

- **quality**: `finalize_image_quality` 기본값 `medium` → **`low`** (`worker/config.py`).
- **단가**: `design_finalize_cost` 5 → **200** (`config_defaults.py`, admin 화면·테스트 동기).
- 품질과 단가는 한 몸 — medium으로 되돌리면 요청당 약 150원이라 단가(약 950토큰)를 함께 올려야 한다.

## 근거 (로컬 실호출, quality=low)

라우트와 같은 경로(`prepare_photoreal_inputs` → `render_photoreal`)로 실행, 편집 2회 병렬 **24.4s**.

| 항목 | 원가 | 성격 |
|---|---|---|
| 넥타이 1024x1536 low | 12.6원 | 추정 — money.md low 1024² 8.4원 픽셀 비례 |
| 원단 1024x1024 low | 8.4원 | 추정 — money.md 대표값 |
| Cloud Run 24.4s | 0.9원 | 추정 — 0.035원/s |
| **평균 계** | **21.9원** | `provider_usage` 50건으로 실측 교체 대기 |

200토큰 = pro 순수령 126.2원, 원가율 **17.4%** (25% 가드 하한 139토큰, 최악 가드 하한 70토큰).
육안: 넥타이 컷은 팔레트·모티프·광택 유지로 합격(사용자 승인). 원단 클로즈업은 lattice가 밴드로
뭉치는 열화가 있으나 low 탓인지 프롬프트 탓인지 미분리 — 원단 컷 개선은 범위 밖으로 남김.

## 같이 고친 것

- **배포 블로커**: `worker-finalize`에 `OPENAI_API_KEY`가 미주입이었다(컷오버 전 "로컬 Pillow만"
  전제). `infra/cloudrun.tf`에서 키를 워커 공통 `worker_secret_env`로 올리고
  (`worker_generate_secret_env` local 제거), `infra/iam.tf` finalize SA에 accessor 추가.
  이게 빠지면 운영 finalize 전건 503이었다.
- `money.md` §6: 실사화 행 확정, "유일한 이미지 provider 경로 = 모티프" 서술 수정, grant 근거
  문구(750 = 탐색 + 실사화 1회 완주, 약 385토큰), usage 로그 operation 표기를
  `finalize_tie`·`finalize_fabric`으로 정정(기존 `operation=finalize`는 0건 쿼리 함정).
- `worker-pipeline.md` p95 표기 ~25s(quality=low), `cloudrun.tf` 타임아웃 근거 주석 갱신
  (240s 관계는 유지 — 상향 불요).
- `token-pricing-recalibration.md`: 실사화 행을 "확정, 실측 교체만 남음"으로 축소, 표본 조건에
  finalize 50건 추가.
- admin `settings.tsx`: defaultValue 200개, editWarning을 손익 경고로 승격. 모티프 생성 설명의
  "세 단가 중 유일하게/가장 높은" 문구 제거(실사화가 더 높아짐).

## 검증

- seed 재실행 → `admin_settings.design_finalize_cost = 200` 확인.
- `pytest apps/api/tests/test_design.py apps/api/tests/test_tokens.py` 91 passed,
  worker finalize 관련 37 passed, admin 235 passed(고정 표시값 어서션 1건 200개로 갱신),
  `pnpm architecture:check` 5/5 KEPT. terraform validate는 로컬 CLI 부재로 CI에 위임.
- **운영 DB는 admin 설정 화면에서 200으로 직접 변경할 것** (시드는 신규 환경 기본값).

## 남은 것

- `provider_usage`(`operation=finalize_tie`·`finalize_fabric`) 50건 실측으로 추정 원가 교체 —
  `token-pricing-recalibration.md` 소관. 실측 평균이 31.5원(순수령 25%)을 넘으면 단가 재조정.
- 원단 클로즈업 품질(lattice 뭉침·텍스트 모티프 소실) — 프롬프트·참조 구성 개선, 별개 작업.

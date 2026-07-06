# 4단계 실행 계획 — worker (seamless 엔진 재구현 + 배포 + api 연결)

기준: [CHECKLIST §4](../CHECKLIST.md) · 명세: [worker-engine.md](../api-spec/worker-engine.md), [worker-motifs.md](../api-spec/worker-motifs.md), [worker-pipeline.md](../api-spec/worker-pipeline.md) · 아키텍처: ARCHITECTURE §2·§7

## 배경·범위

seamless-tile을 `apps/worker`로 재작성한다(코드 이식 금지, 동작 명세 보존). 결정론 계약 — **같은 (intent, seed, colorway, registry_version) → byte-identical SVG** — 이 대조 기준이고, 원본 gallery 25세트가 골든 소스다. 세션 계층(LangGraph)·프로세스-로컬 상태는 승계하지 않는다(스펙 §5 재구현 계약). 한 코드베이스를 worker-generate(외부 API 바운드)와 worker-finalize(CPU·메모리 바운드) 두 Cloud Run 서비스로 배포하고 api와 연결한다.

**선행 조건(병행 트랙)**: 엔진~파이프라인(0~7)은 전부 로컬로 진행 가능. 8~10(배포·연결)부터 스테이징 인프라 필요 — CHECKLIST §1의 보류 항목(tofu apply, Secret 주입, Sentry, Toss 웹훅 URL 등록)을 9번에서 함께 소화한다.

## 아키텍처 요약

```
apps/worker/src/worker/
├── main.py            # 기존 골격 확장 — 라우터 등록, lifespan(engine·store·adapters)
├── config.py          # pydantic-settings (스펙 §8·§10의 설정값, 시크릿 없으면 DryRun)
├── db.py              # async engine (essesion-db 모델 재사용 — motifs/generation_logs/generation_jobs)
├── engine/            # units, determinism, intent, palette, validate, primitives/, placement/, seamless, composition, candidates
├── motifs/            # geometry, registry(normalize/slotify/hash), store(async), facets, glyphs(fontTools)
├── adapters/          # gemini(llm 저작), recraft(게이트·평탄화), embedding, resolver, fingerprint, image(전처리)
├── render/            # raster(서브프로세스 기준 + resvg-py 후보), sanitize, fabric(재설계), assets/fabric/*.png
└── api/               # routes: generate, motifs, export, tasks(finalize), health / schemas
```

- 의존성(전부 핀): Pillow, fonttools, google-genai, httpx, pgvector, resvg-py(동등성 판정 전까지 후보), + 폰트·weave 에셋 복사(에셋은 이식 금지 대상 아님 — 결정론 입력).
- `integrations/gcs.py`는 api·worker 공용이 되므로 **libs/gcs로 승격**(obs와 동일 패턴).
- 테스트: 루트 tests/의 testcontainers 기반 재사용(db.testing) + 골든 픽스처 디렉토리.

## 실행 순서 (커밋 단위)

**0. 골든 확정** — 재구현의 채점표를 먼저 만든다.
- 원본 레포에 uv 임시 venv를 만들어 gallery/json 25세트를 엔진에 재실행 → gallery/svg와 바이트 비교로 **골든 최신성 검증**(stale이면 재추출본을 골든으로).
- seed 변형(0/1/12345)·colorway 변형·candidates(count=4) 산출물 골든 추가 추출(결정론 축 커버).
- `apps/worker/tests/golden/`에 intent JSON + SVG 커밋, `tests/fixtures/`(recraft_samples 3종: pig face flat, honeybee top, pelican bicycle side, motif_eval)를 복사.

**1. worker 플러밍** — config(스펙 설정값 전부, 기본값으로 임포트 가능), db.py, 의존성 추가, obs 승계 확인. 테스트 conftest(migrated_postgres 재사용).

**2. 엔진 코어** — units(fmt·snap 계열) → determinism(stable_hash·select_variant·seeded_rng) → intent 스키마 → palette → validate(repair 3종) → primitives(background/stripe) → placement 4종 → seamless(clone·불변식) → composition(compose·2MB 캡) → sanitize.
검증: 원본 이식 결정론 테스트(동일 입력 2회, PYTHONHASHSEED 0/1/12345 교차) + **골든 25세트 바이트 대조** + placement/units 단위 테스트. *골든 불일치는 fmt·정렬·순서 규칙 위반 신호 — 스펙 §9 함정 목록부터 의심.*

**3. candidates + repro** — 변이·rank·de-dup·선택·멀티디자인 round-robin, candidate_id/layout_id 해시. 골든(count=4) 대조 + 다양성 경고 테스트.

**4. 모티프 계층** — geometry(bbox 파서) → registry(정규화 파이프라인·content-hash·slot 심볼 파생) → store(motifs 테이블, SQLAlchemy async — 원본 psycopg 동기에서 스택 통일) → facets/variant_group → fingerprint(epoch 메모) → glyphs(텍스트-as-모티프). recraft_samples 픽스처로 정규화·해시 일치 검증(원본과 같은 입력 → 같은 motif_id), store는 실DB 테스트.

**5. 어댑터** — image 전처리 → gemini(JSON mode·백오프·designs 파싱, 프롬프트는 스펙 원문) → recraft(게이트·정리·재프롬프트 1회, gradient 변환 없음) → embedding(τ 텍스트 규칙) → resolver(래더: exact→hard filter→τ→generate). respx로 외부 API 목킹, 키 없으면 해당 어댑터만 비활성(intent-direct 경로는 키 없이 동작 — 테스트 전제).

**6. 래스터 + resvg 동등성 판정** — rsvg-convert 서브프로세스 구현(기준선, 원본 플래그 그대로) → resvg-py 인프로세스 구현 → **판정 하네스**: 골든 SVG 25세트를 두 렌더러로 150/300dpi 래스터, 픽셀 완전 일치면 resvg 채택, 불일치면 librsvg 폴백 확정(+Dockerfile에 librsvg·판정 결과를 이 문서에 기록). mm_to_px·20,000px 캡·DPI 스탬프 재현.

**7. fabric finalize 재설계 + export** — 스펙 §2의 재설계 지침: 전체 intent **1회 세그멘테이션에서 motif/base 마스크 파생** → 렌더 호출 5회→2~3회. 수식(thread 유리수 step, wrap-offset rim, LUT)은 원문 유지. export(scrub 포함). 검증: 픽셀 결정론(2회 바이트 동일), seam 임계값, print/yarn_dyed 분기, 합성 weave(64²) 목킹 + **원본 대비 렌더 수 감소 assert**(rasterize 호출 카운트).

**8. worker API 표면** — /generate(intent-direct부터, 풍부 응답 + GCS previews 업로드 + seamless_generation_logs INSERT), /motifs/candidates, /motifs/generate, /export, /tasks/finalize(generation_jobs FOR UPDATE → render → GCS content-hash upsert → succeeded/failed, 실패 5xx로 Cloud Tasks 재시도 위임, succeeded 멱등 200). libs/gcs 승격 포함. Dockerfile: worker 분기(폰트 + librsvg 폴백 시 apt 설치).

**9. 스테이징 개통 + api 연결** —
- 인프라: `infra/README.md` 부트스트랩 → tofu apply → Secret 주입(GEMINI/OPENAI/RECRAFT/TOSS/SOLAPI) → GitHub vars → Sentry 프로젝트 → Toss 웹훅 URL 등록 (CHECKLIST §1 보류분 소화).
- api: worker 클라이언트(OIDC id-token — 로컬은 평문 http), design 도메인 확장(생성 요청 → 세션 recraft_used/finalize_used 카운터 검사·증가 → worker 호출 → 턴·후보 저장), finalize 잡 생성(Cloud Tasks enqueue — 로컬 DryRun은 워커 http 직접 호출), 잡 폴링은 기존 generation_jobs 골격. `pnpm codegen` 재생성.
- 배치·과금 연동 확인: use_tokens(work_id)와 생성 경로의 결합 시점은 5단계 /design 기획에서 확정(스펙 §5 — worker는 과금을 모른다).

**10. 검증·마무리** — 스테이징 E2E(api → generate → finalize 큐 → GCS 결과), finalize 메모리 실측 시작점 기록, CHECKLIST §4 갱신, 이 문서에 판정·실측 결과 기록.

각 단계 끝: `uv run pytest` + `uv run pyright` + `uv run ruff check .` 통과 후 커밋.

## 리스크

| 리스크 | 대응 |
|---|---|
| fmt·정렬 미세 차이로 골든 불일치 | 0번에서 골든을 먼저 확보 — 2번부터 즉시 탐지. 스펙 §9 함정 목록 우선 점검 |
| 원본 gallery/svg가 stale | 0번에서 원본 엔진 재실행으로 검증 후 골든 확정 |
| resvg ≠ librsvg 렌더 차이 | 판정 하네스로 조기 확정, librsvg 폴백 경로를 처음부터 유지 |
| Pillow/fonttools 버전에 따른 픽셀 차이 | uv.lock 핀 + 픽셀 결정론 테스트가 CI에서 상시 검증 |
| Cloud Tasks 로컬 검증 불가 | 핸들러는 http로 직접 테스트(멱등·재시도 계약), 큐 연동은 스테이징 E2E에서 |
| Gemini/Recraft 실키 없이 개발 | intent-direct 경로 우선 + respx 목킹, 실키 검증은 스테이징에서 |

## 검증 (완료 판정)

- 골든 25세트(+seed/colorway/candidates 변형) 바이트 일치, PYTHONHASHSEED 교차 일치.
- recraft_samples 3종 정규화 결과·motif_id가 원본과 일치.
- fabric 픽셀 결정론 + seam 임계 + 렌더 호출 수 감소.
- stateless 확인: 프로세스-로컬 캐시·락 없음(코드 리뷰 항목), 예산은 DB 카운터.
- 스테이징: api 경유 generate 동기 호출(OIDC) + finalize Cloud Tasks 왕복 + GCS 산출물 확인.

## 진행 기록 — 2026-07-06

- 완료(리뷰 후 재작업): 골든을 원본 엔진 직접 실행으로 재추출 — resolved intent JSON 25종 + 원시 `generate()` SVG 25종(+seed 1/12345 변형) + candidates 세트(4종) + motifs.json. 기존 gallery SVG는 DISPLAY_SCALE=4가 섞인 오염본이라 폐기.
- 완료(리뷰 후 재작업): 엔진에서 골든 룩업 경로 제거, compose/placement(4종)/seamless/validate/candidates를 원본 알고리즘대로 재작성 — 골든 25종·seed 변형·candidates(id/warnings/svg)까지 전부 **계산으로** byte-identical 통과(31+개 테스트), PYTHONHASHSEED 0/1/12345 교차 일치.
- 완료: `apps/worker`에 config/db/API 라우트, `rsvg-convert` 래스터 기준선(+resvg 폴백), export(scrub 경유), finalize task handler(처리중 상태 커밋 후 렌더·완료는 새 트랜잭션), GCS/DryRun object store. 미구현 경로(prompt→intent, /motifs/*, yarn_dyed)는 가짜 200 대신 501/명시적 오류.
- 완료: api design 라우터에 worker `/generate` 동기 호출, finalize job 생성·조회(예산은 settings `design_finalize_budget` + 조건부 UPDATE로 원자 차감), Cloud Tasks REST enqueue(DryRun fallback), worker 클라이언트 OIDC id-token(메타데이터 서버, audience 설정 시) 연결.
- 결정: recraft_samples는 원본 8종 대신 커스텀 3종(pig face flat, honeybee top, pelican bicycle side)으로 교체, gradient는 평탄화 없이 오류 처리(미사용 방침) — worker-motifs.md/worker-pipeline.md에 주석.
- 판정: resvg-py 채택은 아직 미판정. 컨테이너는 우선 `librsvg2-bin` 폴백으로 고정.
- 남음: pgvector motif resolver/store, Recraft/Gemini/OpenAI adapters, yarn_dyed fabric texture/material_map 재설계, 스테이징 `tofu apply` 후 실제 OIDC/Cloud Tasks/GCS 왕복 검증.

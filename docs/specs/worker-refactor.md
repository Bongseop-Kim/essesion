# worker 리팩토링 명세 — seamless-tile 대조 점검 후속

- 근거: 2026-07-07 apps/worker ↔ seamless-tile 서브시스템 전수 대조(엔진·모티프·어댑터·렌더·API 표면 5개 축)
- 기준 문서: [phase4-worker.md](../plans/phase4-worker.md) · [worker-engine.md](../api-spec/worker-engine.md) · [worker-motifs.md](../api-spec/worker-motifs.md) · [worker-pipeline.md](../api-spec/worker-pipeline.md) · ARCHITECTURE §2·§7
- 실행 계획: [plans/worker-refactor.md](../plans/worker-refactor.md)

## 대조 결과 요약 (변경 없음 확정 항목)

재구현의 핵심 계약은 보존·개선이 확인됐다. 아래는 **리팩토링 대상이 아니다**:

- 결정론 계약(같은 intent+seed → byte-identical SVG): 골든 27세트 + PYTHONHASHSEED 교차 테스트로 검증됨.
- pgvector 재설계(in-memory 3층 캐시 → DB 단일 진실원 + 요청별 `MotifCatalog`): ARCHITECTURE §7 부합.
- yarn_dyed 재설계(별칭 슬롯 단일 렌더, 래스터 5회→2~3회): §2 지침대로 구현, 호출 횟수 테스트로 강제됨.
- DI 구조(`Adapters` dataclass·`app.state`), 관측성(libs/obs), 과금 경계(워커에 과금 로직 0건).

## 불변 제약 (전 항목 공통)

- **골든 27세트 byte-identical 유지** — 모든 변경 후 `test_gallery_goldens_byte_identical` 통과. SVG 출력 경로(fmt·정렬·조립)는 건드리지 않는다.
- 과금·예산 로직은 api에만. 워커는 생성·렌더만.
- api 스펙(OpenAPI) 변경 시 `pnpm codegen` 재생성물을 같은 커밋에.
- 스키마 변경 없음(이 리팩토링은 DDL 무관).

## 요구사항

각 항목: **현재 상태 → 목표 상태 → 수용 기준**. 우선순위 P0(기능·보안 결함) > P1(견고성·성능 회귀) > P2(위생·테스트).

### P0 — 기능·보안

**R1. 미지원 motif spec 오라우팅 방어**
- 현재: `motifs/resolver.py`에 `text`/`source_image_index` spec 분기가 없어, Gemini가 해당 spec을 방출하면 Recraft 생성 래더로 흘러 `subject: None` 프롬프트로 진입한다(glyph 파이프라인·vectorize 경로 미구현 — 5단계 과제).
- 목표: resolver 진입 시 `text` 또는 `source_image_index`를 가진 spec은 **명시적으로 거부**(해당 spec만 실패 처리 + 경고, 요청 전체는 계속) — glyph/vectorize 구현 전까지의 가드.
- 수용: 해당 spec 포함 요청 테스트에서 Recraft 호출 0회, warnings에 사유 포함.

**R2. config 검증 복원**
- 현재: `config.py`에 pydantic `Field` 제약이 전무(import조차 없음). `motif_similarity_tau` 범위 밖, `motif_max_aspect_ratio` nan/inf, DoS 가드(`max_svg_bytes`·`max_placement_instances`) 0 이하가 무검증 통과. 원본은 전부 Field로 강제하고 test_config.py로 핀.
- 목표: 원본 제약 복원 — `motif_similarity_tau: Field(ge=0, le=1)`, `motif_max_aspect_ratio: Field(gt=1.0, allow_inf_nan=False)`, seam tol(gt=0, allow_inf_nan=False), 리소스 상한류(ge=1).
- 수용: 원본 test_config.py 대응 테스트 포팅, 경계값·nan/inf 거부 확인.

**R3. sanitize XML 파서 하드닝**
- 현재: defusedxml 의존성을 제거하고 stdlib `ET` + 문자열 사전검사(`"<!DOCTYPE" in svg.upper() or "<!ENTITY"`, `render/sanitize.py:123`)로 대체. stdlib ET는 내부 엔티티를 확장하므로 billion-laughs 방어가 이 한 줄에 전적으로 의존한다(현재는 fail-closed지만 단일 방어선).
- 목표: `defusedxml.ElementTree.fromstring` 재도입(원본 방식, 감사된 파서 레벨 방어). 문자열 사전검사는 보조로 유지해도 무방.
- 수용: DOCTYPE/ENTITY/billion-laughs 다중 페이로드 거부 테스트. allowlist(태그·속성·색·href)는 현행 유지 — 원본과 바이트 동일함이 확인됐으므로 변경 금지.

**R4. `/export` 배선 완결**
- 현재: 워커에 `/export` 구현이 있으나(`worker/api/routes.py`) api의 `WorkerClient`에 export 메서드·api 라우트가 없어 도달 불가한 죽은 표면. export는 워커 범위로 명시됨(ARCHITECTURE §4).
- 목표: api에 export 라우트(소유자 인가 — 본인 세션/디자인만) + `WorkerClient.export` 추가. 토큰 과금 없음(이미 생성된 디자인의 형식 변환 — 과금 정책 변경은 5단계 /design 기획에서 재검토).
- 수용: api→worker export E2E 테스트(실 Postgres 인가 테스트 포함), `pnpm codegen` 드리프트 0.

### P1 — 견고성·성능

**R5. 어댑터 HTTP 클라이언트 수명 정리**
- 현재: `adapters/gemini.py`가 재시도 루프 **안**에서 `httpx.AsyncClient`를 매 시도 생성(연결 풀 폐기). `Adapters.aclose()`와 각 어댑터 `aclose`가 전부 no-op — lifespan 정리 배선이 죽어 있음.
- 목표: 어댑터 생성 시 클라이언트 1개(풀) 보유, `aclose`에서 실제로 닫기. Recraft·Embedding도 동일 패턴 점검.
- 수용: 재시도 백오프 계약(429/503·4회·0.5/1/2s) 기존 테스트 그대로 통과, aclose 후 클라이언트 closed 상태 검증.

**R6. 후보 프리뷰 렌더 병렬화**
- 현재: `routes.py`의 `_render_candidates`가 순차 await 루프 — 원본은 `asyncio.gather` 병렬이었음(성능 회귀).
- 목표: `asyncio.gather` 복원. 응답 내 후보 순서는 입력 순서 유지(결정론).
- 수용: 후보 순서 불변 테스트, 업로드 동시 실행 확인(mock 호출 타이밍).

**R7. 워커 에러 status 전파 (api 측)**
- 현재: api `WorkerClient._post_json`이 4xx/5xx를 전부 제네릭 `UpstreamError`로 뭉개서, 워커 422(잘못된 intent — 재시도 무의미)와 502(일시 장애)를 구분 못 하고 무조건 토큰 환불.
- 목표: status·detail을 보존한 예외로 전파, api가 422→사용자 오류(환불+422 응답), 5xx→일시 장애(환불+502 응답)로 구분. 환불 정책 자체는 유지하되 응답 코드·메시지를 구분.
- 수용: 422/502 각각의 api 응답 코드·환불 여부 테스트.

**R8. resolver DB 일시 오류 graceful degradation**
- 현재: resolver의 exact/τ 조회 예외가 미포착 → DB 흔들리면 502. 원본은 store 오류를 miss로 흡수(재생성이 content-hash upsert로 멱등이라 정합 유지).
- 목표: 조회 실패를 miss로 흡수 + 경고 로깅. upsert 실패는 흡수하지 않음(쓰기 실패는 전파).
- 수용: 조회 예외 주입 시 생성 래더로 폴백하는 테스트.

**R9. 대각 스트라이프 정규화 후처리 복원**
- 현재: 원본 `_normalize_stripes`(대각 → -45°·고정 반복수 결정론적 후처리)가 프롬프트 문구로 격하됨 — LLM 출력에 따라 intent가 달라질 수 있는 기능 회귀.
- 목표: `author_designs`의 validate 콜백 인접에 순수 함수로 복원(원본 로직 명세 기준 재작성).
- 수용: 원본 대응 단위 테스트 포팅(대각 입력 → 정규화된 intent).

**R10. api 경계 입력 선검증**
- 현재: api `DesignGenerateRequest.candidate_count`에 ge/le 없음(워커는 le=8) — 큰 값이 워커까지 가서 422→불필요한 환불 사이클.
- 목표: api 스키마에 워커와 동일한 `Field(ge=1, le=8)`.
- 수용: 경계 밖 값이 api에서 422, 워커 호출 0회. codegen 재생성 포함.

### P2 — 위생·테스트

**R11. 죽은 코드·죽은 심(seam) 정리** — 전부 삭제(5단계에서 필요 시 재도입):
- `engine/units.py`의 `nearest_dpi`(사용처 0 — `validate.py`가 동일 로직 인라인 중이므로 **호출로 교체 후 유지**하거나 삭제 중 택일, 중복만 해소).
- `adapters/recraft.py`의 `vectorize`·`_VECTORIZE_PATH`(호출자 0).
- `adapters/gemini.py` `complete(images=...)` 파라미터(수신만 하고 body 미반영).
- orphan 픽스처: `tests/fixtures/recraft_samples/`·`tests/fixtures/motif_eval/` — 단 R15에서 parity 테스트가 사용하게 되면 유지.
- `motifs/registry.py`의 테스트 폴백 전역(`_REGISTRY`/`register_motif` 등) 프로덕션 경로와 분리 여부 검토.
- 수용: `ruff`·`pyright` 통과, grep으로 잔존 참조 0.

**R12. render 모듈 경계 정리**
- 현재: `materials.py` ↔ `fabric.py` 순환 import에 private(`_apply_weave`·`_tile_to`·`_weave_image`) 월경 호출. `sanitize.py`의 `ET.register_namespace("", …)`는 프로세스 전역 부작용.
- 목표: weave 저수준 연산을 `render/weave.py`로 추출해 fabric·materials·inlay가 공용 import — 순환·private 접근 동시 해소. register_namespace는 원본 방식(`root.set("xmlns", …)`)으로 국소화.
- 수용: 순환 import 0(임포트 그래프 확인), fabric 픽셀 결정론 테스트(2회 바이트 동일) 불변.

**R13. 테스트 커버리지 보강 (원본 대비 공백)**
- 래스터 seam 가드: 원본 `validate/seamless.py`의 `edge_seam`/`tiling_seam`을 테스트 유틸로 이관, 대표 골든 일부에 렌더-후 이음새 회귀 테스트.
- normalize→motif_id parity: `recraft_samples` 픽스처 3종을 재정규화해 원본과 같은 motif_id가 나오는지 검증(스펙 §2 "같은 입력→같은 id" 계약의 핵심 검증 — 현재 0건).
- geometry 경계: 원본 test_geometry.py의 arc/bezier/reflected-control/transform 테스트 포팅.
- 엔진 엣지 케이스: snap_angle·snap_spacing·poisson torus_dist·candidates de-dup 타이브레이크 등 골든 미커버 항목 — 로직이 원본과 동일하므로 원본 테스트 대부분 재사용 가능.
- 수용: 신규 테스트 전부 통과 + 골든 27세트 불변.

**R14. 문서·명명 정정**
- `adapters/__init__.py` docstring: Gemini/Recraft 미구성은 "DryRun"이 아니라 503, 임베딩만 소프트 스킵, 진짜 DryRun은 GCS — 로 정정.
- api `KNOWN_WEAVES` 하드코딩: 워커 `render/assets/fabric/*` stem과 수동 동기화 중 — 최소한 양쪽에 상호 참조 주석, 가능하면 워커 응답으로 단일 소스화(5단계로 이연 가능).
- 수용: 문서 리뷰 통과(코드 변경 없는 항목).

**R15. 요청 스코프 임베딩 메모**
- 현재: 동일 descriptor가 한 요청 내 여러 spec에서 반복 임베딩될 수 있음(원본 LRU 캐시 미승계 — 프로세스-로컬 캐시 금지 원칙상 LRU 복원은 부적합).
- 목표: **요청 스코프** dict 메모(원칙 위반 없음)로 OpenAI 호출 절감.
- 수용: 동일 descriptor 2회 등장 요청에서 임베딩 호출 1회 테스트.

## 범위 밖 (별도 트랙 — 이 리팩토링에서 다루지 않음)

기능 신설·복원은 5단계(/design 기획)에서 결정한다. 여기 기록만 남긴다:

| 항목 | 상태 | 비고 |
|---|---|---|
| 텍스트-as-모티프(glyph) | 미구현 | worker-motifs.md §5·§7이 요구 — R1이 그전까지의 가드 |
| 이미지 입력 경로(reference_image·vectorize·업로드 하드닝) | 미구현 | 원본 image.py 계열 전체 |
| 대화형 편집 도구(swap_motif 등 툴콜) | 미구현 | 세션은 api 소유 — /design 신규 기획 소관 |
| `/palettes` 명명 프리셋 4종 | 소실 | recolor UI 필요 시 api에 복원 |
| retrieval eval 하네스·τ 캘리브레이션 로깅 | 소실 | 모티프 코퍼스가 커지면 재도입 |
| 앱 레벨 예외 핸들러(RasterError→502 등) | 부분 | 워커 500 경로 정돈 — P2 여력 시 |

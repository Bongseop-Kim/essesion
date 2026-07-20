# worker 명세 3/3 — 래스터화·finalize·API 표면·재구현 계약 (seamless-tile 추출)

원본: `app/render/{raster,fabric}.py`, `app/api/`, `app/main.py`. §5부터는 새 아키텍처(ARCHITECTURE §2·§7)에 맞춘 **재구현 결정사항** — 원본과 의도적으로 다른 부분을 명시한다.

## 1. 래스터화

- 원본: 시스템 바이너리 서브프로세스 — `rsvg-convert` 우선, 없으면 `resvg`. stdin으로 UTF-8 SVG, stdout으로 PNG.
  - rsvg-convert: `-w {W} -h {H} -f png -` / resvg: `-w {W} -h {H} - -c`
- 픽셀: `mm_to_px = round(mm/25.4·dpi)`, `max(1, ...)`. **상한 20,000px**(초과 RasterError).
- 항상 Pillow로 재인코딩해 물리 DPI 스탬프: PNG `dpi=(dpi,dpi)`, TIFF `compression="tiff_lzw"`.
- **재구현 판정**: resvg 파이썬 바인딩은 형상·색은 같지만 경계 AA의 byte parity를 충족하지 못했다. 따라서 librsvg(`rsvg-convert`) 서브프로세스를 기준선으로 유지한다(ARCHITECTURE §9.1, `docs/reviews/resvg-parity.md`). renderer 버전 고정은 finalize 결정론을 위한 남은 운영 항목이다.

## 2. fabric finalize 파이프라인

진입: `render_fabric(intent_raw, colorway_id, production_method, weave="twill-45", material_map, dpi, texture_strength, relief_strength) → PNG bytes`.

상수: TEXTURE_STRENGTH=2.4, RELIEF_STRENGTH=0.45, RELIEF_MM=0.17, RELIEF_RIM_MIN=0.25, MOTIF_WEAVE="twill-45", THREAD_PERIOD_MM=0.70, THREAD_FILL=0.82, THREAD_AA_SCALE=3, MASK_THRESHOLD=24, THREAD_RELIEF_MM=0.04, THREAD_SHADE_K=0.23.

게이트: method ∈ {print, yarn_dyed}; weave는 에셋 디렉토리 stem 목록에 존재; colorway 존재; **print는 twill-* weave만 + material_map 거부**; dpi ≤ max_dpi(1200); strength/relief 음수 거부. relief는 yarn_dyed에서만.

핵심 연산:
- **weave 타일링**: `nx=max(1,round(w/tw))` 정수 복제 후 목표 크기로 LANCZOS 리사이즈(부분 크롭 금지 — seam 유지).
- **texture 멀티플라이**: point LUT `v → clamp(255 - (255-v)·strength)` 후 `ImageChops.multiply(design, tex)`.
- **세그멘테이션**: `sorted(slot_ids)`에 HSV 최대분산 라벨색 부여 → 라벨 colorway로 compose+rasterize → `quantize(dither=NONE)` → 슬롯 인덱스 P 이미지. material_map은 슬롯 마스크별 weave 합성(영역 disjoint — 순서 무관).
- **motif thread inlay**(yarn_dyed): motif 마스크를 **3×3 타일링 후 대각 스캔, 중앙 crop**(경계 넘는 모티프의 실 위상 연속) + 실 드로잉은 3× 슈퍼샘플 후 LANCZOS 축소. 실 간격: `target=max(2.0, 0.70·dpi/25.4)`, `step=Fraction(gcd(w,h), max(1, round(gcd/target)))`(유리수 — 소수 타일서도 위상 불변), `width=max(1, min(ceil(step)-1, round(step·0.82)))`.
- **relief(슬롯 경계 emboss)**: `d=max(1, round(0.17·dpi/25.4))`; rim = `difference(idx, offset(idx, ±d, ±d))` — **wrap-around offset이라 seam-safe**(blur 금지); weave 휘도로 변조; `k=min(0.6, 0.26·relief)` white/black blend 합성.
- 출력: PNG `dpi=(dpi,dpi)`.

### compose+rasterize 재실행 지점 (재설계 대상)

원본은 rasterize를 `_render_design`(디자인)과 `_segment`(라벨) 두 함수에서만 호출하지만, 최악 경로(yarn_dyed+motif+material_map)에서 **5회** 실행:

| # | 대상 intent | colorway |
|---|---|---|
| 1 | 전체 | 실제 |
| 2 | 전체 | 라벨(세그) |
| 3 | motif-only(호스트 opacity 0) | 라벨 |
| 4 | base(모티프 제거) | 실제 |
| 5 | base(모티프 제거) | 라벨 (material_map 시) |

print=1회, yarn_dyed 모티프 없음=2회, +모티프=4회, +material_map=5회.

**재설계 지침(ARCHITECTURE §7 — 승계 금지)**: #1·#2는 이미 공유되고 있음. #3~#5는 서로 다른 SVG 문서라 단순 캐시로 못 줄인다 — **전체 intent 한 번의 세그멘테이션에서 motif/base 마스크를 파생**하는 구조로 바꿔 3회를 1~2회로 축소. 요청 내 중간 산출물(베이스 SVG·마스크 래스터)은 명시적으로 전달·재사용. 병목은 subprocess 래스터(full-tile×300dpi×5회)이지 Pillow 합성이 아님.

## 3. weave 에셋

`assets/fabric/*.png` (RGB): check, herringbone, jacquard, pindot, solid, twill-0 (1254²), twill-45 (2512², 기본+MOTIF_WEAVE). 파일명 stem으로 동적 발견(하드코딩 없음). print 허용 = `startswith("twill")`. 에셋은 결정론 입력 — 재구현 레포에 그대로 복사(이식 금지 대상은 코드지 에셋·계약이 아님) + 버전 관리.

## 4. 원본 API 표면 (참고 — 재구현 계약은 §5)

- `GET /api/v1/health`, `GET /api/v1/palettes`(프리셋 mono/navy/earth/pastel).
- `POST /api/v1/generate`: 입력 `{prompt?, reference_image?(≤12M chars), images?(≤8, 합 24M), canvas?, palette?, intent?, colorway?, seed?, candidate_count(1..8, 기본 1), session_id?, from_checkpoint?}` — 우선순위 intent > images > reference_image > prompt, 전부 없으면 422. **응답은 슬림**: `{request_id, candidates: [{id, png_url}], warnings}` — svg·repro는 generation_logs에만.
- `POST /api/v1/finalize`: `{intent, colorway_id?, production_method?, weave="twill-45", material_map?, dpi?, texture_strength?, relief_strength?}` → `{request_id, image_url?, warnings}`. 업로드 키 `fabric/{sha256(png)[:16]}.png`(content-addressed, create-only).
- `POST /api/v1/export`: `{svg(≤2M), format: png|tiff, dpi=300, width_mm(gt0), height_mm?}` → 바이너리. 클라이언트 SVG는 **scrub**(재직렬화 — 엔진 출력과 달리 신뢰 불가). 400: dpi>1200, mm>2000, px>20000.
- 세션 라우트(LangGraph): propose→select→commit→finalize, motif_candidates interrupt 게이트, confirm(generate_motif=Recraft 승인/finalize), budget(recraft 3/finalize 10). **재구현에서 세션 계층 전체 미승계** — 세션은 api 소유(design_sessions/turns), 게이트·recraft budget 의미는 api가 재현. finalize는 세션 예산 대신 계정당 24시간 쿼터로 대체(§5).
- 미들웨어: X-Request-ID(정규화: 비허용문자→`-`, 128자 캡), 인증 없음, CORS 없음. 에러 body `{detail, request_id}`.

## 5. 재구현 계약 — 새 아키텍처의 worker (의도적 차이)

**공통**: 한 코드베이스(apps/worker), 두 Cloud Run 서비스. stateless — 응답 캐시(generate_cache)·in-flight 락·fingerprint 메모 외 프로세스-로컬 상태 미승계(멱등이라 재계산 안전). obs(request_id·JSON 로깅·Sentry) 승계, api가 준 X-Request-ID 전파. 앱 인증 없음 → **경계 인증으로 대체**: generate=api OIDC, finalize=Cloud Tasks OIDC(`/tasks/finalize`)+api OIDC(`/export`). `SERVICE_MODE`가 각 이미지의 라우터 표면을 분리하며 둘 다 Cloud Run IAM상 비공개다.

api의 design intent·turn JSON은 compact UTF-8 1MB 이하이면서 NaN/Infinity 없는 JSON이어야 한다. 세션 PATCH·generate·motif generate의 seed는 DB `BIGINT`와 같은 signed int64 범위로 제한해 워커/DB 호출 전에 422로 거부한다.

**worker-generate** (1vCPU/1Gi, 동시성 높게, 외부 API 바운드):
- `POST /generate` — 무세션 계약. prompt/intent와 함께 ordered `reference_images[{image_id,url,content_type,size_bytes,purpose}]`(최대 5), exact `motif_ids`(최대 2), `palette`, `pattern_constraints`, `candidate_count`(1..8)를 받는다. 사진 purpose·색·패턴은 프롬프트 문자열로 합치지 않고 worker 엔진까지 구조적으로 전달한다. **응답은 원본과 달리 풍부하게**: 내부 서비스이므로 후보별 `{id, design_index, layout_id, source_fidelity, colorway_id, seed, svg, png_object_key}` + `{request_id, registry_version, engine_version, warnings}` 반환 — api가 세션 턴/후보 저장의 소유자라서 로그 우회 조회가 필요 없어야 한다.
- 프리뷰 PNG는 GCS `previews/{request_id}/{candidate_id}/{sha256(png)[:16]}.png`에 create-only 업로드(`if_generation_match=0`)한다(공개 assets 버킷, best-effort — 실패 시 key null+경고). 같은 내용의 기존 객체로 인한 412는 멱등 성공이며 덮어쓰지 않는다. 호출자가 `X-Request-ID`를 재사용해도 다른 PNG는 다른 키가 된다.
- `POST /motifs/candidates`(구 present_candidates) — 게이트 UI용 재사용 후보 나열. `POST /motifs/generate`(구 confirm generate_motif) — Recraft 생성 승인 실행. 예산 검사·차감은 **api가 세션 카운터(design_sessions.recraft_used)로 수행 후 호출**(worker는 검사 안 함).
- `POST /motifs/import` — 모든 user SVG를 공통 sanitize/normalize/content-hash 경계로 처리하되 worker DB에는 쓰지 않고 `{motif_id,symbol,color_slots,bbox,anchor,preview_svg}`를 반환한다. API가 Motif+사용자 소유 링크를 하나의 transaction으로 저장한다. `POST /motifs/text-preview`와 `/motifs/photo-preview`는 각각 번들 폰트 path 변환, 제한적 로컬 배경 분리+VTracer 결과를 normalized standalone SVG로 만들고 같은 import 경계로 넘긴다. CPU 작업은 thread pool에서 실행한다.
- `POST /palette/extract` — private image에서 2~5색을 결정적으로 추출. `POST /ideas` — 현재 prompt/ordered photo purposes/exact motifs/palette/pattern을 Gemini에 전달해 3~4개 편집 초안만 반환하며 intent·generation log를 만들지 않는다. helper의 rate limit·무료 정책은 api 소유다.
- seamless_generation_logs INSERT는 워커가 직접(원 동작 — system of record, SVG 재-export 근거).

**worker-finalize** (2vCPU/4Gi, 동시성 1~2, dpi 상한 600 — 엔진 기본 300):
- `POST /tasks/finalize` — Cloud Tasks 푸시 핸들러. 페이로드 `{job_id}`(+ 검증용 최소 필드). 파라미터는 DB `generation_jobs.params`가 원천(페이로드 비대·중복 방지).
- enqueue는 `finalize-{job_id}` 결정적 task name을 사용해 응답 유실 시 같은 요청을 한 번 재시도하고 `ALREADY_EXISTS`(409)를 성공으로 수렴시킨다. OIDC audience는 worker 서비스 base URL로 명시하며, `dispatchDeadline=910s`를 960초 processing lease보다 짧게 둔다. API가 최종 전달 실패로 job을 failed 처리한 경우(failed는 쿼터 카운트에서 제외 — 슬롯 자동 해제), 뒤늦게 도착한 동일 task는 worker가 렌더 전에 2xx로 ACK하되 실행하지 않는다. 반대로 enqueue 예외 시 worker가 이미 queued job을 claim했다면 조건부 실패 전이가 0건이므로 502를 내지 않고 최신 job 상태를 반환한다.
- 처리: job FOR UPDATE(queued, 정확한 `FINALIZE_TEMPORARY_FAILURE` marker의 failed, 또는 lease 960초가 지난 processing→processing, attempts+1) → render_fabric(재설계 파이프라인) → GCS `fabric/{sha256[:16]}.png` create-only 업로드(`if_generation_match=0`, 같은 내용의 기존 객체 412는 멱등 성공) → 현재 attempt만 succeeded+result{object_key}. 입력 오류·알 수 없는 failed는 terminal 2xx ACK로 재렌더하지 않는다. fresh processing은 재시도 가능한 409, late completion은 attempt 조건으로 무시, succeeded는 즉시 200. Cloud Tasks는 실패 전달을 최초 시도 포함 최대 4회(`max_attempts=4`), 10~60초 backoff로 재시도하며 `max_retry_duration`은 두지 않는다. 실패 시 원시 예외는 상세 로그에만 기록하고, HTTP 응답과 `generation_jobs.error_message`에는 안정된 공개 코드·메시지(`FINALIZE_INVALID_INPUT`, `FINALIZE_TEMPORARY_FAILURE`)만 저장한다.
- `POST /export` — 동기(작고 빠름), generate 서비스에 두는 것도 가능하나 CPU 바운드이므로 finalize 서비스 소속.
- finalize 제한·잡 생성·상태 조회는 api 소유. 제한은 세션 예산이 아니라 **계정당 24시간 윈도우 쿼터**: 생성 시 계정의 최근 24시간 finalize job 수(failed/canceled 제외)를 세어 admin_settings `design_finalize_daily_limit`(기본 10)와 비교하고, 동시 요청은 계정 단위 advisory lock으로 직렬화한다(api/domains/design/quota.py). 실패·취소·삭제된 job은 카운트에서 빠지므로 **건당 환불이 없다** — canceled 전이(사용자 취소·stale 회수)는 상태 변경만 한다.

**DB 접근**: 워커는 motifs(R/W)·seamless_generation_logs(W)·generation_jobs(W, finalize만). SQLAlchemy async + essesion-db 모델 재사용(원본 psycopg 동기 → 스택 통일, ARCHITECTURE §3). 세션·과금 테이블은 api 전용.

**과금**: 토큰 차감/환불은 api 소유(`tokens.ledger.use_tokens/refund` — work_id 멱등, 3단계 구현 완료). 어느 시점에 무엇을 과금할지는 5단계 /design 기획과 함께 확정 — worker는 과금을 모른다.

## 6. 결정론 대조 테스트 전략

- 원본 tests 44파일이 명세 역할(아래 인벤토리). 재구현 테스트는 **같은 입력 → 같은 SVG 바이트**를 두 층으로 검증:
  1. 원본의 런타임 동치 테스트 이식: 동일 입력 2회, PYTHONHASHSEED 0/1/12345 서브프로세스 교차 바이트 동일, colorway 변경 시 바이트 변경, repro 메타 전파, clone 순서 안정.
  2. **골든 대조(신규)**: 원본 seamless-tile을 로컬에서 돌려 대표 intent 세트(gallery/json 25세트 활용)의 SVG를 골든으로 추출·커밋 → 재구현 출력과 바이트 비교. 원본엔 골든 파일이 없으므로 이 추출이 4단계 첫 작업.
- fabric은 픽셀 결정론(동일 입력 2회 바이트 동일 + seam 임계값) — Pillow·렌더러 핀 전제. 원본처럼 합성 weave(64²) monkeypatch로 에셋 비의존 테스트.
- resvg 동등성 판정: 골든 intent 세트를 rsvg-convert와 resvg로 각각 래스터 → 픽셀 diff 허용치(완전 일치 우선, 불일치 시 librsvg 폴백 확정).

### 원본 테스트 인벤토리(대조 기준 카탈로그)

결정론: test_determinism(바이트 동일·프로세스 교차), test_variant_sampling(% pool), test_registry_fingerprint, test_text_motif(폰트 파이프라인 결정론), test_fabric(픽셀 결정론·seam·relief·inlay).
엔진: test_composition(2MB 캡), test_candidates(다양화), test_colorway, test_lattice, test_scatter, test_point_set, test_placement_path, test_wave, test_angle_snap, test_seamless, test_seamless_mvp(size>tile 거부), test_primitives, test_intent, test_render_svg, test_geometry, test_example_tile(오프라인 E2E).
모티프·어댑터: test_motif_gate, test_motif_facets, test_motif_resolver, test_motif_pool, test_motif_store(+_pg, live opt-in), test_recraft_client/gate/intake, test_embedding, test_gemini_retry, test_adapters, test_multi_image_chat, test_multicolor, test_retrieval_eval(τ 보정).
API·기타: test_api_generate(슬림 계약·캐시·오류 매핑), test_api_export, test_sanitize, test_health, test_config. (세션 3종 — test_sessions/test_session_persistence/test_time_travel — 은 미승계 범위.)
픽스처: tests/fixtures/recraft_samples/*.svg 3개(pig face flat, honeybee top, pelican bicycle side — 재구현 결정: 원본 8종 대신 원하는 스타일의 커스텀 샘플로 교체), motif_eval/{embeddings,labelset}.json — 재구현 레포로 복사해 대조에 사용.

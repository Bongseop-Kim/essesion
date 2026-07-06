# worker 명세 3/3 — 래스터화·finalize·API 표면·재구현 계약 (seamless-tile 추출)

원본: `app/render/{raster,fabric}.py`, `app/api/`, `app/main.py`. §5부터는 새 아키텍처(ARCHITECTURE §2·§7)에 맞춘 **재구현 결정사항** — 원본과 의도적으로 다른 부분을 명시한다.

## 1. 래스터화

- 원본: 시스템 바이너리 서브프로세스 — `rsvg-convert` 우선, 없으면 `resvg`. stdin으로 UTF-8 SVG, stdout으로 PNG.
  - rsvg-convert: `-w {W} -h {H} -f png -` / resvg: `-w {W} -h {H} - -c`
- 픽셀: `mm_to_px = round(mm/25.4·dpi)`, `max(1, ...)`. **상한 20,000px**(초과 RasterError).
- 항상 Pillow로 재인코딩해 물리 DPI 스탬프: PNG `dpi=(dpi,dpi)`, TIFF `compression="tiff_lzw"`.
- **재구현 결정**: resvg 파이썬 바인딩 인프로세스화를 우선 시도(ARCHITECTURE §3) — **rsvg-convert 대비 렌더 동등성 검증 필수**(엔진 SVG는 pattern+use만 사용하므로 동등 가능성 높음). 불일치 판정 시 librsvg 서브프로세스 폴백(컨테이너에 librsvg 설치). 어느 쪽이든 버전 핀 — finalize 결정론의 전제.

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
- `POST /api/v1/finalize`: `{intent, colorway_id?, production_method?, weave="twill-45", material_map?, dpi?, texture_strength?, relief_strength?}` → `{request_id, image_url?, warnings}`. 업로드 키 `fabric/{sha256(png)[:16]}.png`(content-addressed, upsert).
- `POST /api/v1/export`: `{svg(≤2M), format: png|tiff, dpi=300, width_mm(gt0), height_mm?}` → 바이너리. 클라이언트 SVG는 **scrub**(재직렬화 — 엔진 출력과 달리 신뢰 불가). 400: dpi>1200, mm>2000, px>20000.
- 세션 라우트(LangGraph): propose→select→commit→finalize, motif_candidates interrupt 게이트, confirm(generate_motif=Recraft 승인/finalize), budget(recraft 3/finalize 10). **재구현에서 세션 계층 전체 미승계** — 세션은 api 소유(design_sessions/turns), 게이트·budget 의미는 api가 재현.
- 미들웨어: X-Request-ID(정규화: 비허용문자→`-`, 128자 캡), 인증 없음, CORS 없음. 에러 body `{detail, request_id}`.

## 5. 재구현 계약 — 새 아키텍처의 worker (의도적 차이)

**공통**: 한 코드베이스(apps/worker), 두 Cloud Run 서비스. stateless — 응답 캐시(generate_cache)·in-flight 락·fingerprint 메모 외 프로세스-로컬 상태 미승계(멱등이라 재계산 안전). obs(request_id·JSON 로깅·Sentry) 승계, api가 준 X-Request-ID 전파. 앱 인증 없음 → **경계 인증으로 대체**: generate=api의 OIDC 동기 호출만, finalize=Cloud Tasks OIDC 푸시만(둘 다 Cloud Run invoker IAM, 스키마상 공개 아님).

**worker-generate** (1vCPU/1Gi, 동시성 높게, 외부 API 바운드):
- `POST /generate` — 원본 입력 계약 유지하되 `session_id`/`from_checkpoint` 제거(무세션). **응답은 원본과 달리 풍부하게**: 내부 서비스이므로 후보별 `{id, design_index, layout_id, source_fidelity, colorway_id, seed, svg, png_object_key}` + `{request_id, registry_version, engine_version, warnings}` 반환 — api가 세션 턴/후보 저장의 소유자라서 로그 우회 조회가 필요 없어야 한다.
- 프리뷰 PNG는 GCS `previews/{request_id}/{candidate_id}.png` 업로드(공개 assets 버킷, best-effort — 실패 시 key null+경고). Supabase Storage x-upsert → GCS 동일 키 덮어쓰기 의미론.
- `POST /motifs/candidates`(구 present_candidates) — 게이트 UI용 재사용 후보 나열. `POST /motifs/generate`(구 confirm generate_motif) — Recraft 생성 승인 실행. 예산 검사·차감은 **api가 세션 카운터(design_sessions.recraft_used)로 수행 후 호출**(worker는 검사 안 함).
- seamless_generation_logs INSERT는 워커가 직접(원 동작 — system of record, SVG 재-export 근거).

**worker-finalize** (2vCPU/4Gi, 동시성 1~2, dpi 상한 600 — 엔진 기본 300):
- `POST /tasks/finalize` — Cloud Tasks 푸시 핸들러. 페이로드 `{job_id}`(+ 검증용 최소 필드). 파라미터는 DB `generation_jobs.params`가 원천(페이로드 비대·중복 방지).
- 처리: job FOR UPDATE(queued|processing→processing, attempts+1) → render_fabric(재설계 파이프라인) → GCS `fabric/{sha256[:16]}.png` upsert → job succeeded+result{object_key}. 실패 시 failed+error 기록 후 **5xx 응답으로 Cloud Tasks 재시도 위임**(멱등: content-hash 키 + 상태 검사 — succeeded면 즉시 200).
- `POST /export` — 동기(작고 빠름), generate 서비스에 두는 것도 가능하나 CPU 바운드이므로 finalize 서비스 소속.
- finalize 예산(design_sessions.finalize_used)·잡 생성·상태 조회는 api 소유(generation_jobs — 3단계에 골격 존재).

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
픽스처: tests/fixtures/recraft_samples/*.svg 8개, motif_eval/{embeddings,labelset}.json — 재구현 레포로 복사해 대조에 사용.

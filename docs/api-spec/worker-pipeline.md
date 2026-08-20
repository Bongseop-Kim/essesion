# worker 명세 3/3 — 래스터화·finalize·API 표면

§5부터는 아키텍처 통합에 따른 **결정사항**(ARCHITECTURE §1·§6) — 소유권 경계와 과금 위치를 명시한다.

## 1. 래스터화

- 원본: 시스템 바이너리 서브프로세스 — `rsvg-convert` 우선, 없으면 `resvg`. stdin으로 UTF-8 SVG, stdout으로 PNG.
  - rsvg-convert: `-w {W} -h {H} -f png -` / resvg: `-w {W} -h {H} - -c`
- 픽셀: `mm_to_px = round(mm/25.4·dpi)`, `max(1, ...)`. **상한 20,000px**(초과 RasterError).
- 항상 Pillow로 재인코딩해 물리 DPI 스탬프: PNG `dpi=(dpi,dpi)`, TIFF `compression="tiff_lzw"`.
- **재구현 판정**: resvg 파이썬 바인딩은 형상·색은 같지만 경계 AA의 byte parity를 충족하지 못했다. 따라서 librsvg(`rsvg-convert`) 서브프로세스를 기준선으로 유지한다(ARCHITECTURE §8.1, `docs/reviews/resvg-parity.md`). renderer 버전 고정은 finalize 결정론을 위한 남은 운영 항목이다.

## 2. finalize 파이프라인 — 결정론 렌더 → AI 실사화

finalize는 두 단으로 나뉜다.

1. **결정론 렌더** (§2.1, `render/fabric.py`·`render/photoreal.py:prepare_photoreal_inputs`) — 정본 타일과
   넥타이 목업을 만든다. **결정론 계약은 이 단계에만 적용된다**(§6): 같은 입력 → 같은 바이트.
   여기서 나온 타일이 **정본**이며 주문 인수물이다.
2. **AI 실사화** (§2.2) — 1단의 렌더를 참고로 gpt-image 편집을 2회(넥타이 인페인팅 · 원단 접사)
   병렬 실행한다. 출력은 비결정론이며 고객 설득물이다.

**역할 명시**: 정본은 intent JSON + 결정론 타일이다. AI 실사 이미지는 시각적 설득·참고물이다.
직조 실현 가능성 판단은 원단 디자이너(사람)의 영역이며 시스템은 이를 자동 판정하지 않는다.

### 2.1 결정론 렌더

진입: `render_fabric(intent_raw, colorway_id, production_method, weave="twill-45", material_map, dpi, texture_strength, relief_strength) → PNG bytes`.

상수: TEXTURE_STRENGTH=2.4, RELIEF_STRENGTH=0.45, RELIEF_MM=0.17, RELIEF_RIM_MIN=0.25, MOTIF_WEAVE="twill-45", THREAD_PERIOD_MM=0.70, THREAD_FILL=0.82, THREAD_AA_SCALE=3, MASK_THRESHOLD=24, THREAD_RELIEF_MM=0.04, THREAD_SHADE_K=0.23.

게이트: method ∈ {print, yarn_dyed}; weave는 에셋 디렉토리 stem 목록에 존재; colorway 존재; **print는 twill-* weave만 + material_map 거부**; dpi ≤ max_dpi(600); strength/relief 음수 거부. relief는 yarn_dyed에서만.

핵심 연산:
- **weave 타일링**: `nx=max(1,round(w/tw))` 정수 복제 후 목표 크기로 LANCZOS 리사이즈(부분 크롭 금지 — seam 유지).
- **texture 멀티플라이**: point LUT `v → clamp(255 - (255-v)·strength)` 후 `ImageChops.multiply(design, tex)`.
- **세그멘테이션**: `sorted(slot_ids)`에 HSV 최대분산 라벨색 부여 → 라벨 colorway로 compose+rasterize → `quantize(dither=NONE)` → 슬롯 인덱스 P 이미지. material_map은 슬롯 마스크별 weave 합성(영역 disjoint — 순서 무관).
- **motif thread inlay**(yarn_dyed): 가시 모티프 마스크는 **기하학**이다 — 팔레트 슬롯을 전부 검정, 모티프 심볼의 paint를 전부 흰색(`fill="none"`은 보존)으로 치환한 마스크 문서를 같은 z-order로 compose+rasterize한 뒤 검정 위에 알파 합성해 L 마스크로 쓴다(`render/motif_mask.py`, MASK_THRESHOLD로 이진화). 위 레이어의 오클루전은 z-order상 자연히 반영되고, 색 대비에는 의존하지 않는다 — 모티프 색이 바탕색·팔레트 색과 같아도 실루엣이 사라지거나 쪼개지지 않는다(모티프 색은 팔레트와 무관하게 고정되므로 렌더 픽셀 차이 기반 마스크는 성립하지 않는다). 마스크 문서는 내부 중간물이라 paint 치환이 디자인 SVG 결정론 계약을 건드리지 않는다. 마스크를 **3×3 타일링 후 대각 스캔, 중앙 crop**(경계 넘는 모티프의 실 위상 연속)하고 실 드로잉은 3× 슈퍼샘플 후 LANCZOS 축소한다. 실 색 소스는 전체 렌더라 모티프 고유색을 보존한다. 마스크가 비어도(모티프가 완전히 가려짐) relief 경로는 그대로 탄다 — 보이지 않는 레이어의 유무가 슬롯 경계 emboss를 켜고 끄지 않는다. 실 간격: `target=max(2.0, 0.70·dpi/25.4)`, `step=Fraction(gcd(w,h), max(1, round(gcd/target)))`(유리수 — 소수 타일서도 위상 불변), `width=max(1, min(ceil(step)-1, round(step·0.82)))`.
- **relief(슬롯 경계 emboss)**: `d=max(1, round(0.17·dpi/25.4))`; rim = `difference(idx, offset(idx, ±d, ±d))` — **wrap-around offset이라 seam-safe**(blur 금지); weave 휘도로 변조; `k=min(0.6, 0.26·relief)` white/black blend 합성.
- 출력: PNG `dpi=(dpi,dpi)`.

### compose+rasterize 재실행 지점

- print: 전체 실색 1회.
- yarn_dyed, 모티프 없음: 전체 실색 1회 + `material_map` 또는 relief가 필요할 때 라벨 1회.
- yarn_dyed, 모티프 있음: 전체 실색 + base 실색 + 모티프 마스크 3회 + `material_map` 또는 relief가 필요할 때 base 라벨 1회.

최악 경로는 4회다. 마스크 렌더 1회는 색 대비 의존을 없앤 대가이며(모티프 색 고정 계약에서 픽셀 차이 마스크는 오답), 마스크와 base 라벨을 후속 합성에 재사용하므로 motif-only·슬롯 별칭 렌더는 없다.

### 2.2 AI 실사화 (gpt-image 편집 2회)

`render/photoreal.py`. `prepare_photoreal_inputs`(blocking — Pillow·rsvg, threadpool 호출)가 편집 입력을
결정론으로 만든다: 넥타이 목업(store 캔버스와 같은 구도), 원단 입력(정본 타일 3×3), 참고 이미지
(디자인 렌더 + 직조 실물 사진), 그리고 `assets/photo/tie-base.png`·`tie-base-mask.png`.

- **넥타이 실사** — 고정 베이스 사진(1024×1536)의 넥타이 영역만 마스크 인페인팅. 셔츠·매듭·조명은
  사진에서 온다. 출력 비율 **2:3**(마스크 성립 조건이라 변경 불가).
- **원단 실사** — 정본 타일 3×3을 편집 입력으로 준 접사. 출력 1024².
- 두 편집은 `asyncio.gather`로 **병렬** — p95는 편집 1회분(실측 ~45s, quality=medium)에 가깝다.
- 직조 → 프롬프트 문구 매핑은 `WEAVE_PROMPTS`. **3곳 결속**: api `KNOWN_WEAVES`(사전검증) ·
  `assets/fabric/*.png`(에셋 stem) · `WEAVE_PROMPTS`(프롬프트). 피커 옵션을 늘리거나 줄이면 세 곳을
  함께 갱신해야 하며 어느 하나만 바꾸면 무효 조합이 된다(테스트가 핀).

## 3. weave 에셋

`assets/fabric/*.png` (RGB): check, herringbone, jacquard, pindot, solid, twill-0 (1254²), twill-45 (2512², 기본+MOTIF_WEAVE). 파일명 stem으로 동적 발견(하드코딩 없음). print 허용 = `startswith("twill")`. 에셋은 결정론 입력 — 재구현 레포에 그대로 복사(이식 금지 대상은 코드지 에셋·계약이 아님) + 버전 관리.

## 4. API 표면 (소유권·인증 경계는 §5)

- `GET /api/v1/health`, `GET /api/v1/palettes`(프리셋 mono/navy/earth/pastel).
- `POST /api/v1/generate`: 입력 `{prompt?, reference_image?(≤12M chars), images?(≤8, 합 24M), canvas?, palette?, intent?, colorway?, seed?, session_id?, from_checkpoint?}` — 우선순위 intent > images > reference_image > prompt, 전부 없으면 422. **응답은 슬림**: 결과 배열 + warnings — svg·repro는 generation_logs에만. 원본의 결과 팬아웃(요청당 N개)과 그 개수 파라미터는 **미승계**다 — 재구현은 요청 1건 = 디자인 1개다(§5).
- `POST /api/v1/finalize`: `{intent, colorway_id?, production_method?, weave="twill-45", material_map?, dpi?, texture_strength?, relief_strength?}` → 삼중 산출물(§5 worker-finalize). 업로드 키는 content-addressed create-only — 실사 2장은 `fabric/{sha256(png)[:16]}.png`, 정본 타일은 `tile/{sha256(png)[:16]}.png`.
- `POST /api/v1/export`: `{svg(≤2M), format: png|tiff, dpi=300, width_mm(gt0), height_mm?}` → 바이너리. 클라이언트 SVG는 **scrub**(재직렬화 — 엔진 출력과 달리 신뢰 불가). 400: dpi>600, mm>2000, px>20000.
- 세션 라우트(LangGraph): propose→select→commit→finalize, motif_candidates interrupt 게이트, confirm(generate_motif 승인/finalize), budget(motif generation 3/finalize 10). **재구현에서 세션 계층 전체 미승계** — 세션은 api 소유(design_sessions/turns), 게이트만 api가 재현. 세션 예산은 둘 다 승계하지 않는다: finalize·모티프 생성 모두 토큰 단가가 대신하며 횟수 상한이 없다(§5).
- 미들웨어: X-Request-ID(정규화: 비허용문자→`-`, 128자 캡), 인증 없음, CORS 없음. 에러 body `{detail, request_id}`.

## 5. worker 소유권 계약

**공통**: 한 코드베이스(apps/worker), 두 Cloud Run 서비스. stateless — 응답 캐시(generate_cache)·in-flight 락·fingerprint 메모 외 프로세스-로컬 상태 미승계(멱등이라 재계산 안전). obs(request_id·JSON 로깅·Sentry) 승계, api가 준 X-Request-ID 전파. 앱 인증 없음 → **경계 인증으로 대체**: generate·finalize 모두 api OIDC. `SERVICE_MODE`가 각 이미지의 라우터 표면을 분리하며 둘 다 Cloud Run IAM상 비공개다.

api의 design intent·turn JSON은 compact UTF-8 1MB 이하이면서 NaN/Infinity 없는 JSON이어야 한다. 세션 PATCH·generate·motif generate의 seed는 DB `BIGINT`와 같은 signed int64 범위로 제한해 워커/DB 호출 전에 422로 거부한다.

**worker-generate** (1vCPU/1Gi, 동시성 높게, 외부 API 바운드):
- `POST /generate` — 무세션 worker 계약. API가 부여한 필수 `run_id`와 함께 세 입력 중 하나를 받으며 별도 mode 필드는 두지 않는다: **최초 저작**(`prompt`와 선택적 exact `motif_ids` 최대 2개), **구성 수정**(`prompt` + `conversation_context`), `intent` 재렌더(새 seed 변형 또는 `motif_slot{slot,motif_id}` 모티프 위치 교체). 최초 저작은 `palette`와 선택된 private motif, 정확도 게이트를 통과한 공개 catalog hit만 쓰며 catalog miss에서 모티프를 생성하지 않는다. `motif_slot`은 `intent`와만 함께 올 수 있고 모델을 호출하지 않는다 — 위치의 `motif_id`만 결정적으로 바꾸고(빈 위치 2는 기존 모티프 레이어에서 같은 격자·반 칸 엇갈림으로 파생, 모티프가 0개면 기본 격자 한 장을 만든다) concrete-color symbol로 재합성한다. 같은 입력은 byte-identical SVG다. `reference_images`와 `motif_provenance`는 이 계약에 없고 디자인 생성은 GPT Image를 호출하지 않는다. 선택적 `session_id`·`user_id`는 로그 표식 전용이다 — worker가 `seamless_generation_logs`에 그대로 남겨 admin이 요청자·세션 턴과 상관하며, 과금·모티프 유입 provenance가 아니다. **응답은 원본과 달리 풍부하게**: 내부 서비스이므로 `design{id, layout_id, source_fidelity, colorway_id, seed, svg, png_object_key}` + `{generation_log_id, request_id, registry_version, engine_version, intent, plan, structural_fingerprint, warnings, note, motif_intent?}` 반환 — api는 `generation_log_id == run_id`를 검증하고 공개 응답·assistant turn에는 `run_id`만 노출한다.
- **구성 수정은 patch 계약이다**(`conversation_context{current_intent, history}`). 저작 모델은 plan을 다시 쓰지 않고 `engine.patch.DesignPatchV1`(배경색·줄무늬·배치·모티프 크기·전역 배율 `scale`·팔레트 슬롯 + 고객 노출용 `note`) 하나만 채우며, 스키마에 모티프 정체성 필드가 없어 모티프 교체는 타입상 불가능하다. `scale`(0.25~4.0)은 intent의 모든 길이(mm)를 `canvas.tile_mm` 포함해 일괄 f배한다 — 균일 배율은 seamless 불변식을 보존하므로 재스냅이 걸리지 않고, 적용 후 tile은 [12, 192]mm로 누적 클램프된다. `motif_size_mm`은 배율 적용 **후** 최종 프레임의 절대값으로 적용된다("줄무늬 굵게 + 모티프는 그대로" = scale + 현재값). 모델이 scale 대신 off-grid `stripe.period_mm`으로 확대를 표현하면 period를 스냅하지 않고 tile을 같은 비율로 배율한다(줄무늬 params는 verbatim 유지 — 밴드별 값이 살아남는다). 적용은 결정론(`apply_patch`)이고 격자 셀·밴드·크기를 엔진 불변식 안으로 정규화하므로 자기수정 재시도 라운드가 없다(1콜). 정규화가 크기와 밀도 중 하나를 포기해야 하면 **크기를 지킨다** — `placement`만 담은 patch는 현재 `size_mm`이 셀에 들어가는 최대 축 개수로 낮춰 적용하고(근거·상한은 `worker-engine.md §7.1`), 두 축을 함께 담은 patch만 크기를 클램프한다. 예시 검색·모티프 해석·plan 스냅샷을 타지 않으므로 patch 런의 `plan`·`structural_fingerprint`는 null이고 스텝 복원 정본은 intent다.
- worker는 별도 LLM 호출 없이 **처리하지 못한 모티프 요청만** 감지한다: patch `out_of_scope`(`reason=motif_change`), 또는 첫 저작이 모티프 레이어 없이 끝났고(카탈로그 miss) 문장에 모티프 어휘가 있는 경우(`reason=motif_mention`). 어휘 단독으로는 켜지 않고("줄무늬"의 무늬는 지원 축이므로 어휘에서도 제외), 카탈로그로 해결된 첫 생성이나 지원 축으로 처리한 편집은 sidecar가 없다. 응답 sidecar는 `{motif_intent:{detected:true,subject?,reason}}`이며 `subject`는 사용자 원문의 무가공 명사 조각(교체 대상, `…꽃`)이고 수식어까지 집지 않도록 확신이 없으면 null이다. Plan/intent/turn/session에는 넣지 않고 현재 HTTP 응답에서만 store가 소비한다.
- 보이는 바탕/스트라이프 슬롯이 없는 지명색은 마지막 저작 시도(4번째)까지 raise로 재저작 피드백을 받고, 그래도 자리가 없으면 가능한 색만 반영한 뒤 `named_color_unplaced` 경고로 내린다 — 색 요청을 모티프 안내로 바꾸지 않는다.
- 순수 모티프 요청처럼 patch로 적용할 축이 없으면 worker는 **HTTP 200 `{status:"scope_rejected",motif_intent?}`**를 돌려준다. 디자인을 만들지 않았으므로 api는 `work_id` 멱등 환불로 과금을 되돌리고, 요청 턴을 지우고 `context_version`을 원복해 공개 응답 `200 {rejected:"motif",motif_intent?}`를 낸다 — 이력에 스텝이 남지 않는다. 모티프 요청과 바탕·줄무늬 같은 지원 축이 섞이면 지원 축만 적용하고(편집 1회 과금) 일반 성공 응답에 같은 sidecar를 싣는다. sidecar가 없는 거절은 store가 빨강 알림 1건으로 알린다.
- `warnings`는 `[{code, message}]`다. 엔진·리졸버의 영문 진단 문자열은 로그·`diagnostics`의 정본으로 남기고, `worker.warnings.WARNING_MESSAGES`에 한글 문구가 있는 코드만 응답에 담는다(코드별 1건). 매핑에 없는 경고는 고객에게 노출하지 않는다. 문구를 두는 기준은 **요청과 다른 결과가 나왔고 화면만 보고는 알 수 없는 것**(색역·모티프 드랍·색 미배치·근사 매칭)이며, 캔버스에서 보이는 자동 맞춤(크기 클램프·간격 스냅·줄 너비 축소)과 고객이 손쓸 수 없는 실패(프리뷰 업로드)는 로그·admin `warning_groups`에만 남긴다.
- 사용자 수정 가능한 422는 `{detail:{code,stage,message}}` 고정 계약이다. code는 `constraint_conflict|authoring_invalid|semantic_mismatch|intent_invalid|design_invalid`, stage는 각각 `constraints|authoring|authoring|intent|design`다. exact motif가 2개를 넘거나 strict request에 `reference_images` 같은 계약 밖 필드가 오면 worker 호출·과금 전에 일반 422로 거부한다. 원문 provider 오류는 노출하지 않고 code/stage별 한국어 메시지로 투영하며 과금 뒤 generate worker 실패는 기존과 같이 환불한다.
- 프리뷰 PNG는 GCS `previews/{request_id}/{design_id}/{sha256(png)[:16]}.png`에 create-only 업로드(`if_generation_match=0`)한다(공개 assets 버킷, best-effort — 실패 시 key null+경고). 같은 내용의 기존 객체로 인한 412는 멱등 성공이며 덮어쓰지 않는다. 호출자가 `X-Request-ID`를 재사용해도 다른 PNG는 다른 키가 된다.
- `POST /motifs/candidates` — 최대 200자의 문장을 그대로 카탈로그 검색에 사용해 재사용 후보를 나열한다(모델·GPT Image 미호출 → 무과금). api의 `motifs/search`가 이걸 부른다. 여기서 "후보"는 카탈로그 매칭 후보이며 폐기된 디자인 후보와 무관하다. `POST /motifs/generate` — 사용자가 검색 결과와 별개로 새로 만들기를 명시적으로 고를 때 GPT Image 생성을 실행한다. 과금·차단은 **api가 토큰 선차감으로 수행 후 호출**(worker는 검사 안 함, 횟수 상한 없음).
- `POST /motifs/import` — 모든 user SVG를 공통 sanitize/normalize/content-hash 경계로 처리하되 worker DB에는 쓰지 않고 `{motif_id,symbol,bbox,anchor,preview_svg}`를 반환한다. API가 Motif+사용자 소유 링크를 하나의 transaction으로 저장한다. `POST /motifs/text-preview`와 `/motifs/photo-preview`는 각각 번들 폰트 path 변환, 제한적 로컬 배경 분리+VTracer 결과를 concrete-color standalone SVG로 만들고 같은 import 경계로 넘긴다. CPU 작업은 thread pool에서 실행한다.
- `POST /ideas` — 현재 prompt와 exact motifs를 LLM에 전달해 3~4개 편집 초안만 반환하며 이미지·intent·generation log를 만들지 않는다. helper의 rate limit·무료 정책은 api 소유다.
- resolve가 끝난 모티프는 concrete-color symbol을 그대로 사용한다. Plan·intent·구성 patch는 모티프 색을 bind하거나 재색하지 않는다.
- seamless_generation_logs INSERT는 워커가 직접(원 동작 — system of record, SVG 재-export 근거). `diagnostics` JSONB에는 mode(`prompt|patch|variation|motif_slot`), 모델·prompt revision, 저작 시도, 적용한 patch, 일회성 `motif_intent` 판정, 단계별 시간, 모티프별 exact/catalog 결과와 실패 code/stage/provider/operation/reason/status를 저장한다. 디자인 생성 진단에는 GPT Image 호출·참고 이미지 바이트 관측값이 없다. `scope_rejected`도 결과가 없는 시도이므로 `status=error, error_type=ScopeRejected` 한 행을 남긴다(과금은 api가 되돌린다). worker JSON 로그에도 같은 안전한 provider 식별 필드만 넣으며 provider 응답·인증 header·프롬프트 원문·내부 예외는 넣지 않는다.

**worker-finalize** (2vCPU/4Gi, 동시성 1~2, dpi 상한 600 — 엔진 기본 300):
- `POST /finalize` — `/export`와 같은 급의 **stateless 동기 엔드포인트**. 입력은 `GenerationJob.params`와 동일 형태(`{intent, colorway_id?, production_method?, dpi?, weave?, material_map?, texture_strength?, relief_strength?}`, strict — 계약 밖 필드 422), 값 검증은 render_fabric이 최종 권위. 처리: 결정론 렌더(§2.1) → AI 편집 2회 병렬(§2.2) → 세 PNG를 content-addressed create-only 업로드(`if_generation_match=0`, 같은 내용의 기존 객체 412는 멱등 성공) → `{tie_object_key, fabric_object_key, tile_object_key, object_key}` 반환. `object_key`는 `fabric_object_key`의 **레거시 별칭**(컷오버 전 표시 경로 호환). DB claim·FOR UPDATE·lease 없음 — 잡 상태는 api가 소유한다.
  - api는 네 키를 `GenerationJob.result`에 그대로 보관하고 `GenerationJobOut`에 `tie_url`/`fabric_url`/`tile_url`(+레거시 `result_url`)로 공개한다. 컷오버 전 행은 `object_key`만 있어 세 URL이 null이고 `result_url`만 채워진다 — store는 그 경우 `result_url`로 폴백한다.
  - **AI 편집 단계만 우회**(결정론 타일을 `object_key`로 직반환)하면 구형 동작으로 1커밋 복귀한다. api는 `object_key`만 있는 응답도 그대로 받아들이므로 롤백 시 스키마 변경이 필요 없다.
  - 주문 인수물: api의 order-reference 복사는 **넥타이 실사 + 정본 타일 2장**을 `uploads/`로 옮긴다(원단 실사는 고객 설득용이라 싣지 않는다). 파일 개수·경로는 내부 계약이며 화면의 첨부 카드는 디자인 1개당 1개다.
- 실패 계약: 영구 실패(`FabricError`/`IntentInvalid`/`RasterLimitError` — 같은 입력은 같은 실패)는 422 + 공개 코드 `FINALIZE_INVALID_INPUT`, 일시 실패는 5xx — api가 UpstreamError로 변환해 과금을 환불한다. 원시 예외는 워커 로그에만 남긴다.
- `POST /export` — 동기(작고 빠름), generate 서비스에 두는 것도 가능하나 CPU 바운드이므로 finalize 서비스 소속.
- finalize 과금·완성본 레코드는 api 소유(§5 과금). `create_finalize_job`은 provenance 검증 → `design_finalize_cost` 토큰 차지 → worker 동기 호출(`_shielded` — 클라 끊겨도 완주, generate와 동일) → 성공 시 `GenerationJob(status="succeeded")` 한 번에 INSERT. 실패 시 행을 남기지 않고 work_id 멱등 환불 — **보관함(`GET /design/jobs`)에는 성공만 존재한다**. `queued`/`processing` 상태와 잡 큐·폴링·취소·stale 회수 기계는 동기 전환으로 제거됐다.

**DB 접근**: 워커는 motifs(R/W)·seamless_generation_logs(W). SQLAlchemy async + essesion-db 모델 재사용(원본 psycopg 동기 → 스택 통일, ARCHITECTURE §2). 세션·과금·잡 테이블은 api 전용.

**과금**: 토큰 차감/환불은 api 소유(`tokens.ledger.use_tokens/refund` — work_id 멱등). worker는 과금을 모른다. 확정된 단가: 첫 생성 = `admin_settings.design_token_cost_openai_render_standard`, 구성 수정(patch) = `admin_settings.design_edit_cost`, 모티프 검색·교체 = 0, 모티프 생성 = `admin_settings.design_motif_generate_cost`, 실사화 = `admin_settings.design_finalize_cost`, `scope_rejected`는 멱등 환불.

## 6. 결정론 회귀 테스트

결정론 계약은 두 층으로 지킨다.

1. **골든 대조** — `apps/worker/tests/golden/`(intent 25세트 + SVG 27개 + 참조 모티프 덤프)이 채점표다. `golden_helpers.py`가 로드하며 엔진 출력과 바이트 비교한다. **엔진 변경으로 골든이 깨지면 골든을 덮어쓰기 전에 의도한 변경인지 판정할 것** — 무단 재생성은 계약 파기다.
2. **런타임 동치** — 동일 입력 2회, PYTHONHASHSEED 0/1/12345 서브프로세스 교차 바이트 동일, colorway 변경 시 바이트 변경, repro 메타 전파, clone 순서 안정.

결정론 계약은 **§2.1 결정론 렌더 단계까지만** 적용된다. fabric·`prepare_photoreal_inputs`는 픽셀 결정론(동일 입력 2회 바이트 동일 + seam 임계값) — Pillow·렌더러 핀 전제. §2.2 AI 편집 출력은 비결정론이므로 골든·런타임 동치 대상이 아니다. 합성 weave(64²) monkeypatch로 에셋 비의존 테스트. 래스터라이저를 교체할 때는 골든 intent 세트를 양쪽으로 래스터해 픽셀 diff로 판정한다(완전 일치 우선, 불일치 시 librsvg 폴백).

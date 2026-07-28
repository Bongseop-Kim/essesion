# worker 명세 2/3 — 모티프 시스템 + 외부 API (seamless-tile 추출)

원본: `app/motifs/`, `app/adapters/`. 모티프 검색 래더·content-hash·프롬프트는 기능 명세의 일부 — 원문 보존. DB 스키마는 새 모노레포의 `motifs` 테이블과 Vertex `vector(3072)` 한 종류만 사용한다.

## 1. 모티프 데이터 모델·정규화

`MotifDef{id, symbol, bbox_mm, anchor, color_slots=("s0",), slot_colors=None, slot_labels=None, slot_parts=None}`:
- symbol = `<symbol id="motif-{id}" overflow="visible">{geometry}</symbol>` — **viewBox 없음**(use transform이 mm 1:1). geometry는 `<g transform="translate(tx ty) scale(s)">…</g>` 래핑 1개.
- 정규화된 모티프는 항상 bbox `(-0.5,-0.5,0.5,0.5)`, anchor `(0,0)` — tight bbox의 중심을 원점, 긴 변을 1.0으로: `scale=1/extent, tx=-(bx+bw/2)·scale, ty=-(by+bh/2)·scale`.
- 거부: extent≤0, 0폭 축, `extent/min_side > 20.0`(aspect 상한), viewBox/치수 없음, drawable 없음(defs 밖 path/polygon/…), filter/raster image/외부 href(화이트리스트 밖).
- `slot_colors`는 멀티슬롯 원색을 `color_slots`와 인덱스 정렬한 기본 colorway다. `slot_labels`는 같은 순서의 내부 의미 역할(`primary|secondary|accent|outline|detail|background`)이며 부위명이 없는 재색 정렬에 쓴다. `slot_parts`는 같은 순서의 40자 이하 짧은 부위명이며 Gemini 재색 안내와 admin 표시에 쓴다. parts는 전부 유효하고 슬롯 수와 일치할 때만 배열로 취급하며, 단일슬롯·레거시·라벨링 실패는 NULL이다. 세 필드는 geometry/content-hash와 무관하다.
- `ingested_user_id`·`ingested_session_id`는 Recraft 행의 최초 유입 감사 provenance다. content-hash conflict와 카탈로그 hit는 이를 덮지 않고, 사용자·세션 삭제 시 `ON DELETE SET NULL`이다. 공개 모티프의 소유권 필드는 아니다.

**정규화 파이프라인** `normalize_motif_svg`: sanitize 파싱·검증 → 프레임 검증 → tight bbox 프레이밍 → (선택) 색 양자화 → slotify → `<g>` 래핑+content-hash id → (선택) render gate.

- **공용 intake 상한**: UTF-8 2MB, node 2,048, nesting depth 64, path 1,024, path command 50,000, geometry token 200,000. XML allowlist 검증 직후, geometry 계산과 render gate 전에 실패시킨다. implicit path 좌표 반복으로 command-letter 상한을 우회하지 못하도록 path 숫자와 polygon/polyline `points` 숫자를 하나의 token budget으로 센다. SVG 파일, 텍스트 preview, 사진 vectorize 결과가 모두 이 경계를 공유한다. 방어적 `RecursionError`도 route에서 422로 변환한다.
- **색 양자화**(max_color_slots=6): RGB 유클리드 최근접 두 hex를 반복 융합(동점은 hex 사전순, 작은 hex가 대표). currentColor는 병합 불가 — 이것 때문에 예산 초과면 ValueError(재생성 트리거).
- **slotify**: distinct 색을 DFS(fill이 stroke보다 먼저) 최초 등장순으로 수집(`_norm_color`: strip+lower, none/url()은 슬롯 없음, currentColor는 concrete 취급). ≤1색 → 전부 currentColor 치환, `("s0",)`. ≥2색 → 각 색을 `s0,s1,...` 토큰으로 속성에 기록.
- **render gate**(librsvg 있으면): 10mm/300dpi 고정 타일, margin 10%로 렌더 — 실패 또는 edge_seam > 2.0이면 거부. 모티프는 mutate하지 않음.

## 2. content-hash id

```
geometry = f'<g transform="translate({fmt(tx)} {fmt(ty)}) scale({fmt(scale)})">{inner}</g>'
motif_id = id_prefix + "-" + sha256(geometry.encode()).hexdigest()[:12]
```
- 해시 입력 = slotify **후**의 geometry(심볼 래퍼 제외) → colorway-agnostic: 같은 도형은 색·`slot_colors`·`slot_labels`·`slot_parts`·provenance와 무관하게 같은 id다(캐시 히트·upsert 멱등의 근거). provider/seed 경로는 `recraft-`, private user import는 `upload-` prefix를 쓴다.

## 3. Recraft 연동

- base `https://external.api.recraft.ai/v1`; generate `POST /images/generations`, vectorize `POST /images/vectorize`(multipart png). 헤더 `Authorization: Bearer {key}`. 타임아웃 **120s**. HTTP 재시도 없음.
- generate payload: `{prompt, model: "recraftv4_1_vector", response_format: "b64_json", n: 1, size: "1024x1024", controls?: {colors: [{rgb: [r,g,b]}, ...]}, random_seed?: seed}` — style은 빈 문자열이면 **생략**(substyle 파라미터 없음). `controls.colors`에는 디자인 팔레트 순서를 유지하고 `random_seed=0`도 생략하지 않는다. V4.1 vector에서 지원되지 않는 `negative_prompt`는 보내지 않고 금지 조건을 주 prompt에 둔다. 응답 URL을 따라가는 2차 요청은 허용하지 않는다(SSRF 경로 제거).
- 응답: `b64_json`만 수용하며 strict base64로 디코딩한다. 디코딩 전 인코딩 길이와 디코딩 후 SVG 바이트를 모두 `max_svg_bytes`로 제한하고, `<svg` 미포함이면 오류.
- **프롬프트**(spec dict → 개행 join — 재구현 결정 반영, 아래 gradient 항 참조):
```
Draw ONE single, isolated object as one inline SVG. Output ONLY the SVG markup — no markdown, no prose, no <?xml?> prolog.
CRITICAL: exactly ONE centered subject that FILLS the frame. It must NOT be a pattern, NOT repeated, NOT scattered or tiled, NOT a scene, collage or grid.
NO background: do not draw any background rectangle, border or backdrop — the object sits on a transparent canvas.
The root <svg> MUST have a viewBox. Multiple solid colors are allowed; use flat vector <path>/<g> shapes with solid fills. Use a distinct flat color for each distinct visual part, and do not reuse one color for unrelated parts. Do NOT use raster <image>, <text>, gradients, textures, photorealistic shading or filters.
subject: {subject}
scope: {scope}
```
  + view/expression/style/description 존재 시 `{key}: {value}` append. 게이트 실패 재프롬프트(1회만): `"Your previous SVG was rejected. Fix exactly these:\n- {error}"`.
- **적합성 게이트/정리**: gradient 사용은 변환하지 않고 오류(재프롬프트 1회), rgb()→#hex, style 속성 페인트 hoist, 비허용 속성 drop, filter/clipPath/mask/text·메타 drop, **전면 배경 도형 제거**(선두 filled shape 면적 ≥ viewBox 90%, 최소 1 drawable 유지), raster image → 오류. 깨끗한 SVG는 무변경 반환(id 계약 유지). 게이트 2회 실패 → RecraftError(502). (재구현 결정: 원본은 gradient를 첫 stop 색으로 평탄화하고 gradient defs를 drop — gradient 미사용 방침에 따라 평탄화 대신 오류로 대체, 프롬프트도 "Avoid ... (they get flattened)"에서 "Do NOT use ..." 금지형으로 조정.)
- vectorize: 재프롬프트 없음(이미지 고정), 실패 시 해당 layer만 drop+경고. 입력 한도: 5MB/256~4096px/16M픽셀.
- 캐시(결정론 freeze): spec canonical → motif_id, 이미지 sha256 → motif_id. (재구현: 프로세스-로컬 캐시 미승계 — content-hash id + DB upsert가 같은 멱등성 제공.)

## 4. 임베딩 (Vertex AI)

- `gemini-embedding-001`, 3072차원, ADC + Google Gen AI SDK를 사용한다. 검색 query는 `RETRIEVAL_QUERY`, motif/authoring example 문서는 `RETRIEVAL_DOCUMENT` task type이며 요청 내 같은 `(text, task_type)`만 task memo로 합친다. 프로세스 전역 캐시는 없다.
- **임베딩 텍스트**: `subject, description, style, view, expression, tags`의 비어 있지 않은 값을 순서대로 합친다. `scope`는 검색 필터·문서 모두에서 제외한다.
- 미설정·호출 실패는 exact subject/tag token 검색만 남기는 fail-soft다. 관련성 근거 없이 카탈로그를 재사용하지 않는다.
- 시드한 공개 NULL 행은 `apps/worker/scripts/index_motif_embeddings.py --confirm-live`가 초기 인덱싱한다. GCP project/ADC·확인 플래그가 없으면 실행을 거부하고 `user_upload`은 제외한다.

## 5. 검색·재사용 래더 (resolver)

순서: **원문 retrieval → 정확도 게이트 → Gemini grounding → semantic retrieval → generate-on-miss**.

1. prompt 원문의 NFC/casefold token과 공개 motif subject/tag의 완전 token 일치를 ID 순으로 모은다.
2. 공개 카탈로그 전체 pgvector cosine top-5를 구하고 **τ=0.84** 이상만 더한다. 동점은 lowest ID다. `scope`는 필터로 사용하지 않고 `user_upload`은 항상 제외한다.
3. 후보는 실제 ID 없이 `catalog_ref`, subject, description, style로 Gemini에 제공한다. compiler만 ref→ID를 변환한다.
4. 후보가 있는데 prompt-derived semantic motif를 만들거나 후보를 모두 무시한 plan은 거부한다. 한 번 재저작 후에도 같으면 `semantic_mismatch`다.
5. 후보가 없는 텍스트 경로에서 Gemini는 사용자가 반복 모티프로 명시한 구체적 개별 도형만 원문 그대로 `generate` source 한 건으로 선언할 수 있다. 무드·색·재질만인 요청은 모티프를 만들지 않는다. 사진 유래 semantic spec과 `generate` spec은 같은 exact/vector 게이트를 다시 거치고 miss에서만 Recraft를 호출한다.
6. 이미지 index가 없는 generate-origin facet에서 injection 의심 문자열이 검출되면 생성 전에 거부한다. reference-origin은 기존 sanitize+관측 경계를 유지한다. embedding 없음·장애·nearest read 실패 시 lowest-ID fallback 없이 Recraft로 간다.
7. 자동 `/generate` 한 요청은 모든 authored design과 적합성 재시도를 합쳐 실제 Recraft provider 호출을 기본 2회(`motif_generate_per_request_limit`)로 제한한다. 초과한 best-effort motif layer는 host cascade와 함께 drop하고 경고를 남기며, 비모티프 layer가 남으면 partial success다.
8. **변이 선택**: `variant_group = sha256(canonical_json({"v":2, "subject", "scope"}))[:16]`; hit pool은 seed로 안정 선택한다.
9. `present_candidates`는 같은 신뢰도 게이트를 쓰고 Recraft를 호출하거나 관련 없는 ID로 채우지 않는다.

store 읽기 오류는 해당 읽기만 savepoint로 rollback한 뒤 miss로 흡수한다. 같은 요청에서 앞서
upsert한 미커밋 motif까지 전체 rollback하지 않으며, 쓰기 오류는 그대로 전파한다.

상위 오케스트레이션은 Gemini의 일반 `motif_specs`를 motif layer에 매칭한다. 사용자 텍스트·사진 모티프는 이 생성 경로에 암묵적으로 섞지 않고 §7의 명시적 preview→import 경로에서 먼저 exact private motif로 만든다. 개별 일반 모티프의 generate 예산 소진·generate-origin facet 거부는 그 layer만 drop(+host cascade drop, fixpoint)하고 생존자와 함께 partial 200 + 경고로 반환한다. 그 밖의 resolver 실패가 모든 plan을 없애면 502다.

Recraft miss가 신규 content-hash 행을 insert했을 때만 최초 유입 사용자·세션 provenance를 저장한다. 신규 멀티슬롯이면 원색 standalone preview를 20mm PNG로 threadpool rasterize하고 Gemini에 고정 길이 schema로 한 번 전달해 `slot_labels`와 슬롯 순서의 짧은 `slot_parts`를 함께 만든다. 같은 색을 공유하는 부위는 `부리·안장`처럼 하나의 part로 묶는다. labels가 유효하면 parts만 실패해도 labels는 보존하지만 parts는 부분 배열을 저장하지 않고 NULL로 fail-soft한다. 렌더러·비전·schema·안전 검사 실패는 모티프 저장을 되돌리지 않는다. 단일슬롯과 catalog/content-hash hit의 라벨링 호출은 0회다.

## 6. Gemini DesignPlan v3 저작

- 모델 `gemini-2.5-flash-lite`, ADC + Google Gen AI SDK, temperature 0.7, `response_mime_type="application/json"`을 사용한다. v3는 Pydantic `DesignPlansV3` 타입 자체를 `response_schema`로 전달하고 SDK parsed 결과를 우선 사용한다. 429/503은 0.5/1/2s 지수 백오프로 최대 4회 재시도하고 그 외 provider 오류는 502급이다.
- Gemini는 전체 엔진 intent를 직접 만들지 않는다. v3 structured output은 2~4 plan, 2~8 HEX palette, 최대 2개 discriminated motif source(`input`/verified `catalog`/`reference`/catalog-empty text `generate`), 최대 5개 stripe/motif layer와 normalized placement(lattice, Poisson/sateen scatter, closed straight/wave path, 고정 point template)만 가진다. engine ID·mm·SVG·임의 point 좌표는 schema 밖이다.
- worker compiler가 plan을 48mm/300dpi intent로 결정적으로 변환한다. palette/colorway/layer ID, tile-commensurate geometry, motif placeholder/spec/color-slot sidecar를 코드가 만들고 엔진 경계가 다시 검증한다. palette를 제외한 geometry/topology fingerprint가 같은 plan은 중복이며 유효하고 서로 다른 plan이 2개 미만이면 오류를 붙여 1회 재요청한다.
- exact private motif의 실제 ID는 Gemini에 전달하지 않고 1-based input 순번만 요구한다. verified catalog, exact input, `current_motif_N`에는 authoritative `slot_count`와, 전부 유효할 때만 슬롯 원 순서의 `slot_parts`를 동일한 untrusted metadata 블록으로 노출한다. 모든 exact 및 `purpose=motif` reference는 각 plan에 정확히 한 번 있어야 하고 verified catalog는 `catalog_ref`만 노출한다. `generate`는 catalog candidate가 없는 분기에서만 허용하고 compiler가 best-effort semantic spec으로 바꾼다. compiler만 ref→ID를 변환한다. 멀티슬롯의 `color_indices` 생략은 원색 보존, 명시는 재색 신호이며 fixed palette에서는 생략을 거부한다. 재색할 때 배열 길이는 정확히 `slot_count`이고 i번째 인덱스는 i번째 슬롯·부위에 대응한다.
- `gallery-v1`은 빈 DB용 소량 starter Plan v3 시드이며 골든 파일과 독립적이다. 컴파일러 회귀는 테스트 픽스처의 ID-파일명 규약으로 검증한다. 실제 RAG는 `authoring_examples`의 현재 contract·embedding model에 맞는 active 시범만 검색한다. query top-25를 motif 수/배치 제약으로 거른 상위 8개에서 family 다양성을 우선해 최대 3개를 prompt에 넣는다. retrieval 장애·빈 active 집합은 시범 없이 계속하는 fail-soft다.
- 모든 요청은 Plan v3 저작 경로만 사용한다. contract/compiler/prompt/example revision, retrieval 상태·선택 ID/유사도, fingerprint는 generation diagnostics와 intent log에 남긴다.
- live 평가는 `eval_authoring.py --confirm-live`의 label 30-case corpus로 schema/compiler 성공률, 구조 다양성, retrieval expected-family recall, 시도 수와 latency를 측정한다. prompt/provider 원문은 출력·저장하지 않고 CI는 유료 호출을 실행하지 않는다. 정본·동기화·승격 절차는 `docs/specs/authoring-plan-v3.md`다.
- 이미지: private signed URL을 allowlist(`storage.googleapis.com`, emulator)로만 읽고 redirect를 따르지 않는다. 선언 길이와 실제 길이를 일치 확인하며 장당 10MB, 최대 5장, 합계 50MB다. decode→실제 MIME 대조→20M픽셀 검증→EXIF 방향 적용→최대 2048px 축소→메타데이터 없는 JPEG로 재인코딩한다. Gemini Part 순서는 요청 이미지 순서 그대로 먼저, 텍스트가 마지막이다.
- 사진별 `purpose ∈ {auto,color_mood,motif,composition}`도 같은 순서로 전달한다. 명시 목적은 해당 역할로만 쓰도록 binding하며, `auto`에서만 사용자 문맥으로 역할을 추론한다. generation attachment에는 `(image_id, ordinal, purpose)`를 기록한다.
- exact private motif id는 최대 2개 모두 compiler와 resolver에 전달하되 Gemini에는 ID를 공개하지 않는다. compiler가 모든 exact motif를 intent에 넣고 worker가 누락을 검증한다. user-upload source는 exact id 조회로만 렌더되고 일반 facet/embedding/variant 검색 및 registry fingerprint에서 제외된다.

### 6.1 하이브리드 모티프 색 배정

resolver가 concrete ID와 metadata를 확정한 뒤 네트워크 없이 다음 순수 규칙을 적용한다.

1. 단일슬롯은 plan 첫 색 또는 배경을 제외한 첫 팔레트 색을 쓴다. 선택색 HEX가 실제 ground HEX와 같으면 선언된 팔레트 전순서에서 다음 구분색을 찾고, 전부 같은 축퇴 팔레트면 원 선택을 유지한다.
2. 멀티슬롯에서 `color_indices`가 생략됐고 `slot_colors`가 있으며 palette가 non-fixed면 `{color_slot: original HEX}`를 그대로 보존한다.
3. 그 밖에는 plan 색 또는 배경 제외 팔레트 색을 모듈로 배정한다. 명시한 색 배열 길이가 실제 슬롯 수와 다르면 조용히 반복하지 않고 요청을 거부한다. 유효한 `slot_parts`가 있으면 Gemini에 노출한 슬롯 원 순서를 유지한다. parts가 없고 유효한 `slot_labels`가 있으면 `primary → secondary → accent → outline → detail → background` rank로 슬롯을 먼저 정렬하며, 둘 다 NULL·길이 불일치·잘못된 값이면 기존 DFS 위치 순서를 쓴다.

리터럴 HEX는 motif layer의 `params.colors`에서만 허용하고 palette slot처럼 안전하게 resolve한다. 따라서 같은 resolved intent+seed의 SVG 바이트 결정론은 원색 보존·라벨 재색·레거시 fallback 모두에서 유지된다. 요청 핫패스 색 배정은 LLM·DB write·provider 호출을 하지 않는다.

## 7. 텍스트-as-모티프

`POST /motifs/text-preview`는 `{text,font_id,font_weight,letter_spacing}`을 받아 path-only SVG를 반환한다.

- font id는 `nanum-gothic`, `nanum-myeongjo`, weight는 400/700이다. 네 static TTF를 worker wheel에 포함하므로 시스템 폰트·브라우저에 의존하지 않는다. 원본과 SHA-256은 `apps/worker/src/worker/motifs/fonts/README.md`, 라이선스 전문은 같은 디렉터리의 OFL 파일에 고정한다(SIL OFL 1.1).
- 입력은 NFC로 정규화하며 최대 20자다. 허용 문자는 한글 완성형, 호환 자모, 영문, 숫자, 공백이다. 자간은 -0.2~1.0em, 미지원 glyph는 명시적으로 거부한다.
- fontTools `SVGPathPen`으로 서버에서 변환하고 최종 SVG에는 `<text>`, font URL, 외부 href가 없다. path command 20,000개와 SVG 2MB 상한을 둔다.
- 동일 NFC text+font id+weight+letter spacing은 동일 SVG 바이트를 만들고, 공통 `normalize_motif_svg`에 통과시키면 동일 content-hash motif id가 된다. preview 응답은 normalized standalone SVG이며 그대로 `/motifs/import`에 넣어도 같은 id·symbol·slot을 회복한다.

### 7.1 사진→SVG와 팔레트 추출

`POST /motifs/photo-preview`는 새 업로드 또는 기존 참고 사진의 private signed URL을 재사용한다. JPEG/PNG/WebP 실제 MIME, 장당 10MB, 20M픽셀을 확인하고 최대 1024px로 축소한 뒤 CPU 처리를 thread pool에서 실행한다.

- 배경 제거는 별도 provider·대형 모델·GPU 없이 Pillow로 수행한다. 기존 alpha를 우선 사용하고, 아니면 테두리 median 색을 구한 뒤 유사색의 4-neighbor border-connected 영역만 제거한다. 균일한 테두리 confidence 0.55 미만, 빈 피사체, 프레임을 거의 채운 피사체는 명시 오류다. 복잡한 장면을 성공처럼 보이는 hidden fallback은 없다.
- 색상 수(1~6)와 단순화 강도(low/medium/high)를 결정적으로 양자화한 뒤 로컬 VTracer로 path화한다. 원본/중간 파일은 worker가 저장하지 않고 결과 SVG만 기존 private motif import 경계로 전달한다.
- 상한: vector SVG/processed PNG 각 2MB, node 2,048, path 1,024, path command 50,000, 출력 색상은 요청 color_count 이하. sanitizer/normalize도 저장 전에 다시 적용된다.
- 응답은 `{svg,processed_preview_base64,background_confidence,warnings}`. 동일 입력과 옵션은 동일 SVG/PNG 바이트를 만든다. 배경 포함은 `remove_background=false`로 명시하며 실패 시 자동 전환하지 않는다.

`POST /motifs/import`는 DB를 쓰지 않는 pure normalization 경계다. `{motif_id,symbol,color_slots,bbox,anchor,preview_svg}`를 반환하고, API가 quota 확인과 함께 `Motif(source=user_upload, embedding=null)` 및 사용자 소유 링크를 하나의 transaction에 저장한다. 따라서 API transaction 실패가 ownerless private motif를 남기지 않는다. `preview_svg`는 내부 slot token을 안전한 concrete paint로 표현한 standalone 문서이며 재-import해도 같은 content-hash identity와 geometry를 얻는다.

`POST /palette/extract`는 같은 private fetch/MIME/pixel 경계를 재사용하고 2~5개 대표색을 population 순으로 반환한다. Pillow MEDIANCUT, dither 없음, uppercase `#RRGGBB`, 중복 제거라 반복 호출이 결정적이다. 서로 다른 대표색이 2개 미만이면 사용자가 직접 고르도록 422를 반환한다.

### 7.2 문맥 기반 아이디어

`POST /ideas`는 기존 prompt, ordered `(reference image,purpose)`, 최대 2개의 exact motif 문맥, palette, pattern constraints와 count(3 또는 4)를 받는다. worker 내부에서는 id/name 순서를 검증하지만 Gemini 프롬프트에는 ordinal과 human name만 보내고 private content-hash id는 공개하지 않는다. 이미지는 생성과 같은 순서/전처리를 쓴다. 결과는 서로 다른 180자 이하 문장 정확히 count개인 JSON만 수용하며 형식 오류는 한 번 constrained retry 후 502다.

이 경로는 intent·candidate·generation log를 만들지 않고 Recraft도 호출하지 않는다. 과금과 사용자별 rate limit은 API 경계가 소유하며 worker에는 토큰 차감 로직이 없다. 프론트가 provider를 직접 호출하지 않는다.

## 8. registry fingerprint

- `registry_version_for(store)`: 풀 비면 `REGISTRY_VERSION("0.1.0")`, 아니면 `f"{REGISTRY_VERSION}+pool.{hex8}"`, hex8 = `format(stable_hash("\n".join(sorted(all_ids))), "064x")[:8]`.
- 메모: (store identity, epoch) — epoch은 register/delete마다 +1. store 조회 실패 시 baseline 반환하되 **캐시하지 않음**.
- REGISTRY_VERSION 수동 bump는 스키마/포맷 변경 시에만 — 풀 추적은 fingerprint 몫.

## 9. 시드 카탈로그

`scripts/seed_head_catalog.py`: 모티프 5개(flower/whole ×3, leaf/whole ×2, 전부 style=flat, source="seed", 단색 → s0) — variant pool ≥ 2 데모용. 멱등(content-hash id + ON CONFLICT DO NOTHING). 재구현 시 새 모노레포 시드로 이식.

재구현 확장(원본 외): `apps/worker/scripts/seed_motifs.py`가 위 5개에 더해 `motif_assets/*.svg`(Flaticon UIcons regular-rounded 웹폰트에서 추출한 글리프 90개 — 동물·마린·하늘·문장·과일·취미·식물, subject=파일명 첫 토큰, style=outline)를 기본 모티프로 시드한다. 파일명 stem/token은 tags에도 넣는다. 시드 뒤 `index_motif_embeddings.py --confirm-live`를 실행하고 출력의 `embedded=total`을 배포 gate로 확인한다. 이어 `backfill_slot_labels.py --confirm-live`로 공개 멀티슬롯의 NULL `slot_labels` 또는 `slot_parts`를 채우고 `eligible=<n>; updated=<n>`을 기록한다. 두 컬럼은 각각 NULL일 때만 조건부 update하므로 멱등이며 `user_upload`을 제외한다.

## 10. 설정값

gcp_project_id/vertex_ai_location, gemini_model/temperature(0.7), embedding_model/output_dimensionality(3072), motif_similarity_tau=0.84, motif_generate_per_request_limit=2, recraft_api_key/model/style("")/size/response_format(`b64_json` 고정)/base_url, recraft_max_color_slots=6, motif_max_aspect_ratio=20.0, motif_edge_seam_tol=2.0, motif_render_check=True. 비로컬 generate worker는 GCP project/ADC와 Recraft secret을 사용하며 설정 누락을 가짜 성공으로 바꾸지 않는다.

# worker 명세 2/3 — 모티프 시스템 + 외부 API (seamless-tile 추출)

원본: `app/motifs/`, `app/adapters/`. 모티프 검색 래더·content-hash·프롬프트는 기능 명세의 일부 — 원문 보존. DB 스키마는 새 모노레포의 `motifs` 테이블(vector(1536) 고정 — db/MAPPING.md).

## 1. 모티프 데이터 모델·정규화

`MotifDef{id, symbol, bbox_mm, anchor, color_slots=("s0",)}`:
- symbol = `<symbol id="motif-{id}" overflow="visible">{geometry}</symbol>` — **viewBox 없음**(use transform이 mm 1:1). geometry는 `<g transform="translate(tx ty) scale(s)">…</g>` 래핑 1개.
- 정규화된 모티프는 항상 bbox `(-0.5,-0.5,0.5,0.5)`, anchor `(0,0)` — tight bbox의 중심을 원점, 긴 변을 1.0으로: `scale=1/extent, tx=-(bx+bw/2)·scale, ty=-(by+bh/2)·scale`.
- 거부: extent≤0, 0폭 축, `extent/min_side > 20.0`(aspect 상한), viewBox/치수 없음, drawable 없음(defs 밖 path/polygon/…), filter/raster image/외부 href(화이트리스트 밖).

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
- 해시 입력 = slotify **후**의 geometry(심볼 래퍼 제외) → colorway-agnostic: 같은 도형은 색 무관 같은 id(캐시 히트·upsert 멱등의 근거). provider/seed 경로는 `recraft-`, private user import는 `upload-` prefix를 쓴다.

## 3. Recraft 연동

- base `https://external.api.recraft.ai/v1`; generate `POST /images/generations`, vectorize `POST /images/vectorize`(multipart png). 헤더 `Authorization: Bearer {key}`. 타임아웃 **120s**. HTTP 재시도 없음.
- generate payload: `{prompt, model: "recraftv4_1_vector", response_format: "b64_json", n: 1, size: "1024x1024"}` — style은 빈 문자열이면 **생략**(substyle 파라미터 없음). 응답 URL을 따라가는 2차 요청은 허용하지 않는다(SSRF 경로 제거).
- 응답: `b64_json`만 수용하며 strict base64로 디코딩한다. 디코딩 전 인코딩 길이와 디코딩 후 SVG 바이트를 모두 `max_svg_bytes`로 제한하고, `<svg` 미포함이면 오류.
- **프롬프트**(spec dict → 개행 join — 재구현 결정 반영, 아래 gradient 항 참조):
```
Draw ONE single, isolated object as one inline SVG. Output ONLY the SVG markup — no markdown, no prose, no <?xml?> prolog.
CRITICAL: exactly ONE centered subject that FILLS the frame. It must NOT be a pattern, NOT repeated, NOT scattered or tiled, NOT a scene, collage or grid.
NO background: do not draw any background rectangle, border or backdrop — the object sits on a transparent canvas.
The root <svg> MUST have a viewBox. Multiple solid colors are allowed; use flat vector <path>/<g> shapes with solid fills. Do NOT use raster <image>, <text>, gradients or filters.
subject: {subject}
scope: {scope}
```
  + view/expression/style/description 존재 시 `{key}: {value}` append. 게이트 실패 재프롬프트(1회만): `"Your previous SVG was rejected. Fix exactly these:\n- {error}"`.
- **적합성 게이트/정리**: gradient 사용은 변환하지 않고 오류(재프롬프트 1회), rgb()→#hex, style 속성 페인트 hoist, 비허용 속성 drop, filter/clipPath/mask/text·메타 drop, **전면 배경 도형 제거**(선두 filled shape 면적 ≥ viewBox 90%, 최소 1 drawable 유지), raster image → 오류. 깨끗한 SVG는 무변경 반환(id 계약 유지). 게이트 2회 실패 → RecraftError(502). (재구현 결정: 원본은 gradient를 첫 stop 색으로 평탄화하고 gradient defs를 drop — gradient 미사용 방침에 따라 평탄화 대신 오류로 대체, 프롬프트도 "Avoid ... (they get flattened)"에서 "Do NOT use ..." 금지형으로 조정.)
- vectorize: 재프롬프트 없음(이미지 고정), 실패 시 해당 layer만 drop+경고. 입력 한도: 5MB/256~4096px/16M픽셀.
- 캐시(결정론 freeze): spec canonical → motif_id, 이미지 sha256 → motif_id. (재구현: 프로세스-로컬 캐시 미승계 — content-hash id + DB upsert가 같은 멱등성 제공.)

## 4. 임베딩 (OpenAI)

- `text-embedding-3-small`, 1536차원, httpx 직접 POST `/v1/embeddings`, 타임아웃 30s. 요청 내 같은 텍스트만 task memo로 합치며 프로세스 전역 캐시는 없다.
- **임베딩 텍스트**: `subject, description, style, view, expression, tags`의 비어 있지 않은 값을 순서대로 합친다. `scope`는 검색 필터·문서 모두에서 제외한다.
- 미설정·호출 실패는 exact subject/tag token 검색만 남기는 fail-soft다. 관련성 근거 없이 카탈로그를 재사용하지 않는다.
- 기존 공개 NULL 행은 `apps/worker/scripts/backfill_motif_embeddings.py --confirm-live`가 UPDATE한다. OpenAI 키·확인 플래그가 없으면 실행을 거부하고 `user_upload`은 제외한다.

## 5. 검색·재사용 래더 (resolver)

순서: **원문 retrieval → 정확도 게이트 → Gemini grounding → semantic retrieval → generate-on-miss**.

1. prompt 원문의 NFC/casefold token과 공개 motif subject/tag의 완전 token 일치를 ID 순으로 모은다.
2. 공개 카탈로그 전체 pgvector cosine top-5를 구하고 **τ=0.84** 이상만 더한다. 동점은 lowest ID다. `scope`는 필터로 사용하지 않고 `user_upload`은 항상 제외한다.
3. 후보는 실제 ID 없이 `catalog_ref`, subject, description, style로 Gemini에 제공한다. compiler만 ref→ID를 변환한다.
4. 후보가 있는데 prompt-derived semantic motif를 만들거나 후보를 모두 무시한 plan은 거부한다. 한 번 재저작 후에도 같으면 `semantic_mismatch`다.
5. 후보가 없거나 사진 유래 semantic spec이면 같은 exact/vector 게이트를 적용하고 miss에서만 Recraft를 호출한다. embedding 없음·장애·nearest read 실패 시 lowest-ID fallback 없이 Recraft로 간다.
6. **변이 선택**: `variant_group = sha256(canonical_json({"v":2, "subject", "scope"}))[:16]`; hit pool은 seed로 안정 선택한다.
7. `present_candidates`는 같은 신뢰도 게이트를 쓰고 Recraft를 호출하거나 관련 없는 ID로 채우지 않는다.

store 읽기 오류는 해당 읽기만 savepoint로 rollback한 뒤 miss로 흡수한다. 같은 요청에서 앞서
upsert한 미커밋 motif까지 전체 rollback하지 않으며, 쓰기 오류는 그대로 전파한다.

상위 오케스트레이션은 Gemini의 일반 `motif_specs`를 motif layer에 매칭한다. 사용자 텍스트·사진 모티프는 이 생성 경로에 암묵적으로 섞지 않고 §7의 명시적 preview→import 경로에서 먼저 exact private motif로 만든다. 개별 일반 모티프 게이트 소진 시 그 layer만 drop(+host cascade drop, fixpoint), 전부 실패 시에만 502. 생존자 있으면 partial 200 + 경고.

## 6. Gemini DesignPlan 저작

- 모델 `gemini-2.5-flash-lite`, httpx REST, temperature 0.7, `response_mime_type="application/json"`과 작은 `response_schema`를 함께 사용한다. HTTP 429/503은 0.5/1/2s 지수 백오프로 최대 4회 재시도하고 그 외 provider 오류는 502급이다.
- Gemini는 전체 엔진 intent를 직접 만들지 않는다. structured output은 `{"plans":[...]}` 2~4개이며 각 plan은 최대 2개의 `catalog_ref` 또는 의미 모티프(`subject`, optional style/description/reference_image_index), HEX 색 2~5개, `arrangement`, `density`, `scale`, `direction`, `stripes`만 가진다.
- worker가 plan을 48mm/300dpi intent로 결정적으로 컴파일한다. palette/colorway/layer id, tile-commensurate stripe period, lattice/scatter 수치, motif placeholder와 `motif_specs`는 코드가 만든다. 명시 제약은 컴파일 뒤 엔진 경계에서 다시 적용·검증한다. 전 plan이 무효일 때만 검증 오류를 붙여 1회 재요청하고, 그래도 실패하면 `authoring_invalid`다.
- exact private motif의 실제 ID는 Gemini에 전달하지 않고 개수만 알린다. compiler는 exact→명시적 motif 사진→prompt catalog/semantic 순으로 최대 2개를 넣는다. exact가 하나라도 있으면 prompt catalog/semantic은 배제한다. resolver가 선택한 DB motif가 다중색이면 실제 `color_slots` 전체를 palette slot에 결정적으로 결합한 뒤 후보를 검증한다.
- provider/model 비교는 `apps/worker/scripts/eval_authoring.py --confirm-live --model ...`로 30개 고정 corpus를 평가한다. 출력은 성공률, 실패 코드 수, 평균/p95 지연, 평균 저작 시도·유효 디자인 수이며 prompt/응답 원문은 출력하거나 저장하지 않는다. 일반 테스트와 CI는 유료 호출을 실행하지 않는다.
- 이미지: private signed URL을 allowlist(`storage.googleapis.com`, emulator)로만 읽고 redirect를 따르지 않는다. 선언 길이와 실제 길이를 일치 확인하며 장당 10MB, 최대 5장, 합계 50MB다. decode→실제 MIME 대조→20M픽셀 검증→EXIF 방향 적용→최대 2048px 축소→메타데이터 없는 JPEG로 재인코딩한다. Gemini Part 순서는 요청 이미지 순서 그대로 먼저, 텍스트가 마지막이다.
- 사진별 `purpose ∈ {auto,color_mood,motif,composition}`도 같은 순서로 전달한다. 명시 목적은 해당 역할로만 쓰도록 binding하며, `auto`에서만 사용자 문맥으로 역할을 추론한다. generation attachment에는 `(image_id, ordinal, purpose)`를 기록한다.
- exact private motif id는 최대 2개 모두 compiler와 resolver에 전달하되 Gemini에는 ID를 공개하지 않는다. compiler가 모든 exact motif를 intent에 넣고 worker가 누락을 검증한다. user-upload source는 exact id 조회로만 렌더되고 일반 facet/embedding/variant 검색 및 registry fingerprint에서 제외된다.

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

재구현 확장(원본 외): `apps/worker/scripts/seed_motifs.py`가 위 5개에 더해 `motif_assets/*.svg`(Flaticon UIcons regular-rounded 웹폰트에서 추출한 글리프 90개 — 동물·마린·하늘·문장·과일·취미·식물, subject=파일명 첫 토큰, style=outline)를 기본 모티프로 시드한다. 파일명 stem/token은 tags에도 넣는다. 시드 뒤 `backfill_motif_embeddings.py --confirm-live`를 실행하고 출력의 `embedded=total`을 배포 gate로 확인한다.

## 10. 설정값

gemini_api_key/model/temperature(0.7), openai_api_key, embedding_model, motif_similarity_tau=0.84, motif_candidate_top_k=5, recraft_api_key/model/style("")/size/response_format(`b64_json` 고정)/base_url, recraft_max_color_slots=6, motif_max_aspect_ratio=20.0, motif_edge_seam_tol=2.0, motif_render_check=True. (원본은 부팅 시 GEMINI·OPENAI 키 필수 — 재구현도 worker-generate 기동 요건으로 유지, 로컬은 dry-run 허용 검토.)

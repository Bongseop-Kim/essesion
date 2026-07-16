# worker 명세 2/3 — 모티프 시스템 + 외부 API (seamless-tile 추출)

원본: `app/motifs/`, `app/adapters/`. 모티프 검색 래더·content-hash·프롬프트는 기능 명세의 일부 — 원문 보존. DB 스키마는 새 모노레포의 `motifs` 테이블(vector(1536) 고정 — db/MAPPING.md).

## 1. 모티프 데이터 모델·정규화

`MotifDef{id, symbol, bbox_mm, anchor, color_slots=("s0",)}`:
- symbol = `<symbol id="motif-{id}" overflow="visible">{geometry}</symbol>` — **viewBox 없음**(use transform이 mm 1:1). geometry는 `<g transform="translate(tx ty) scale(s)">…</g>` 래핑 1개.
- 정규화된 모티프는 항상 bbox `(-0.5,-0.5,0.5,0.5)`, anchor `(0,0)` — tight bbox의 중심을 원점, 긴 변을 1.0으로: `scale=1/extent, tx=-(bx+bw/2)·scale, ty=-(by+bh/2)·scale`.
- 거부: extent≤0, 0폭 축, `extent/min_side > 20.0`(aspect 상한), viewBox/치수 없음, drawable 없음(defs 밖 path/polygon/…), filter/raster image/외부 href(화이트리스트 밖).

**정규화 파이프라인** `normalize_motif_svg`: sanitize 파싱·검증 → 프레임 검증 → tight bbox 프레이밍 → (선택) 색 양자화 → slotify → `<g>` 래핑+content-hash id → (선택) render gate.

- **색 양자화**(max_color_slots=6): RGB 유클리드 최근접 두 hex를 반복 융합(동점은 hex 사전순, 작은 hex가 대표). currentColor는 병합 불가 — 이것 때문에 예산 초과면 ValueError(재생성 트리거).
- **slotify**: distinct 색을 DFS(fill이 stroke보다 먼저) 최초 등장순으로 수집(`_norm_color`: strip+lower, none/url()은 슬롯 없음, currentColor는 concrete 취급). ≤1색 → 전부 currentColor 치환, `("s0",)`. ≥2색 → 각 색을 `s0,s1,...` 토큰으로 속성에 기록.
- **render gate**(librsvg 있으면): 10mm/300dpi 고정 타일, margin 10%로 렌더 — 실패 또는 edge_seam > 2.0이면 거부. 모티프는 mutate하지 않음.

## 2. content-hash id

```
geometry = f'<g transform="translate({fmt(tx)} {fmt(ty)}) scale({fmt(scale)})">{inner}</g>'
motif_id = "recraft-" + sha256(geometry.encode()).hexdigest()[:12]
```
- 해시 입력 = slotify **후**의 geometry(심볼 래퍼 제외) → colorway-agnostic: 같은 도형은 색 무관 같은 id(캐시 히트·upsert 멱등의 근거). prefix는 소스 무관 항상 `recraft-`(소스 구분은 source 컬럼).

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

- `text-embedding-3-small`, 1536차원, httpx 직접 POST `/v1/embeddings`, 타임아웃 30s. 실패는 EmbeddingError(502급)로 전파(임의 재사용 은폐 금지), 미설정은 graceful None.
- **임베딩 텍스트**: description 있으면 그대로; 없으면 `", ".join([" ".join([expression, subject] 존재분), f"{view} view", style] 존재분)`. **scope는 의도적으로 제외**(hard filter가 분리).
- 캐시: LRU 512, 키 = (model, text). (재구현: 프로세스-로컬 캐시는 성능 최적화일 뿐 — 유지해도 무해, 결정론 무관.)

## 5. 검색·재사용 래더 (resolver)

순서: **exact facet match → scope hard filter → 임베딩 τ 게이트 → generate-on-miss**.

1. scope 정규화(NFC+strip+casefold) 후 `find_facets_meta(scope)` (ORDER BY id — stable).
2. query_vec을 선행 계산(모든 hit의 variant pool 스코핑에 사용).
3. exact: (subject, scope, view, expression, style, description) 전부 정규화 일치 → hit.
4. soft: pgvector 코사인 LIMIT 1(동점 lowest id). match 없으면 **hard-filter 폴백**: 후보 중 lowest id.
5. **τ=0.84** (`motif_similarity_tau`, similarity ≥ τ → reuse). 미만 → Recraft generate(query embedding을 함께 저장해 미래 매칭 가능하게).
6. **변이 선택**: `variant_group = sha256(canonical_json({"v":2, "subject", "scope"}))[:16]` — 같은 (subject, scope) 풀. 풀은 τ-스코핑(fallback id는 항상 유지, 임베딩 없거나 차원 불일치 멤버는 keep) 후 `select_variant(pool, group, seed)`.
7. `present_candidates`(게이트 UI용, 최대 top_k=5): exact(sim 1.0) + best embedding(round 4) + id순 채움. **Recraft 호출 없음**.

store 읽기 오류는 해당 읽기만 savepoint로 rollback한 뒤 miss로 흡수한다. 같은 요청에서 앞서
upsert한 미커밋 motif까지 전체 rollback하지 않으며, 쓰기 오류는 그대로 전파한다.

상위 오케스트레이션: spec을 motif layer에 매칭; `text` 있으면 글리프 파이프라인(§7), `source_image_index` 있으면 vectorize. 개별 모티프 게이트 소진 시 그 layer만 drop(+host cascade drop, fixpoint), 전부 실패 시에만 502. 생존자 있으면 partial 200 + 경고.

## 6. Gemini intent 저작

- 모델 `gemini-2.5-flash-lite`, google-genai SDK, temperature 0.7(freeze 캐시로 결정론 무관), **JSON mode**(`response_mime_type="application/json"`, response_schema 미사용 — union-heavy 스키마가 400 유발), 코드펜스 스트립 후 json.loads.
- 재시도: HTTP 429/503 → 지수 백오프 0.5/1/2s, 최대 4회. 그 외 APIError → 502급.
- 출력: `{"designs": [{"intent": {...}, "motif_specs": [{layer_id, subject, scope, view?, expression?, style?, description?}]}]}` (2~4개 진짜 다른 디자인, legacy 단일도 수용). design별 독립 검증, invalid drop, 전부 invalid일 때만 constrained 재프롬프트 1회, 그래도 무효면 422.
- 프롬프트 골격: 헤더("You convert a textile pattern description into intent JSON...") + valid example + constraints(intent_version 1, motif_id=layer id placeholder, scope 필수 {whole, partial}, palette slot 참조, default colorway 필수, period/spacing이 tile 나눠떨어짐, diagonal stripe `-45deg period=tile/√2`, placement spec 필수 등) + **gallery skeleton**(구조만 남긴 예시들 — implicit caching을 위해 대용량 공통 블록 먼저) + fabrication/color 가이드 + palette 힌트 + 멀티모달 바인딩 + `Description: {user_prompt}`.
- 이미지: 전처리(decode→검증→EXIF 적용 후 메타 제거→PNG 재인코딩; 8MB/8192px/24M픽셀/PNG·JPEG·WEBP), Part 순서 = 이미지들 먼저 → 텍스트. STYLE 이미지(팔레트 추출, 최대 1) vs MOTIF 이미지(`source_image_index`로 vectorize).

## 7. 텍스트-as-모티프

번들 폰트 `NotoSansCJKkr-Regular.otf` + fontTools(SVGPathPen)로 글리프를 **`<path>`로 평탄화** — SVG에 `<text>` 요소는 절대 없음(sanitize 화이트리스트에도 없음). run별 색은 placeholder 페인트 → normalize로 슬롯화. 대화형 경로에서 무료·즉시 해석(Recraft 게이트 우회).

## 8. registry fingerprint

- `registry_version_for(store)`: 풀 비면 `REGISTRY_VERSION("0.1.0")`, 아니면 `f"{REGISTRY_VERSION}+pool.{hex8}"`, hex8 = `format(stable_hash("\n".join(sorted(all_ids))), "064x")[:8]`.
- 메모: (store identity, epoch) — epoch은 register/delete마다 +1. store 조회 실패 시 baseline 반환하되 **캐시하지 않음**.
- REGISTRY_VERSION 수동 bump는 스키마/포맷 변경 시에만 — 풀 추적은 fingerprint 몫.

## 9. 시드 카탈로그

`scripts/seed_head_catalog.py`: 모티프 5개(flower/whole ×3, leaf/whole ×2, 전부 style=flat, source="seed", 단색 → s0) — variant pool ≥ 2 데모용. 멱등(content-hash id + ON CONFLICT DO NOTHING). 재구현 시 새 모노레포 시드로 이식.

재구현 확장(원본 외): `apps/worker/scripts/seed_motifs.py`가 위 5개에 더해 `motif_assets/*.svg`(Flaticon UIcons regular-rounded 웹폰트에서 추출한 동물 글리프 10개, 파일명=subject, style=outline)를 기본 모티프로 시드한다.

## 10. 설정값

gemini_api_key/model/temperature(0.7), openai_api_key, embedding_model, motif_similarity_tau=0.84, motif_candidate_top_k=5, recraft_api_key/model/style("")/size/response_format(`b64_json` 고정)/base_url, recraft_max_color_slots=6, motif_max_aspect_ratio=20.0, motif_edge_seam_tol=2.0, motif_render_check=True. (원본은 부팅 시 GEMINI·OPENAI 키 필수 — 재구현도 worker-generate 기동 요건으로 유지, 로컬은 dry-run 허용 검토.)

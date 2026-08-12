# worker 명세 2/3 — 모티프 시스템 + 외부 API (seamless-tile 추출)

원본: `app/motifs/`, `app/adapters/`. 모티프 검색·content-hash·프롬프트는 기능 명세의 일부 — 원문 보존. DB 스키마는 새 모노레포의 `motifs` 테이블과 OpenAI `vector(1536)` 한 종류만 사용한다.

> 개정 2026-08-12: 생성 경로의 "같은 문장 = 재사용 판정" 계약과 variant_group 풀을 폐기
> (`docs/plans/motif-generate-always-create.md`). 생성은 항상 생성하고, catalog hit는
> candidates·grounding에만 남는다. 이 절부터 원문과 다른 의도적 명세 변경이다.

## 1. 모티프 데이터 모델·정규화

`MotifDef{id, symbol, bbox_mm, anchor}`:
- symbol = `<symbol id="motif-{id}" overflow="visible">{geometry}</symbol>` — **viewBox 없음**(use transform이 mm 1:1). geometry는 `<g transform="translate(tx ty) scale(s)">…</g>` 래핑 1개.
- 정규화된 모티프는 항상 bbox `(-0.5,-0.5,0.5,0.5)`, anchor `(0,0)` — tight bbox의 중심을 원점, 긴 변을 1.0으로: `scale=1/extent, tx=-(bx+bw/2)·scale, ty=-(by+bh/2)·scale`.
- 거부: extent≤0, 0폭 축, `extent/min_side > 20.0`(aspect 상한), viewBox/치수 없음, drawable 없음(defs 밖 path/polygon/…), filter/raster image/외부 href(화이트리스트 밖).
- symbol의 fill/stroke는 생성·업로드 시 확정된 concrete paint다. 이후 디자인 palette나 구성 patch가 이를 바꾸지 않는다.
- `ingested_user_id`·`ingested_session_id`는 Recraft 행의 최초 유입 감사 provenance다. content-hash conflict와 카탈로그 hit는 이를 덮지 않고, 사용자·세션 삭제 시 `ON DELETE SET NULL`이다. 공개 모티프의 소유권 필드는 아니다.
- `status`는 `pending | approved | rejected`이며 Recraft 행의 기본값은 `pending`, 신뢰된 seed는 `approved`를 명시한다. `reviewed_at`·`reviewed_by`는 관리자 결정 시 기록하고 관리자 삭제 시 `reviewed_by`만 `SET NULL`이다. 상태가 바뀌어도 content-hash 행과 과거 세션 참조는 삭제하지 않는다.

**정규화 파이프라인** `normalize_motif_svg`: sanitize 파싱·검증 → 프레임 검증 → 루트 presentation 래핑 → tight bbox 프레이밍 → paint 정규화 → `<g>` 래핑+content-hash id → (선택) render gate.

- **공용 intake 상한**: UTF-8 2MB, node 2,048, nesting depth 64, path 1,024, path command 50,000, geometry token 200,000. XML allowlist 검증 직후, geometry 계산과 render gate 전에 실패시킨다. implicit path 좌표 반복으로 command-letter 상한을 우회하지 못하도록 path 숫자와 polygon/polyline `points` 숫자를 하나의 token budget으로 센다. SVG 파일, 텍스트 preview, 사진 vectorize 결과가 모두 이 경계를 공유한다. 방어적 `RecursionError`도 route에서 422로 변환한다.
- **루트 presentation 상속**: 루트 `<svg>`의 `fill`·`stroke`·`stroke-width`·`opacity`가 하나라도 있으면 자식 전체를 그 속성을 단 `<g>` 하나로 감싼 뒤 자식을 취한다. 루트를 그냥 버리면 `<svg fill="#c0445a">`의 도형이 검게, `<svg stroke="#000" fill="none">`의 선이 투명하게 바뀐다. 자식마다 복사하지 않고 감싸는 이유는 `opacity`가 그룹 단위 합성이기 때문이다. 루트 `color`는 아래 상속 규칙이 처리한다.
- **paint 정규화**: root/ancestor `color` 상속을 따라 `currentColor`·`inherit`를 실제 paint로 바꾸고(상속값 없으면 `#111111`), 모든 `fill`/`stroke`/`color`를 소문자 6/8자리 hex 또는 `none`으로 접는다. `rgb()`/`rgba()`는 hex로 변환(알파 버림), 3/4자리 hex는 확장, `transparent`는 `none`이다. **named color·Pantone spot·`url(#...)`은 거부** — hex를 확정할 수 없거나(전자) paint server라 모티프에 존재할 수 없다(후자, `<pattern>` 침투도 여기서 막힌다). 따라서 `red`/`rgb(255,0,0)`/`#F00`/`#FF0000`은 모두 같은 motif id다. 색 개수 양자화나 슬롯 토큰 치환은 하지 않는다.
- **render gate**(librsvg 있으면): 10mm/300dpi 고정 타일, margin 10%로 렌더 — 실패, 완전 투명(아무것도 안 그림), edge_seam > 2.0이면 거부. 모티프는 mutate하지 않음.

## 2. content-hash id

```
geometry = f'<g transform="translate({fmt(tx)} {fmt(ty)}) scale({fmt(scale)})">{inner}</g>'
motif_id = id_prefix + "-" + sha256(geometry.encode()).hexdigest()[:12]
```
- 해시 입력 = concrete paint를 포함한 geometry(심볼 래퍼 제외). 도형과 색이 모두 같을 때만 같은 id이며, 같은 도형이라도 색이 다르면 다른 id다. provider/seed 경로는 `recraft-`, private user import는 `upload-` prefix를 쓴다.

## 3. Recraft 연동

- base `https://external.api.recraft.ai/v1`; generate `POST /images/generations`, vectorize `POST /images/vectorize`(multipart png). 헤더 `Authorization: Bearer {key}`. 타임아웃 **120s**. HTTP 재시도 없음.
- 기본 generate payload: `{prompt, model: "recraftv4_1_vector", response_format: "b64_json", n: 1, size: "1024x1024", random_seed?: seed}` — style은 빈 문자열이면 **생략**(substyle 파라미터 없음), `random_seed=0`도 보낸다. V4/V4.1이 거부하는 `negative_prompt`·`controls.no_text`는 보내지 않고, V2/V3에는 `negative_prompt`, V3에는 `controls: {no_text: true}`를 조건부로 보낸다. 디자인 팔레트나 `controls.colors`는 전달하지 않는다. 응답 URL을 따라가는 2차 요청은 허용하지 않는다(SSRF 경로 제거).
- 응답: `b64_json`만 수용하며 strict base64로 디코딩한다. 디코딩 전 인코딩 길이와 디코딩 후 SVG 바이트를 모두 `max_svg_bytes`로 제한하고, `<svg` 미포함이면 오류.
- **프롬프트**(사용자 문장을 번역·구조화하지 않고 그대로 포함):
```
Create one isolated object as a clean SVG vector motif.
Place exactly one centered object on a transparent canvas.
Use flat solid vector shapes and preserve a clear silhouette.
Do not include text, letters, gradients, patterns, tiles, repetitions, or backgrounds.
User description: {query}
```
  V4/V4.1에서는 text/gradient/pattern/background 금지 제약을 본문에 직접 포함한다. V2/V3는 추가로 `negative_prompt`를 사용하고 V3는 `controls.no_text`도 사용한다. 게이트 실패 재프롬프트(1회만)는 `"Your previous SVG was rejected. Fix exactly these:\n- {error}"`를 덧붙인다.
- **적합성 게이트/정리**: gradient 사용은 변환하지 않고 오류(재프롬프트 1회), `<style>` 시트도 오류(조용히 drop하면 클래스로 칠한 SVG가 통째로 검정이 된다), rgb()→#hex, style 속성 페인트 hoist, 비허용 속성 drop, filter/clipPath/mask/text·메타 drop, **전면 배경 rect 제거**(선두 filled `rect` 면적 ≥ viewBox 90%, 최소 1 drawable 유지 — rect가 아닌 도형은 viewBox를 꽉 채워도 모티프 본체로 본다), raster image → 오류. 재프롬프트에 싣는 에러 원문은 건당 160자로 자른다(V2/V3 1000자 예산). 깨끗한 SVG는 무변경 반환(id 계약 유지). 게이트 2회 실패 → RecraftError(502). (재구현 결정: 원본은 gradient를 첫 stop 색으로 평탄화하고 gradient defs를 drop — gradient 미사용 방침에 따라 평탄화 대신 오류로 대체, 프롬프트도 "Avoid ... (they get flattened)"에서 "Do NOT use ..." 금지형으로 조정.)
- vectorize: 재프롬프트 없음(이미지 고정), 실패 시 해당 layer만 drop+경고. 입력 한도: 5MB/256~4096px/16M픽셀.
- 캐시(결정론 freeze): spec canonical → motif_id, 이미지 sha256 → motif_id. (재구현: 프로세스-로컬 캐시 미승계 — content-hash id + DB upsert가 같은 멱등성 제공.)

## 4. 임베딩 (OpenAI)

- `text-embedding-3-large`, `dimensions=1536`, API 키 + httpx 직접 호출을 사용한다. task type 개념은 없으며 요청 내 같은 text만 task memo로 합친다. 프로세스 전역 캐시는 없다.
- **임베딩 텍스트**: `subject, description, style, view, expression, tags`의 비어 있지 않은 값을 순서대로 합친다. `scope`는 검색 필터·문서 모두에서 제외한다.
- 미설정·호출 실패는 exact subject/tag token 검색만 남기는 fail-soft다. 관련성 근거 없이 후보를 만들지 않는다.
- 승인된 시드 공개 NULL 행은 `apps/worker/scripts/index_motif_embeddings.py --confirm-live`가 초기 인덱싱한다. `OPENAI_API_KEY`·확인 플래그가 없으면 실행을 거부하고 `pending`·`rejected`·`user_upload`은 제외한다.

## 5. 디자인 catalog grounding과 명시적 생성

디자인 `/generate`의 카탈로그 경로는 **원문 retrieval → 정확도 게이트 → LLM grounding**에서 끝난다.

1. prompt 원문의 NFC/casefold token과 `status=approved` 공개 motif subject/tag의 완전 token 일치를 ID 순으로 모은다.
2. 승인된 공개 카탈로그 전체 pgvector cosine top-5를 구하고 **τ=0.40** 이상만 더한다(text-embedding-3-large 분포 기준 재캘리브레이션). 동점은 lowest ID다. `scope`는 필터로 사용하지 않고 `pending`·`rejected`·`user_upload`은 항상 제외한다.
3. 후보는 실제 ID 없이 `catalog_ref`, subject, description, style로 LLM에 제공한다. compiler만 ref→ID를 변환한다.
4. 후보가 있는데 검증되지 않은 source를 만들거나 후보를 모두 무시한 plan은 거부한다. 한 번 재저작 후에도 같으면 `semantic_mismatch`다. 후보가 없으면 모티프 없이 계속하며 Recraft나 lowest-ID fallback을 호출하지 않는다.

새 모티프 생성은 모티프 모달의 별도 계약이다. `POST /motifs/candidates`와 `POST /motifs/generate`는 `{query}`만 받고, 최대 200자의 `query`를 변환 없이 `{"subject": query, "scope": "whole"}`로 다룬다. 문장이 모티프의 유일한 입력이다 — 디자인 컨텍스트(플랜의 style 문구 등)를 숨은 힌트로 주입하지 않는다. `candidates`는 위와 같은 신뢰도 게이트의 catalog hit만 반환하고 Recraft를 호출하지 않는다 — 비슷한 모티프 확인은 이 보이는 검색 단계가 수행한다. 사용자가 `generate`를 명시적으로 선택하면 `resolve_spec`이 카탈로그 확인 없이 **항상** Recraft를 호출한다(숨은 재사용 판정 없음). 같은 문장 재클릭도 새 변형을 만들며, (subject, scope)가 같은 모티프가 쌓이는 것은 변형 풀 확충이다 — 품질·중복은 admin 승인 게이트가 거른다. 실제 provider 호출은 요청당 `motif_generate_per_request_limit`(기본 2)로 제한되고 API는 별도로 세션 예산 3회를 선차감하며 워커 실패 시에만 환급한다.

Recraft 결과는 `pending`으로 저장한다. 생성 요청은 반환된 ID를 직접 조회해 즉시 렌더할 수 있지만, 관리자 `POST /admin/motifs/{id}/review`가 `approved`로 바꾸기 전에는 다른 사용자의 lexical/pgvector 검색, LLM grounding, 임베딩 인덱싱·집계와 registry fingerprint에 포함되지 않는다. `rejected`도 같은 공개 제외 상태이고 행은 삭제하지 않는다. 관리자는 no-op을 제외하고 승인 회수(`approved→rejected`)를 포함한 모든 승인/거절 전이를 수행할 수 있다. 같은 spec 재요청은 매번 Recraft 비용이 들지만 byte-identical 결과의 content-hash upsert는 행 중복을 만들지 않는다.

C-10 facet 휴리스틱은 비가시·제어 문자와 알려진 명령형 인젝션을 저장 전에 막는 1차 방어다. 이를 통과한 자유 텍스트도 곧바로 공개되지 않고 관리자 승인 게이트를 거치므로, 휴리스틱 하나만으로 전체 사용자 grounding 입력을 신뢰하지 않는다.

store 읽기 오류는 해당 읽기만 savepoint로 rollback한 뒤 빈 후보로 흡수한다. 같은 요청에서
앞서 upsert한 미커밋 motif까지 전체 rollback하지 않으며, 쓰기 오류는 그대로 전파한다.

사용자 SVG·텍스트·사진 모티프는 디자인 생성에 암묵적으로 섞지 않고 §7의 명시적 preview→import 경로에서 먼저 exact private motif로 만든다. 디자인 compiler는 이미 확정된 `input`과 검증된 `catalog` source만 다룬다.

Recraft 생성이 신규 content-hash 행을 insert했을 때만 최초 유입 사용자·세션 provenance를 저장한다. content-hash hit는 기존 symbol과 provenance를 덮지 않는다.

## 6. LLM DesignPlan v3 저작 (OpenAI)

- 모델 `gpt-5.6-luna`, API 키 + httpx `chat/completions` 직접 호출, `response_format={"type":"json_schema","strict":true}`를 사용한다. v3는 Pydantic `DesignPlanV3` 스키마를 strict 변환(`_strict_json_schema`)해 전달하고 응답 텍스트를 pydantic으로 재검한다. 429/500/502/503은 0.5/1/2s 지수 백오프로 최대 4회 재시도하고 그 외 provider 오류는 502급이다.
- LLM은 전체 엔진 intent를 직접 만들지 않는다. v3 structured output은 DesignPlanV3 한 객체, 2~8 HEX palette, 최대 2개 discriminated motif source(`input`/verified `catalog`), 최대 5개 stripe/motif layer와 normalized placement(lattice, Poisson/sateen scatter, closed straight/wave path, 고정 point template)만 가진다. engine ID·mm·SVG·임의 point 좌표는 schema 밖이다.
- worker compiler가 plan을 48mm/300dpi intent로 결정적으로 변환한다. palette/colorway/layer ID, tile-commensurate geometry와 concrete motif ID를 코드가 만들고 엔진 경계가 다시 검증한다.
- exact private motif의 실제 ID는 LLM에 전달하지 않고 1-based input 순번만 요구한다. 모든 exact input은 plan에 정확히 한 번 있어야 하고 verified catalog는 `catalog_ref`만 노출한다. compiler만 ref→ID를 변환한다. 모티프 색은 symbol에 고정되어 있어 Plan v3에는 모티프 색 필드가 없다.
- `gallery-v1`은 빈 DB용 소량 starter Plan v3 시드이며 골든 파일과 독립적이다. 컴파일러 회귀는 테스트 픽스처의 ID-파일명 규약으로 검증한다. 실제 RAG는 `authoring_examples`의 현재 contract·embedding model에 맞는 active 시범만 검색한다. query top-25를 motif 수/배치 제약으로 거른 상위 8개에서 family 다양성을 우선해 최대 3개를 prompt에 넣는다. retrieval 장애·빈 active 집합은 시범 없이 계속하는 fail-soft다.
- 모든 요청은 Plan v3 저작 경로만 사용한다. contract/compiler/prompt/example revision, retrieval 상태·선택 ID/유사도, fingerprint는 generation diagnostics와 intent log에 남긴다.
- live 평가는 `eval_authoring.py --confirm-live`의 label 30-case corpus로 schema/compiler 성공률, 구조 다양성, retrieval expected-family recall, 시도 수와 latency를 측정한다. prompt/provider 원문은 출력·저장하지 않고 CI는 유료 호출을 실행하지 않는다. 정본·동기화·승격 절차는 `docs/specs/authoring-plan-v3.md`다.
- exact private motif id는 최대 2개 모두 compiler에 전달하되 LLM에는 ID를 공개하지 않는다. compiler가 모든 exact motif를 intent에 넣고 worker가 누락을 검증한다. user-upload source는 exact id 조회로만 렌더되고 일반 facet/embedding/variant 검색 및 registry fingerprint에서 제외된다.

### 6.1 모티프 색 불변 계약

resolver가 concrete motif ID를 확정한 뒤 intent는 `motif_id`와 `size_mm`만 가진다. composition은 concrete-color `<symbol>`을 한 번 등록하고 각 인스턴스를 단일 `<use>`로 배치한다. 디자인 palette, 명명색 patch, fabric finalize는 모티프 paint를 변경하지 않는다. 같은 resolved intent+seed와 같은 motif registry면 SVG 바이트가 동일하다.

## 7. 텍스트-as-모티프

`POST /motifs/text-preview`는 `{text,font_id,font_weight,letter_spacing}`을 받아 path-only SVG를 반환한다.

- font id는 `nanum-gothic`, `nanum-myeongjo`, weight는 400/700이다. 네 static TTF를 worker wheel에 포함하므로 시스템 폰트·브라우저에 의존하지 않는다. 원본과 SHA-256은 `apps/worker/src/worker/motifs/fonts/README.md`, 라이선스 전문은 같은 디렉터리의 OFL 파일에 고정한다(SIL OFL 1.1).
- 입력은 NFC로 정규화하며 최대 20자다. 허용 문자는 한글 완성형, 호환 자모, 영문, 숫자, 공백이다. 자간은 -0.2~1.0em, 미지원 glyph는 명시적으로 거부한다.
- fontTools `SVGPathPen`으로 서버에서 변환하고 최종 SVG에는 `<text>`, font URL, 외부 href가 없다. path command 20,000개와 SVG 2MB 상한을 둔다.
- 동일 NFC text+font id+weight+letter spacing은 동일 SVG 바이트를 만들고, 공통 `normalize_motif_svg`에 통과시키면 동일 content-hash motif id가 된다. preview 응답은 concrete-color standalone SVG이며 그대로 `/motifs/import`에 넣어도 같은 id·symbol을 회복한다.

### 7.1 사진→SVG와 팔레트 추출

`POST /motifs/photo-preview`는 모티프 모달에서 완료한 private staged upload의 signed URL을 사용한다. JPEG/PNG/WebP 실제 MIME, 장당 10MB, 20M픽셀을 확인하고 최대 1024px로 축소한 뒤 CPU 처리를 thread pool에서 실행한다.

- 배경 제거는 별도 provider·대형 모델·GPU 없이 Pillow로 수행한다. 기존 alpha를 우선 사용하고, 아니면 테두리 median 색을 구한 뒤 유사색의 4-neighbor border-connected 영역만 제거한다. 균일한 테두리 confidence 0.55 미만, 빈 피사체, 프레임을 거의 채운 피사체는 명시 오류다. 복잡한 장면을 성공처럼 보이는 hidden fallback은 없다.
- 색상 수(1~6)와 단순화 강도(low/medium/high)를 결정적으로 양자화한 뒤 로컬 VTracer로 path화한다. 원본/중간 파일은 worker가 저장하지 않고 결과 SVG만 기존 private motif import 경계로 전달한다.
- 상한: vector SVG/processed PNG 각 2MB, node 2,048, path 1,024, path command 50,000, 출력 색상은 요청 color_count 이하. sanitizer/normalize도 저장 전에 다시 적용된다.
- 응답은 `{svg,processed_preview_base64,background_confidence,warnings}`. 동일 입력과 옵션은 동일 SVG/PNG 바이트를 만든다. 배경 포함은 `remove_background=false`로 명시하며 실패 시 자동 전환하지 않는다.

`POST /motifs/import`는 DB를 쓰지 않는 pure normalization 경계다. `{motif_id,symbol,bbox,anchor,preview_svg}`를 반환하고, API가 quota 확인과 함께 `Motif(source=user_upload, embedding=null)` 및 사용자 소유 링크를 하나의 transaction에 저장한다. 따라서 API transaction 실패가 ownerless private motif를 남기지 않는다. `preview_svg`는 저장 symbol과 같은 concrete paint의 standalone 문서이며 재-import해도 같은 content-hash identity와 geometry를 얻는다.

### 7.2 문맥 기반 아이디어

`POST /ideas`는 기존 prompt, 최대 2개의 exact motif 문맥과 count(3 또는 4)를 받는다. worker 내부에서는 id/name 순서를 검증하지만 LLM 프롬프트에는 ordinal과 human name만 보내고 private content-hash id는 공개하지 않는다. 이미지는 받거나 LLM에 보내지 않는다. 결과는 서로 다른 180자 이하 문장 정확히 count개인 JSON만 수용하며 형식 오류는 한 번 constrained retry 후 502다.

이 경로는 intent·디자인·generation log를 만들지 않고 Recraft도 호출하지 않는다. 과금과 사용자별 rate limit은 API 경계가 소유하며 worker에는 토큰 차감 로직이 없다. 프론트가 provider를 직접 호출하지 않는다.

## 8. registry fingerprint

- `registry_version_for(store)`: 승인된 공개 풀 비면 `REGISTRY_VERSION("0.1.0")`, 아니면 `f"{REGISTRY_VERSION}+pool.{hex8}"`, hex8 = `format(stable_hash("\n".join(sorted(all_ids))), "064x")[:8]`. 승인·거절 전이가 ID 집합을 바꿔 캐시 stamp도 함께 움직인다.
- 메모: (store identity, epoch) — epoch은 register/delete마다 +1. store 조회 실패 시 baseline 반환하되 **캐시하지 않음**.
- REGISTRY_VERSION 수동 bump는 스키마/포맷 변경 시에만 — 풀 추적은 fingerprint 몫.

## 9. 시드 카탈로그

`scripts/seed_head_catalog.py`: 모티프 5개(flower/whole ×3, leaf/whole ×2, 전부 style=flat, source="seed"). 멱등(content-hash id + ON CONFLICT DO NOTHING). 재구현 시 새 모노레포 시드로 이식.

재구현 확장(원본 외): `apps/worker/scripts/seed_motifs.py`가 인라인 시드(위 5개 + `circle` 원반, style=flat)에 더해 `motif_assets/*.svg`(Flaticon UIcons regular-rounded 웹폰트에서 추출한 글리프 91개 — 동물·마린·하늘·문장·과일·취미·식물, subject=파일명 첫 토큰, style=outline)를 concrete-color 기본 모티프로 `status=approved` 시드한다. 손으로 쓴 도형은 인라인에 둔다 — 에셋 라벨은 파일명 템플릿(`"{stem} outline icon"`)이라 글리프가 아닌 것에는 맞지 않는다. 파일명 stem/token은 tags에도 넣는다. 시드 뒤 `index_motif_embeddings.py --confirm-live`를 실행하고 출력의 `embedded=total`을 배포 gate로 확인한다.

## 10. 설정값

openai_api_key/base_url, llm_model(`gpt-5.6-luna`), embedding_model(`text-embedding-3-large`)/dimensions(1536), motif_similarity_tau=0.40(임베딩 모델 분포 기준 재캘리브레이션), motif_generate_per_request_limit=2, recraft_api_key/model/style("")/size/response_format(`b64_json` 고정)/base_url, motif_max_aspect_ratio=20.0, motif_edge_seam_tol=2.0, motif_render_check=True. 비로컬 generate worker는 OpenAI·Recraft secret을 사용하며 설정 누락을 가짜 성공으로 바꾸지 않는다.

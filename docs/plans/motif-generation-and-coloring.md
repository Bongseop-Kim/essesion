# 모티프 생성·의미 기반 색 배분 — 실행 지시서

상태: 실행 대기. 이 문서는 **지시서**다 — 각 작업(T-*)의 위치·지시·완료조건을 그대로 따를 것. 판단이 필요한
지점은 이미 결정해 명시했다.

맥락(선행조건 아님): 프롬프트를 LLM 단계로 쪼개는 안은 검토 후 기각(현행 유지)했고, 이 문서는 그 대신 채택한 두
기능이다. 보안 가드 C-9(카탈로그 신뢰불가 라벨, `adapters/gemini.py:145-156`)·C-10(facet
sanitize+suspicious 스크린, `motifs/resolver.py`)는 **이미 구현·배포됨** — 신규 작업 아님. 이 기능이 그 유입면을
넓히므로 유지·강화만 한다(M5).

## 전제

- 모티프(recraft 생성 or 사용자 업로드)는 **이미 완성된 SVG**다. 서비스에 SVG를 편집하려는 사용자는 없다.
  → **멀티슬롯 모티프의 기본 동작은 원색 보존.** 재색은 사용자가 명시할 때 or fixed 팔레트일 때만.
- 색 배정 결과는 `params["colors"]` → colorway → byte-identical 키에 들어간다.

## 불변식 (MUST / 위반 금지)

- **M1.** 요청·compile 핫패스에서 LLM 호출 금지. 비전 라벨링은 **모티프 유입 시점 1회 + 백필**만. 요청 시 색
  배정은 저장 입력(`slot_labels`, `color_slots` DFS 순서, `slot_colors`, plan 색, ground)에 대한 **순수 산술**.
- **M2.** `slot_labels`는 `slot_colors`처럼 **content-hash(`normalized.id`)에서 제외**. `id` 불변 회귀 테스트 필수.
- **M3.** `slot_labels` NULL → 현행 위치+모듈로 배정 그대로(레거시·비라벨 무회귀).
- **M4.** 스키마 변경 시 `pnpm codegen`으로 api-client 재생성, 같은 커밋(CI codegen-drift). DDL은 Alembic 경유만.
- **M5.** C-9(`gemini.py:145-156`)·C-10(`resolver.py _screen_facets`)는 **이미 구현됨** — 신규 선행 작업 아님.
  text→generate가 이 유입면을 넓히므로 **제거·약화 금지**, generate 경로에도 스크린 적용(T-A7). 착수 시 유지만 확인.

---

## 작업 A — 명확한 모티프 지시 → generate-on-miss

목표: 텍스트가 **구체·개별 도형 주제**를 명시("펠리컨 넥타이")하고 카탈로그 매칭이 없으면 recraft로 생성→재사용.
무드/색상만("차분한 파스텔")이면 모티프 없음(현행 유지).

- **T-A1 [authoring/schema.py:42-72]** — `GenerateMotifSource` 추가: `source: Literal["generate"]`, `subject: str`
  (min 1, max 80, `_strip_subject` 재사용), `scope: Literal["whole","partial"]="whole"`,
  `style: str|None`(max 80), `description: str|None`(max 160), `_strip_optional_text` 재사용. **이미지 인덱스 없음.**
  `PlanMotifSource` 유니온에 편입(`schema.py:69-72`). catch-all 필드 추가 금지.
  - 완료조건: `GenerateMotifSource(source="generate", subject="펠리컨")` 검증 통과; 유니온 판별이 `source` 값으로
    올바른 변형 선택; 길이 초과 subject/description 거부.

- **T-A2 [adapters/gemini.py:169-176]** — "do not invent" elif 본문을 조건부로 교체(이 분기는 카탈로그·exact·
  motif/auto 이미지가 모두 없을 때만 발화 = "카탈로그 미스 텍스트 경로"): *사용자가 반복될 타일 모티프로 구체·개별
  도형 주제를 명시적으로 지목한 경우에 한해* `{"source":"generate","subject":"<사용자 문구 그대로>"}` 1개 선언 허용.
  subject는 사용자 원문에서만, 무드/색상만인 경우 금지. 나머지는 `motifs=[]`. **catalog-present 분기에는
  generate 문구를 넣지 말 것**(넣으면 grounding 가드가 거부 → 재시도/SemanticMismatch).
  - 완료조건: "펠리컨 넥타이"→`source="generate"` 1개; "차분한 파스텔"→`motifs=[]`.

- **T-A3 [authoring/compiler.py:120-138]** — `_resolve_motif_sources`에 `source.source=="generate"` 분기 추가:
  `_ResolvedMotifSource(motif_id=f"semantic_{len(sources)}", spec={subject,scope,style,description,"required":False})`
  (reference 분기와 동일, 이미지 인덱스 제외, `required=False`=best-effort). `spec`을 내므로 `:405-406`이
  `motif_specs`로 전달. `:145-154` grounding 가드는 truthy `catalog_candidates`에만 발화 → generate는 카탈로그
  빌 때만 나오므로 무영향(확인).
  - 완료조건: generate plan이 컴파일되어 `motif_specs`에 1건; 카탈로그 있을 때 generate가 오면 거부됨(회귀 테스트).

- **T-A4 [api/routes.py:584-587] (필수)** — 텍스트 경로는 `available_motif_count=min(2, 0)=0`이 되어
  `retrieval.py:69 _compatible`이 모티프 포함 예시를 전부 걸러낸다. `body.prompt`가 있으면 **최소 1로 바닥값**.
  - 완료조건: 텍스트 프롬프트 retrieval이 모티프 포함 구조 예시를 후보로 포함.

- **T-A5 [motifs/resolver.py:342-394, recraft.py] — 무변경(확인만)** — subject-only spec은
  `UNSUPPORTED_SPEC_FIELDS`(`text`/`source_image_index`) 미해당 → 통과(`:464`). `_screen_facets` 적용됨(`:353`),
  `generate_motif`이 recraft 프롬프트 조립·upsert(`source="recraft"`). trace 라벨 `prompt_generate` 추가는 선택.
  - 완료조건: `reference_image_index` 없는 spec이 resolve_spec→generate_motif→upsert로 정상 라우팅(테스트).

- **T-A6 [motifs/resolver.py:429-539] — DoW 예산** — 요청당 generate(=이미지 없는 spec) 호출 캡. 초과분은 layer
  drop + 경고(raise 금지). 텍스트 주제는 적대적으로 값싸게 변형되므로 필수.
  - 완료조건: 캡 초과 요청이 초과 모티프를 drop하고 나머지로 성공, recraft 호출 수 ≤ 캡.

- **T-A7 [motifs/resolver.py `_screen_facets`] — generate 전용 거부** — generate-origin spec은 이미지가 의도를
  앵커하지 않으므로 `is_suspicious_facet_text` 히트 시 **로그가 아니라 거부**(reference 경로는 현행 유지).
  - 완료조건: 인젝션 패턴 subject의 generate spec이 거부되고 해당 layer가 drop됨.

- **T-A8 [motifs/store.py `upsert_motif`] — provenance (후속, 누락 금지)** — recraft 유입 행에 세션/사용자 태깅.
  최소 활성화와 분리 가능하나 C-10 감사선이므로 별도 태스크로 추적.

---

## 작업 B — 하이브리드 색 배분 (보존 기본 + 명시 재색 시 라벨 랭크)

### 색 배정 결정 규칙 (routes.py `_bind_resolved_motif_colors`, resolve 후, 레이어별) — 이대로 구현할 것

신호 = **`color_indices` 유무**(별도 플래그 추가 안 함). 생략/None = 보존, 명시 = 재색.

1. **단일 슬롯**(`len(motif.color_slots)==1`) → 팔레트 색 1개 배정(`planned_colors[0]` 있으면 그것, 없으면
   `color_ids[0]`). **ground hex와 동일하면 다음 구분색으로 치환**; 팔레트 축퇴(전부 ground)면 planned 유지. 라벨 무관.
2. **멀티 슬롯 AND `color_indices` 생략 AND `motif.slot_colors` 존재 AND 팔레트 non-fixed** → **보존**:
   `params["colors"] = {slot_i: motif.slot_colors[i]}`.
3. **그 외**(= `color_indices` 명시, 또는 fixed 팔레트, 또는 `slot_colors` 없음) → **랭크 배정**:
   `slot_labels` 있으면 라벨→고정 rank로 슬롯 전순서 생성 후 `effective_colors`를 순서대로 zip(주색
   `planned_colors[0]`→최상위 슬롯; 색<슬롯이면 모듈로가 최하위 슬롯으로 wrap). `slot_labels` NULL이면 현행
   위치+모듈로(M3).

- **T-B1 [authoring/schema.py:185-197] — `color_indices` optional화** — `MotifLayerPlan.color_indices`를
  `list[int] | None = None`로 완화. 관련 참조(`schema.py:238` 인덱스 바운드, `DesignPlanV3` validator)가 None을 안전
  처리. 프롬프트(gemini.py 모티프 문구)에 지시 추가: **모티프 원색을 유지하려면 `color_indices` 생략, 사용자가
  모티프 색 변경을 명시할 때만 포함. fixed 팔레트에서는 반드시 포함.**
  - 완료조건: `color_indices` 없는 모티프 레이어 검증 통과; fixed 팔레트에서 생략 시 컴파일러가 거부(T-B2).

- **T-B2 [authoring/compiler.py:319-334] — fixed 팔레트는 재색 강제** — fixed 모드에서 모든 모티프 레이어에
  `color_indices` 필수(가시성 보장이 motif-first-color에 의존). non-fixed에서만 보존 허용. `motif_color_slots`
  sidecar는 `color_indices` 있을 때만 채우고, 없으면 해당 layer는 "보존" 표식.
  - 완료조건: fixed 팔레트 + `color_indices` 없는 모티프 → `PlanCompileError`; non-fixed는 통과.

- **T-B3 [db/ Alembic 신규] — `slot_labels` 컬럼** — `motifs.slot_labels JSONB NULL`(none_as_null),
  `20260724_…slot_colors` 마이그레이션 미러. 백필/제약/인덱스 없음. downgrade는 컬럼 drop.
  - 완료조건: upgrade/downgrade 왕복, 기존 행 NULL.

- **T-B4 [db/src/db/models/seamless.py:51]** — `slot_labels: Mapped[list[Any]|None] = mapped_column(JSONB(none_as_null=True))`,
  `slot_colors` 주석 복사("color_slots와 인덱스 정렬; 멀티슬롯만; 단일/레거시 NULL; content-hash id에 절대 미포함").

- **T-B5 [motifs/labeler.py 신규]** — `async label_slots(preview_svg, slot_colors, *, gemini_client, settings)
  -> tuple[str,...] | None`. `normalize`의 슬롯별 원색 프리뷰(`normalize.py:246-251`)를 스레드풀에서 PNG 래스터화
  (`_render_gate`와 동일 선택적 렌더러; 없으면 None). `ReferenceImage(mime="image/png")`로 감싸
  `complete_model`에 **고정 길이(len==len(slot_colors))·enum형 response_schema**로 호출. 프롬프트에 slot_colors
  순서 명시("이 색 순서대로 각 부위 명명")로 정렬 보장, 방어적으로 pad/truncate. 반환 라벨은
  `sanitize_facet_text`+`is_suspicious_facet_text` 통과. 어떤 실패든 **None 반환**(모티프는 그대로 upsert).
  - 완료조건: 멀티슬롯 프리뷰 입력 → slot_colors 길이와 같은 라벨 배열; 렌더러 부재/비전 실패 → None.

- **T-B6 [motifs/store.py:119-156 `upsert_motif`]** — `slot_labels: tuple[str,...]|None=None` 파라미터 추가,
  `values["slot_labels"] = list(...) if ... else None`. **라벨은 `NormalizedMotif`/`id` 계산에 넣지 말 것**(M2).
  신규 insert 판별을 위해 `ON CONFLICT DO NOTHING … RETURNING id` 검토(라벨 호출 게이트용).

- **T-B7 [motifs/resolver.py:378-387 `resolve_spec`]** — recraft miss로 generate_motif 후, **`color_slots>1` +
  실제 신규 insert일 때만** `label_slots(...)` 1회 호출→`upsert_motif(slot_labels=...)`. 단일슬롯·카탈로그 재히트는
  스킵(M1). gemini_client를 resolve_spec/resolve_motifs에 새 kwarg로 주입.
  - 완료조건: 신규 멀티슬롯 생성 시 라벨링 1회; **카탈로그/캐시 히트 시 라벨링 호출 0**(회귀 테스트, M1).

- **T-B8 [motifs/scripts/backfill_slot_labels.py 신규]** — 공개 멀티슬롯 중 `slot_labels IS NULL`을 1회 라벨링,
  `UPDATE … WHERE slot_labels IS NULL`. 임베딩 백필과 동형, 멱등·재실행 안전. seed 카탈로그도 포함.

- **T-B9 [motifs/store.py:159-174 `get_motifs`, registry.py:17-22 `MotifDef`]** — `MotifDef`에 `slot_labels`
  (+ 필요 시 `slot_colors`) 필드 추가, `get_motifs`가 `row.slot_labels`(+`row.slot_colors`) 적재. 이게 recolor가
  라벨/원색을 읽는 경로.

- **T-B10 [api/routes.py:435-451 `_bind_resolved_motif_colors`]** — 위 **색 배정 결정 규칙 1·2·3** 구현. 순수
  산술, 외부호출 0. 단일슬롯 ground 충돌 가드는 **전역·전순서 함수**(핫패스 500 금지).
  - 완료조건: 규칙별 단위 테스트(보존/랭크/단일+ground/ NULL-폴백) 통과.

---

## 금지 (하지 말 것)

- **매 recolor를 recraft로 보내는 방식 금지.** geometry 재생성→content-hash 변경→motif_id 불안정→byte-identical·
  재사용 풀 파탄 + 외부 이미지 API를 색 변경마다 과금(120s 타임아웃, full re-normalize). 대안 없음 — B가 이를 대체.
- 요청 시점 색 배정에 LLM/네트워크 호출(콜드 캐시 1회 포함) 금지(M1).
- `slot_labels`를 프롬프트로 재유입시켜 자유 지시화 금지 — 내부 정렬 키로만 사용.

## 실행 순서

1. **C-9/C-10 유지 확인**(M5, 이미 구현) → T-A1 → T-A2 → T-A3 → **T-A4** → T-A5(확인·테스트) → T-A6 → T-A7.  ← A 최소 활성화
2. T-A8(provenance) 후속.
3. T-B3 → T-B4 → T-B5 → T-B6 → T-B7 → T-B8 → T-B9.  ← B1 라벨링 적재
4. T-B1 → T-B2 → **T-B10**.  ← 하이브리드 배정
5. **byte-identical 회귀**: 보존/랭크/NULL-폴백 각 경로, seamless-tile 골든 대조. `id` 불변(M2), 히트 시 라벨링 0(M1).

## 완료 정의

- "펠리컨 넥타이"(카탈로그 미스)→recraft 생성 모티프로 타일 생성, 재요청 시 재사용(생성 호출 0).
- 멀티슬롯 모티프: `color_indices` 생략 시 원색 보존, 명시 시 라벨 랭크로 팔레트 배정, fixed 팔레트는 항상 배정.
- 단일슬롯: 팔레트 색 배정 + ground 충돌 회피.
- 같은 resolved intent+seed → byte-identical SVG 유지(라벨/비라벨 각각). 라벨링·생성은 유입 1회, 핫패스 비용 0.

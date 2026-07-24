# 저작 예시 스튜디오 + few-shot 시드 정리 — 실행 지시서

상태: 실행 대기. 이 문서는 **지시서**다 — 각 작업(T-*)의 위치·지시·완료조건을 그대로 따를 것.
선행/관련: [motif-generation-and-coloring.md](motif-generation-and-coloring.md) ·
[authoring-pipeline-split-decision.md](authoring-pipeline-split-decision.md).

## 배경 / 문제

few-shot RAG 예시(`AuthoringExample`)는 **LLM 출력을 조종하는 입력**이다. 두 가지가 얽혀 있다.

1. **저작이 불편하다.** `source="bootstrap"`은 `gallery-v1.json`을 **타일도 못 보고 모티프 id도 불투명한 채 손편집**해야
   한다. 반복 튜닝에 부적합. → 관리자가 타일을 보고 모티프를 지정하며 저작하는 표면이 필요.
2. **git 파일의 위상이 어정쩡하다.** 현재 `gallery-v1.json`은 골든 SHA·"정확히 25개"·immutable 가드가 붙은
   **버전-잠금 매니페스트**처럼 취급된다. 하지만 운영 셋은 DB에서 늘어나고(`promoted`는 이미 DB 전용), 임베딩까지
   있어 git 벌크 관리는 규모에서 파탄난다(수천 줄 diff·머지 지옥). → **운영 셋의 원천은 DB로 확정**하고, git 파일은
   **빈 환경을 굴리는 시드(starter)로 강등**한다.

## 정신 모델 (집이 둘 — 크기로 가른다)

- **DB = 운영 셋 전체의 원천.** bootstrap-시드된 행 + `authored`(UI 저작) + `promoted`(생성 승격), 규모 무관.
  **런타임(검색 `nearest_examples`)은 언제나 DB만 읽는다.** 이력=승격 후보 테이블 + `approved_by`/`approved_at`/
  `active_reason`/`review_version` 감사 기록. 환경 간 재현=DB 백업/복원.
- **git = 소량 고정 시드(starter)만.** 빈/새 DB(로컬·CI·최초 배포)를 **덤프 넘겨받지 않고** 바로 작동시키는 스타터 셋.
  `seed.py`가 관리자·샘플 상품 넣는 것과 동급의 fixture. **큐레이션 따라 커지지 않는다.** 골든은 여기서 뗀다.
- **벌크 git export 없음.** DB→git 스냅샷 동기화는 하지 않는다. DB에서 저작한 예시를 *영구 기본값*으로 박고 싶으면,
  그때 저작 툴에서 **소량 스타터를 1회 export**해 시드 파일을 교체(예외적·수동·작은 diff).

## 결정 (재론 금지 — 이대로 구현)

- **D1. 원천=DB, git=시드만.** 저작·수정·삭제는 `AuthoringExample`(DB)에 직접. 운영 셋을 git으로 벌크 export 금지.
  시드 파일은 손큐레이션 스타터 전용, 사람이 리뷰 가능한 규모로 유지. **임베딩은 git 금지**(시드 스텝이 재생성).
- **D2. 골든은 시드에서 분리.** 골든은 이미 `apps/worker/tests/golden/json/`의 **테스트 픽스처**다. 시드 매니페스트에서
  `golden_file`/`golden_sha256`를 제거. 컴파일러 byte-identical 회귀는 테스트가 자기 골든으로 계속 수행.
- **D3. 시드는 idempotent insert-if-missing.** `project_manifest`의 "digest 변경 시 raise/update"를 없애고,
  존재하면 **스킵**(`on_conflict_do_nothing`), 없으면 insert. 시드 재실행이 admin이 큐레이션한 활성 행을 건드리지 않음.
  "정확히 25개" 하드 제약 제거(스타터가 소폭 늘 수 있음), id/파일 유일성만 유지.
- **D4. `source="authored"` 신설.** `source`는 자유 문자열 컬럼(`server_default="bootstrap"`) — **마이그레이션 불필요**.
  bootstrap(시드)/promoted(승격)/authored(UI 저작) 3종.
- **D5. 삭제 정책.** `source="authored"`만 하드 삭제 허용(외부 FK 없음). bootstrap/promoted는 기존 활성 토글로 비활성만.
- **D6. 프리뷰는 LLM 없음.** plan → `compile_design_plan_v3` → 렌더 → SVG. 요청·compile 핫패스 불변식(M1) 유지.
- **D7. 신규 페이지 만들지 않음.** 기존 `/authoring-examples`(admin)의 탭을 저작 표면으로 확장. 모티프 피커는 기존
  `GET /admin/.../motifs`(generation.py:1094) 재사용.

## 불변식 (MUST / 위반 금지)

- **M1.** 요청·compile·프리뷰 핫패스에서 LLM 호출 금지. 임베딩은 저작 시점(create/edit)·시드 시점 1회만.
- **M2.** 검색(`retrieval.nearest_examples`)·컴파일러·엔진은 **무변경**. 이 작업은 저작 표면·시드 스크립트만 건드린다.
- **M3.** 저작·시드 예시 모두 활성화 전 `contract_version==PLAN_CONTRACT_VERSION` + `embedding_vertex` +
  `embedding_model` 일치 필수(기존 활성화 가드 재사용). 미검증 예시가 검색 풀에 들어가지 않음.
- **M4.** plan은 항상 `DesignPlanV3`로 검증 후 저장. `family`/`tags`/`structural_fingerprint`는 `examples.py`
  헬퍼(`classify_plan_family`, `tags_for_plan`, `structural_fingerprint`)로만 산출 — 손입력 금지.
- **M5.** 시크릿·supabase 금지, api 스펙 변경 시 `pnpm codegen` 동일 커밋(CI drift).

---

## 작업 T-0 — Rename (UI 라벨만)

- **[admin: pages/authoring/list.tsx, example-detail.tsx]** — "승인 예시" → **"활성 시범"**(또는 "RAG 시범 셋"), 탭
  설명을 "검색(RAG)에 주입되는 intent 시범을 저작·관리"로. 코드 심볼(`example`)·엔드포인트·테이블명 유지, 노출 문구만
  교체.
  - 완료조건: 사용자 노출 문구가 "예시=전시물" 오해를 주지 않음.

## 작업 S — 시드를 시드답게 (골든 분리·제약 제거)

- **T-S1 [worker: authoring/examples.py]** — `AuthoringExampleManifest`에서 `golden_file`/`golden_sha256` 필드
  제거. `load_example_set`의 "정확히 25개" 제약 제거(id/golden 유일성 검사 중 golden 부분 삭제, id 유일성만 유지).
  `gallery-v1.json`에서도 두 필드 삭제.
  - 완료조건: 골든 필드 없는 매니페스트 로드·검증 통과; 항목 수 변화에 로더가 견고.
- **T-S2 [worker: 컴파일러 골든 회귀 테스트]** — 골든 대조 테스트가 매니페스트의 `golden_file` 대신
  `apps/worker/tests/golden/json/`을 **규약(`{example_id}` ↔ 파일명)** 또는 테스트 내 소량 매핑으로 참조하도록 이관.
  - 완료조건: 기존 byte-identical 골든 회귀 **무회귀**(seamless-tile 대조 유지).
- **T-S3 [worker: authoring/store.py `project_manifest`]** — digest 변경 시 raise/재검증 로직 제거. 존재 → 스킵,
  부재 → insert(순수 idempotent). 시드 재실행이 활성 행을 변경하지 않음.
  - 완료조건: 같은 시드 재실행 시 활성/큐레이션 행 무변경; 빈 DB에는 정상 insert.
- **T-S4 [worker: scripts/sync_authoring_examples.py → seed_authoring_examples.py]** — 스크립트를 "시드" 의미로
  정리(이름·독스트링). 동작은 유지: 매니페스트 insert-if-missing + 누락 임베딩 생성. `docker compose` 부트스트랩
  절차(AGENTS.md 명령어)에 이 시드 스텝을 명시.
  - 완료조건: 빈 DB에 시드 실행 → 스타터 예시 활성·임베딩 완비; 재실행 idempotent.

## 작업 A — 프리뷰 (타일을 눈으로)

- **T-A1 [worker: authoring/preview.py 신규 + routes.py]** — `POST /authoring/compile-preview`: body =
  `{plan: DesignPlanV3, motif_ids?, colorway?, seed?, tile_mm?}`. `compile_design_plan_v3(...)` → 기존
  `_render_candidates` 경로 재사용 → `{svg, warnings}`. LLM 없음. `PlanCompileError` → 422.
  - 완료조건: 유효 plan → SVG; 잘못된 plan → 422+사유; LLM/recraft 호출 0.
- **T-A2 [worker: 모티프 해석]** — 프리뷰 시 plan의 모티프 소스를 카탈로그로 해석(generate 경로 resolve 재사용).
  프리뷰에선 recraft 생성 금지 — 카탈로그 히트만, 미스는 경고 후 해당 layer 제외.
  - 완료조건: 카탈로그 모티프 참조 plan이 프리뷰되고, 미해석 모티프는 SVG를 죽이지 않고 경고로 빠짐.
- **T-A3 [api: admin/authoring.py]** — `POST /admin/authoring/preview` 프록시(→ `app.state.worker`), admin 권한.
  - 완료조건: 관리자 인증으로 프리뷰 SVG 수신; 비관리자 403.

## 작업 B — 저작 CRUD (DB)

- **T-B1 [api: admin/authoring.py:517~ 근처]** — `POST /admin/authoring/examples`: body = `{retrieval_text, plan}`
  (+선택 `motif_ids`). `DesignPlanV3` 검증 → `family`/`tags`/`fingerprint` 산출(M4) → 임베딩 요청(T-B4) →
  `source="authored"`, `contract_version=PLAN_CONTRACT_VERSION`, `active=false`로 insert.
  - 완료조건: 유효 입력 → authored 예시 1건(비활성, 임베딩 완비); 중복 fingerprint는 기존 승인 중복 가드로 409.
- **T-B2 [api: admin/authoring.py]** — `PATCH /admin/authoring/examples/{id}`: `source="authored"`만 편집 허용
  (bootstrap/promoted 403). plan/retrieval_text 변경 시 임베딩·fingerprint 재계산, 변경 후 재검증(M3). 낙관적
  잠금(`expected_updated_at`) 기존 패턴 재사용.
  - 완료조건: authored 편집이 임베딩 갱신까지 반영; bootstrap 편집 403; stale 409.
- **T-B3 [api: admin/authoring.py]** — `DELETE /admin/authoring/examples/{id}`: `source="authored"`만 하드 삭제
  (D5). 그 외 409+"비활성만 가능".
  - 완료조건: authored 삭제·검색 풀에서 제거; 그 외 소스 삭제 거부.
- **T-B4 [worker: routes.py]** — `POST /authoring/examples/embedding`: `{retrieval_text, family, tags}` →
  `embedding_document(...)` → 임베딩 → `{model, embedding}`. (`ensure_authoring_promotion_embedding`의 저작판.)
  create/edit가 호출. 미구성 시 503.
  - 완료조건: create/edit가 현재 worker 임베딩 모델로 벡터 저장; 모델 불일치 예시는 활성화 불가(M3).
- **T-B5 [api-client 재생성]** — 스펙 추가 후 `pnpm codegen`, 생성물 동일 커밋(M5).

## 작업 C — admin UI (기존 페이지 확장)

- **T-C1 [admin: pages/authoring/list.tsx]** — "활성 시범" 탭에 "새 시범 작성". 폼: `retrieval_text` + plan 편집(JSON
  에디터로 시작, 검증) + **모티프 피커**(기존 `GET /admin/.../motifs` 재사용) + **프리뷰 패널**(T-A3로 타일 SVG). 저장
  → T-B1.
- **T-C2 [admin: example-detail.tsx]** — authored 예시에 편집/삭제(T-B2/T-B3), 프리뷰 재렌더. bootstrap/promoted는
  활성 토글만.
  - 완료조건: 폼에서 plan 작성 → 프리뷰로 타일 확인 → 저장 → 활성화까지 브라우저(Aside)로 검증.

---

## 금지 (하지 말 것)

- 운영 few-shot 셋을 git으로 벌크 export/스냅샷(D1). git엔 소량 시드만.
- 임베딩을 git에 커밋(D1).
- 프리뷰/요청/compile에 LLM·recraft·네트워크 호출(M1). 프리뷰는 카탈로그 히트만.
- 검색·컴파일러·엔진 수정(M2).
- 시드 매니페스트에 골든 SHA 재결합(D2), 시드 재실행이 활성 행을 mutate(D3).
- plan/family/tags/fingerprint 손입력(M4).

## 실행 순서

1. **T-S1 → T-S2 → T-S3 → T-S4**(시드를 시드답게) ← 골든 분리·제약 제거가 먼저.
2. T-A1 → T-A2 → T-A3(프리뷰) ← "타일 눈으로"의 핵심.
3. T-B4 → T-B1 → T-B2 → T-B3 → **T-B5(codegen)**(저작 CRUD).
4. T-C1 → T-C2(admin UI) + **T-0 rename**.

## 완료 정의

- 관리자가 `/authoring-examples`에서 새 시범을 작성하며 **모티프를 피커로 지정**하고 **타일을 프리뷰로 확인**한 뒤
  저장·활성화한다(LLM 호출 0). 저작 예시는 DB에 산다.
- git 시드 파일은 골든/카운트/immutable 없이 **빈 DB를 굴리는 스타터**로만 존재. 시드 재실행 idempotent, 활성 행 무변경.
- 검색·컴파일러·byte-identical 골든 회귀 **무회귀**(M2, T-S2). 임베딩은 git에 없음.

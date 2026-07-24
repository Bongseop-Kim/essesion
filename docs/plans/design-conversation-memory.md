# 디자인 대화 메모리(세션 문맥 이어받기) — 실행 지시서

상태: 실행 대기. 이 문서는 **지시서**다 — 각 작업(T-*)의 위치·지시·완료조건을 그대로 따를 것. `DesignSessionTurn`
주석의 "/design 신규 기획(5단계)"이 이 문서다. 연계: [motif-generation-and-coloring.md](motif-generation-and-coloring.md)(T-M3).

## 전제

- 같은 `design_session`의 후속 프롬프트는 앞선 대화와 **선택·커밋된 디자인**을 이어받는다. `새로 만들기`(새 세션)만 빈 문맥.
- 현재 결손: `design_sessions.current_intent`와 턴 골격은 있으나, `POST /design/generate`가 요청 body만 워커로 전달해
  같은 세션의 후속 문장이 독립 프롬프트로 저작된다(`api/domains/design/router.py`).
- 후속(refine) 저작은 **선택 디자인 전체를 다시 저작**한다(patch 스키마 아님 — 아래 M4·금지 참조).
- 멀티턴은 Gemini `generateContent`에 매 호출 전체 문맥을 직접 조립해 보낸다. Interactions API(`previous_interaction_id`)는
  기본 `store=true`·보존기간 이슈로 **미채택**.

## 불변식 (MUST / 위반 금지)

- **M1.** `current_intent`=렌더 재현 정본, `current_plan`=대화 의미 정본(provider-safe DesignPlanV3). 엔진 intent를
  자연어로 역추론 금지.
- **M2. 문맥 이어받기는 명시적 선택→커밋으로만.** 사용자가 후보를 선택·커밋하지 않으면 이어지지 않는다(이 모호성은
  수용 — 에러 아님).
- **M3. 선형.** `current_plan`은 마지막 커밋된 선택만 전진. **히스토리에서 과거 후보를 골라 편집(분기)하는 기능은 만들지
  않는다.**
- **M4. 한 오소링 호출 = 하나의 모티프 소스 집합(초기·refine 공통).** 후보들은 구조·배치·색만 다르고 **모티프/주제는
  동일**하다. 후보별 다른 주제(A=꿀벌, B=나비) 금지 — prompt 지시 + **하드 가드**로 강제.
- **M5. refine = 오소링 1회(비싼 것) + 결정론 재배치로 최대 4후보(저렴한 것).** refine엔 `author_designs`의
  `>=2 distinct` 강제를 **적용하지 않는다**.
- **M6. byte-identical.** 커밋된 `current_intent`가 렌더 정본. 재저작은 비결정론(LLM)이나 커밋 시 freeze되므로 계약 유지
  — 같은 seed 재현은 커밋 후에만 기대.
- **M7.** 과거 사진 재전송 금지. **커밋 시 해석된 concrete `motif_id`를 세션에 스냅샷**해 refine이 참조(dangling
  reference 방지). 이번 턴 재첨부 사진만 binary part.
- **M8.** 모델 문맥에 SVG·후보 전체 응답·private motif ID·provider 오류 원문 금지. 과거 model 발화는 서버가 semantic
  plan에서 만든 짧은 설명.
- **M9.** 스키마 변경 시 `pnpm codegen`으로 api-client 재생성, 같은 커밋. DDL은 Alembic(`db/`) 경유만.

---

## 작업 S — 세션 상태

- **T-S1 [db/ Alembic 신규 + models/design.py:29-44]** — `DesignSession`에 추가:
  `current_plan JSONB NULL`(선택 디자인의 provider-safe DesignPlanV3, 모티프는 concrete motif_id로 스냅샷 M7),
  `context_version BIGINT NOT NULL DEFAULT 0`(선택/대화 상태 변경 시 증가), `active_generation_id UUID NULL`,
  `active_generation_started_at TIMESTAMPTZ NULL`. `conversation_summary`는 **미추가**(지연).
  - 완료조건: 마이그레이션 왕복, 기존 세션 기본값 정상.

## 작업 T — 턴 & 선택 커밋

- **T-T1 [models/design.py:47-60 payload 스키마 확정]** — `role ∈ {user, assistant}`.
  user payload = `{prompt, palette, pattern_constraints, attachment_refs}`.
  assistant payload = `{run_id, status: succeeded|error, candidate_summaries:[{design_index, short_desc,
  structural_fingerprint}], error?:{stage, code}}`. 첨부는 기존 `DesignTurnAttachment` 재사용.
  - 완료조건: payload pydantic 스키마 + testcontainers 저장/조회.

- **T-T2 [design/router.py 선택 커밋 액션]** — 후보 선택 = 선택한 `design_index`의 `(intent, plan)`을
  `current_intent`+`current_plan`에 **원자 커밋**, `context_version++`, 선택 턴 기록. plan은 **해석된 concrete
  motif_id로 스냅샷**(M7).
  - 완료조건: 선택 후 세션에 두 값이 원자적으로 반영, motif가 concrete로 고정.

## 작업 C — API 문맥 빌더

- **T-C1 [design/router.py generate 핸들러]** — body-only 전달을 교체: `session_id` 소유권 확인 후
  `current_plan`/`current_intent`, 최근 **성공 턴 ≤6쌍**, 이번 턴 첨부를 읽어 provider-safe `ConversationContext`를
  구성해 워커에 전달. 일반 채팅 계약에서 client 제공 `intent`/`mode` 제거(기존 seed reroll은 별도 내부 경로 유지).
  - 완료조건: 같은 세션 후속 요청이 문맥 포함으로 워커 호출.

- **T-C2 [ConversationContext 직렬화]** — M8 준수: SVG/원본 응답/private ID 제외, 과거 model 발화는 semantic plan
  기반 짧은 설명. 과거 사진은 역할·이름만, 이번 턴 재첨부 사진만 binary part.
  - 완료조건: 직렬화 문맥에 금지 필드 부재(테스트).

## 작업 R — 워커 refine 오소링 (전체 재저작)

- **T-R1 [adapters/gemini.py refine 경로]** — `current_plan`이 오면 `complete_model(prompt, DesignPlanV3)`로
  **단일** plan 재저작(2-4 distinct의 `DesignPlansV3` 경로는 초기 턴 전용). `_build_prompt` 변형: `<current_design>`
  권위 블록 + **"언급하지 않은 것은 전부 보존, 요청한 것만 변경"** + 단일 출력. 첫 턴(base 없음)은 기존 초기 경로.
  - 완료조건: refine이 evolved plan 1개 반환, 미언급 요소 보존.

- **T-R2 [preserve 가드]** — 재저작 결과를 `current_plan`과 대조해 **요청 범위 밖 구조 변경을 거부/원복**(드리프트 방지).
  결정론적 대조(변경 허용 필드 화이트리스트 or 미변경 부분 지문 비교).
  - 완료조건: "스트라이프 추가"에 도트 구조·색 불변; 무단 변경 시 재시도/원복.

- **T-R3 [routes 후보 팬아웃]** — refine의 evolved plan 1개 → compile → `generate_candidates`(layout/colorway/seed)로
  **최대 4후보**. refine엔 `>=2 distinct` 미적용(M5).
  - 완료조건: refine이 같은 모티프의 배치/색 변주 최대 4후보 반환.

## 작업 M — 모티프 단일 집합 불변식 (M4 강제)

- **T-M1 [gemini.py `_build_prompt`]** — 초기 `DesignPlansV3` 경로에 "**모든 plan은 동일한 모티프 소스**를 사용,
  구조/배치/색만 다르게" 문구 추가.

- **T-M2 [author_designs 하드 가드]** — 반환된 plan들의 모티프 소스 집합이 서로 다르면 **거부**(prompt-only 불신).
  현재 `structural_fingerprint`가 모티프 정체성을 안 봐서(`schema.py:277`, `motif_count`만) 후보별 다른 카탈로그
  모티프가 새어나가는 것을 여기서 차단.
  - 완료조건: 서로 다른 모티프 조합의 plan 세트가 거부되고 재저작 유도.

- **T-M3 [motif 플랜 연계]** — generate-on-miss가 **plan별 다른 subject를 `generate`하지 못하게**(한 호출 = 하나의
  subject). [motif-generation-and-coloring.md] T-A2/T-A3 구현 시 이 제약 동시 반영.

## 작업 F — 실패 / 동시성 / 복구 (최소)

- **T-F1 [active run 가드]** — 세션에 `active_generation_id`가 있으면 `generation_in_progress`로 거부. 없으면 run
  ID·사용자 턴 기록 + 토큰 차감 후 커밋. API는 외부 호출 중 DB tx/advisory lock을 잡아두지 않는다.
  - 완료조건: 동시 2요청 중 1개만 시작, 토큰 중복 차감 없음.

- **T-F2 [만료 복구]** — worker timeout보다 긴 명시 만료 이후에만 active run 해제. `generation_jobs` stale 패턴
  (`FINALIZE_STALE`, `design.py:20-26`) 재사용 — 새 만료 로직 발명 금지.

- **T-F3 [실패 턴·환불]** — provider 실패 시 같은 run_id로 assistant error 턴 기록, 기존 방식 환불, active run 해제.
  실패한 사용자 문장은 화면엔 남되 다음 model 문맥에선 제외.

---

## 금지

- **후보별 다른 모티프/주제 생성 금지**(M4). "A=꿀벌, B=나비"는 초기·refine 모두 차단.
- **히스토리 분기 편집 금지**(M3) — 과거 후보를 골라 갈라져 나가는 기능 안 만듦. 꼬이면 새 세션이 탈출구.
- **patch 스키마(전면 optional DesignPlan) 금지** — 전체 재저작 채택. all-optional은 constrained decoding에서
  필드 누락 실패 모드(`schema.py:102-106`) 회귀.
- 요청 시점 색·렌더 결정론 경로에 LLM/네트워크 호출 금지.
- LangGraph·외부 vector memory 도입 금지 — 현재 테이블이 thread persistence·도메인 상태를 이미 소유.

## 실행 순서

1. **MVP** — T-S1 → T-T1 → T-T2 → T-C1 → T-C2 → T-R1 → T-R3 → T-M1 → T-M2 → T-F1.
   (선택 기억 + refine 전체 재저작 + 4후보 + 모티프 단일집합 + 동시성 1개)
2. **하드닝** — T-R2(preserve 가드 정교화) → T-F2 → T-F3.
3. **연계** — T-M3(motif 플랜 착수 시점에 동시).
4. **지연** — `conversation_summary`/token guard는 실제 긴 세션 지표가 생긴 뒤에만.

## 완료 정의

- 같은 세션에서 "네이비 도트" 생성·선택 후 "스트라이프 추가해줘" → 네이비·도트 유지, stripe만 추가.
  **후보 4개는 모두 같은 네이비-도트-스트라이프 모티프의 배치/색 변주**(구조·주제 갈라짐 없음).
- 같은 문장을 새 세션에서 보내면 이전 색·모티프 미전달.
- 후보가 서로 다른 주제(꿀벌/나비)로 갈리면 거부(초기·refine 공통).
- 선택하지 않으면 이어받지 않는다(모호성 수용, 에러 아님).
- 동시 요청 두 건 중 하나만 시작, 토큰 중복 차감/늦은 응답 덮어쓰기 없음.
- provider 실패도 사용자 턴·단계별 오류가 화면에 남고 토큰 환불.
- 같은 resolved intent+seed → byte-identical SVG(커밋 후).

## 열린 질문

- refine 후보 변주 축: colorway/seed만 vs 경미한 layout 재배치 포함?
- preserve 가드의 "요청 범위" 판정: 변경 허용 필드 화이트리스트 vs 미변경 부분 지문 대조 — 구체 규칙?
- `current_plan` 모티프 스냅샷 직렬화: concrete `motif_id`를 어떤 motif source 형태로 담을지?

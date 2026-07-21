# Design conversation memory

상태: 구현 제안. 명시적인 `새 디자인 / 선택 디자인 수정` 모드는 제거했으며, 이 문서는
세션 자체를 대화 경계로 사용하는 후속 구현의 기준이다.

## 결정

- 같은 `design_session`의 모든 프롬프트는 앞선 대화와 현재 선택 디자인을 이어받는다.
- `새로 만들기`로 생성한 새 세션만 빈 문맥에서 시작한다.
- PostgreSQL의 `design_sessions`와 `design_session_turns`가 유일한 정본이다. worker와
  Gemini는 세션을 소유하지 않는다.
- 브라우저는 과거 intent나 전체 턴을 다시 조립하지 않는다. API가 소유권 확인 후 세션
  문맥을 구성한다.
- 모델에는 SVG, 후보 전체 응답, private motif ID, provider 오류 원문을 보내지 않는다.

## 조사 근거

- Gemini `generateContent`의 멀티턴은 매 호출마다 `user`와 `model` Content를 교대로 담은
  전체 문맥을 호출자가 전송하는 방식이다. SDK chat도 내부적으로 같은 API에 전체 이력을
  다시 보낸다: <https://ai.google.dev/gemini-api/docs/generate-content/text-generation>
- Gemini Interactions API는 `previous_interaction_id`를 제공하지만 기본 `store=true`이고
  유료 tier의 기본 보존 기간은 55일이다. `store=false`에서는 해당 ID를 사용할 수 없다:
  <https://ai.google.dev/gemini-api/docs/interactions-overview>
- Stateless Interactions는 model thought/tool step과 서명을 원형 그대로 다시 보내야 한다.
  현재의 provider 비종속·최소 진단 정책에는 `generateContent`의 직접 Content 조립이 더
  단순하다: <https://ai.google.dev/gemini-api/docs/text-generation>
- Gemini는 `countTokens`로 대화 이력을 포함한 입력 크기를 사전에 계산할 수 있다:
  <https://ai.google.dev/api/tokens>
- 일반적인 thread memory도 전체 이력은 영속 보관하되 모델 입력은 trim 또는 running
  summary로 제한한다: <https://docs.langchain.com/oss/python/langgraph/add-memory>
- 긴 문맥은 중요한 정보가 중간에 있을 때 활용률이 낮아질 수 있으므로 현재 상태를
  권위 있는 구조화 블록으로 매 요청에 다시 제공한다:
  <https://arxiv.org/abs/2307.03172>

## 현재 결손

`design_sessions.current_intent`와 순서가 있는 `design_session_turns`는 이미 존재하지만,
`POST /design/generate`는 요청 body만 worker로 전달한다. 따라서 동일 세션의 후속 문장이
독립 프롬프트로 저작된다. UI 모드 추가로 이 결손을 브라우저에 떠넘기지 않고 API가 세션
상태를 읽도록 고친다.

## 목표 요청 계약

브라우저의 일반 생성 요청은 다음 정보만 보낸다.

```json
{
  "session_id": "uuid",
  "prompt": "스트라이프 추가해줘",
  "reference_images": [],
  "user_motif_ids": [],
  "palette": {"mode": "auto", "colors": []},
  "pattern_constraints": {
    "motif_scale": "auto",
    "density": "auto",
    "arrangement": "auto",
    "direction": "auto"
  },
  "candidate_count": 4
}
```

`mode`와 client 제공 `intent`는 일반 채팅 계약에서 제거한다. `다시 만들기`는 자연어
메시지와 섞지 않는 기존 seed reroll 액션으로 유지할 수 있지만 별도 내부 경로로 분리한다.

## 세션 상태

`design_sessions`에 다음 상태를 추가한다.

- `current_plan JSONB NULL`: 사용자가 선택한 후보의 provider-safe semantic `DesignPlan`.
- `context_version BIGINT NOT NULL DEFAULT 0`: 선택 또는 대화 상태가 바뀔 때 증가한다.
- `active_generation_id UUID NULL`, `active_generation_started_at TIMESTAMPTZ NULL`: 동일 세션의
  생성 두 건이 서로 다른 과거 상태를 기준으로 동시에 실행되지 않게 한다.
- 긴 세션 최적화가 실제로 필요해질 때만 `conversation_summary JSONB`를 추가한다.

`current_intent`는 렌더 재현의 정본이고 `current_plan`은 대화 의미의 정본이다. 엔진 intent를
다시 자연어로 역추론하지 않는다. 후보 응답은 `design_index`로 intent와 semantic plan을
같이 가리키며, 선택 턴에서 두 값을 원자적으로 세션에 커밋한다.

## 한 턴 처리

1. API가 세션 소유권을 확인하고 현재 plan/intent, 최근 성공 턴, 첨부 메타데이터를 읽는다.
2. `active_generation_id`가 있으면 `generation_in_progress`로 거부한다. 없으면 run ID와 사용자
   턴을 기록하고 토큰을 차감한 뒤 커밋한다.
3. API가 provider-safe `ConversationContext`를 구성해 stateless worker에 전달한다.
4. worker는 새 프롬프트를 semantic patch로 저작하고 기존 plan에 결정적으로 병합한 뒤
   기존 compiler와 validator로 후보를 만든다.
5. 성공 시 assistant generation 턴을 추가하고 run을 끝낸다. 사용자가 후보를 선택하면
   intent와 plan을 함께 `current_*`에 커밋한다.
6. 실패 시 같은 run ID의 assistant error 턴을 남기고 기존 방식으로 환불한 뒤 active run을
   해제한다. 실패한 사용자 문장도 대화 화면에는 남지만 다음 모델 문맥에서는 제외한다.
7. 프로세스 중단으로 active run이 남으면 worker timeout보다 긴 명시적 만료 시간 이후에만
   복구한다.

API가 외부 호출 중 DB transaction이나 advisory lock을 계속 잡아 두지는 않는다.

## 모델 문맥

모델 입력은 다음 순서로 만든다.

1. 고정 system instruction과 structured-output schema
2. 선택된 `current_plan`을 나타내는 권위 있는 `<current_design>` 블록
3. 선택적으로 누적된 짧은 `<session_summary>`
4. 최근 성공 대화 6쌍 이내의 `user`/`model` Content
5. 현재 사용자 문장과 이번 턴 첨부·명시 제약

과거 model Content는 SVG나 원본 provider 응답이 아니라 서버가 semantic plan에서 만든
짧은 설명을 사용한다. 과거 사진은 다시 전송하지 않고 역할·이름만 문맥에 남기며, 현재
턴에 다시 첨부된 사진만 binary part로 보낸다.

후속 저작에는 전체 plan을 다시 만들게 하지 않고 optional `DesignPlanPatch`를 사용한다.
예를 들어 “스트라이프 추가해줘”는 `{ "stripes": true }`만 반환하고, 색·모티프·배치 등
언급하지 않은 필드는 `current_plan`에서 코드가 보존한다. 첫 턴에는 base가 없으므로 완전한
`DesignPlan`을 요구한다. exact motif ID는 계속 provider 밖에서 intent와 결합한다.

## 문맥 크기

- 모든 턴은 DB에 보존하지만 모델에는 현재 plan과 최근 성공 6쌍만 기본 제공한다.
- SVG, intent 원문, 후보 배열, 실패 stack/provider 응답은 모델 문맥에서 제외한다.
- 직렬화된 문맥이 정한 soft limit에 가까워질 때 Gemini `countTokens`로 확인한다.
- 한도를 넘기기 시작한 데이터가 확인된 뒤에만 오래된 턴을 structured running summary로
  축약한다. 요약은 기존 summary와 새로 밀려난 턴만 입력으로 받아 누적한다.
- 입력 token 수, 포함 turn 수, summary 사용 여부를 기존 generation diagnostics에 기록한다.

## 구현 순서

1. `current_plan`, context version, active run용 Alembic과 모델을 추가한다.
2. worker 응답에 plan을 추가하고 후보 선택 시 intent+plan을 원자 커밋한다.
3. 일반 generate body에서 mode/intent를 제거하고 API `ConversationContextBuilder`가 세션을
   읽도록 변경한다.
4. `DesignPlanPatch` schema, deterministic merge, history-aware Gemini `contents`를 구현한다.
5. 실패 턴·환불·active run 복구와 Admin 진단을 연결한다.
6. 실제 긴 세션 지표가 생긴 뒤 token guard와 running summary를 활성화한다.

LangGraph나 별도 vector memory는 도입하지 않는다. 현재 테이블이 이미 thread persistence와
도메인 상태를 소유하며, 과거 디자인 대화는 세션 밖 장기 기억으로 검색할 요구가 없다.

## 완료 조건

- 같은 세션에서 “네이비 도트” 생성·선택 후 “스트라이프 추가해줘”를 보내면 네이비·도트는
  유지되고 stripe만 추가된다.
- 같은 문장을 새 세션에서 보내면 이전 세션의 색·모티프가 전달되지 않는다.
- A/B 세션을 오가도 plan, intent, 최근 턴이 섞이지 않는다.
- “두 번째 디자인처럼” 같은 표현은 최근 assistant 후보 요약과 선택 턴을 통해 해석된다.
- 동시 요청 두 건 중 하나만 시작되며 토큰 중복 차감이나 늦은 응답의 상태 덮어쓰기가 없다.
- provider 실패도 사용자 턴과 단계별 오류가 화면에 남고 토큰은 환불된다.
- 30턴 세션에서도 current plan 보존 검사가 통과하고 입력 token budget을 넘지 않는다.
- 세션 삭제 후 서비스 DB에 대화 상태가 남지 않으며 provider-side conversation ID에 의존하지
  않는다.


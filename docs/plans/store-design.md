# store /design (C12) 신규 기획 — seamless 플로우

> YeongSeon `/design`(채팅형 AI 타일 생성, Supabase edge `generate-tile`)을 essesion store `/design`으로 **신규 설계**.
> ARCHITECTURE의 **보존 예외** 항목 — 기능 명세 보존 대상이 아니며, worker(seamless 엔진) 계약에 맞춰 화면·플로우를 새로 정의한다.
> 근거 문서: [worker-refactor.md](../specs/worker-refactor.md)(범위 밖 표) · [worker-pipeline.md](../api-spec/worker-pipeline.md) · [worker-engine.md](../api-spec/worker-engine.md) · ARCHITECTURE §2·§4·§7.
> **백엔드 선행 변경 있음(§2)** — BE1·BE3·BE5 완료 + `pnpm codegen` 후 프론트 착수.

## 0. 구현이 강제하는 전제 (분석 결과)

| 축 | 현재 구현 | 프론트 설계 귀결 |
|---|---|---|
| generate | `POST /design/generate` **동기**(Gemini 작성 + 모티프 해석 + 렌더, 수십 초). 후보 1~8개, 각 후보에 **SVG 인라인** + 프리뷰 `png_object_key`. 결정론: (intent, seed, colorway, registry_version) 동일 → SVG 바이트 동일 | 폴링 불필요·로딩 상태만. 후보는 SVG 직접 렌더(확대 무손실, 타일 반복 프리뷰가 클라 무료). "재생성"은 결정론 정제로 대체(§4) |
| finalize | `POST /design/sessions/{id}/finalize` → GenerationJob(Cloud Tasks) → `GET /design/jobs/{id}` **폴링**. production_method(print/yarn_dyed)·weave 7종·dpi. 세션당 예산 10회(`finalize_used`) | 잡 폴링 UX(§6). 원단 시뮬레이션을 1급 기능으로 노출 |
| export | `POST /design/export` 동기·**무과금**. SVG→PNG/TIFF, dpi·치수는 워커가 최종 권위 | 다운로드 다이얼로그(형식·dpi 선택) |
| 과금 | generate 1회당 토큰 선차감(후보 수 무관), 워커 실패 시 자동 환불(422/502 구분). `refund_pending`이면 차단 | 잔액·비용 상시 표시, 부족 시 충전 유도(§4-5) |
| 세션 | `design_sessions`(seed·colorway·current_intent·예산 카운터) + `design_session_turns`(seq·role·payload) — api 소유, CRUD·SDK 생성 완료. **턴 payload 스키마 미정 → 이 문서 §5에서 확정** | 세션 목록·이어하기를 정식 기능으로 포함 |
| 모티프 게이트 | `/sessions/{id}/motifs/{candidates,generate}` 프록시 존재(Recraft 예산 3회). 단 generate 경로가 모티프를 **자동 해석**(재사용 래더→생성) | 게이트 UI는 v1 불필요 — 이연(§7) |
| 스토리지 | worker 업로드(previews/·fabric/)는 **공개 assets 버킷**(allUsers read, content-addressed 키). `/images/read-url`은 images 테이블 등록분 전용이라 fabric 결과에 사용 불가 | finalize 결과는 BE3의 `result_url`로 표시(§2) |

## 1. 범위

- **라우트 1개 신설**: `/design` — **공개 라우트**(헤더 nav에 링크 기존재). 전송·배리에이션·finalize·export·세션 조회 등 액션·데이터는 `useAuthGuard().requireAuth` / 로그인 상태 분기. `/login` 직접 이동 금지(store 규칙).
- **feature 신설**: `features/design` (세션·턴 쿼리, generate/finalize 훅, 컴포저·후보·프리뷰·finalize UI, custom-order용 피커).
- **custom-order 연결 (C5 D12 이행)**: `features/custom-order` attachment 섹션의 `pickerSlot`에 "내 AI 디자인에서 선택" 피커 주입 — finalize 성공물 목록(BE3) 기반.
- **AppLayout 변경**: `/design`을 집중형(immersive) 라우트로 — 푸터 숨김 + main 뷰포트 고정 높이(§9).
- **제외 (v2 이연** — worker-refactor.md "범위 밖" 표와 정합): 이미지 첨부 입력(워커 reference_image·vectorize 미구현), glyph 텍스트-as-모티프(워커 R1 가드가 스펙 거부 — warnings 노출만), 모티프 게이트 UI(자동 해석으로 충분), `/palettes` 명명 프리셋 recolor, 대화형 편집 툴콜(swap_motif 등), material_map·texture/relief strength 고급 노브(finalize 기본값 사용).

## 2. 선행 백엔드 변경 (프론트 착수 전 완료, api 스펙 변경 → `pnpm codegen` 동커밋)

### BE1 (필수) — generate 응답에 resolved intent 포함

- **현재**: 워커 `GenerateResponse`에 후보(svg·seed·colorway_id·layout_id)만 있고 **intent가 없다**. resolved intent는 `seamless_generation_logs`에만 저장. api는 클라가 intent를 직접 준 경우에만 `session.current_intent`를 채우므로, **prompt로 시작한 세션은 current_intent가 영영 비어 finalize가 항상 409**("finalize할 intent가 없습니다")가 된다. 배리에이션(같은 intent+새 seed)도 불가능.
- **목표**: 워커 `GenerateResponse`에 `intents: list[dict]`(design_index 순 resolved intent) 추가 → api `DesignGenerateOut`에 전파. 프론트는 후보 선택 시 `PATCH /design/sessions/{id}`로 `{current_intent: intents[design_index], seed, colorway}`를 확정한다.
- **함께**: api generate가 세션 경로에서 **user 턴도 함께 기록**(§5 스키마) — 현재는 assistant 턴만 기록해 클라 이탈 시 요청 기록이 소실된다. 턴 기록이 차감·워커 호출과 같은 요청 안에서 끝나므로 순서·원자성이 보장된다.
- 수용: prompt 생성 → 후보 선택 PATCH → finalize 성공 E2E(실 Postgres 인가 테스트 포함), 골든 27세트 byte-identical 불변(SVG 출력 경로 무변경 — 응답 필드 추가만).

### BE2 (권장) — generate 클라 이탈 보호

- **현재**: 토큰 선차감 커밋 후 워커 호출 대기 중 클라가 disconnect하면 핸들러 태스크가 취소될 수 있다 → 환불도 턴 기록도 없이 토큰만 소실.
- **목표**: 차감 이후 구간(워커 호출→턴 기록→커밋)을 `asyncio.shield`(또는 등가)로 보호해 클라 이탈과 무관하게 완주. 완주하면 복귀 시 턴 조회로 결과 복구가 성립(§4-6 pending UX의 전제).
- 수용: 요청 취소 주입 테스트에서 차감-환불 정합(둘 다 있거나 둘 다 없음) + 턴 기록 존재.

### BE3 (필수 — picker 의존) — 완성물(잡) 목록 + result_url

- **목표**: `GET /design/jobs` (본인 것만, 쿼리: `kind=finalize`·`status=succeeded`·`session_id?`·페이지네이션) 신설. `GenerationJobOut`(목록·단건 공통)에 **`result_url: str | null`** 추가 — `result.object_key`를 공개 assets 버킷 URL로 변환해 api가 계산(프론트에 버킷명 env 드리프트 방지).
- 용도: ① custom-order "내 AI 디자인에서 선택" 피커 ② 세션 이어하기 시 원단 시뮬레이션 결과 복원 ③ 폴링 단건 조회의 결과 표시.
- 수용: 소유자 인가 테스트(타인 잡 404/403), result_url 형식 검증.

### BE5 (권장) — 생성 비용 노출

- **현재**: 생성 1회 토큰 비용(`design_token_cost_openai_render_standard` admin setting)이 어떤 공개 API에도 없다 — 원본은 부족 에러 body에만 cost가 있었다.
- **목표**: `GET /tokens/balance` 응답에 `generate_cost: int` 추가. UI가 "생성 1회 = N토큰"을 사전 표시(사후 실패 안내보다 우수).
- 수용: 잔액 응답 스키마 테스트 + codegen.

*(BE4 — finalize 실패 시 `finalize_used` 환급 — 은 v1 보류: 예산 10회로 여유, 정책 결정만 D8에 기록.)*

## 3. 화면 구조 — 하이브리드 (확정: 대화 턴 피드 + 작업 패널)

```text
데스크톱 (lg↑)                              모바일
┌─────────────┬──────────────────┐         ┌──────────────────┐
│ 프리뷰 패널  │ 세션 패널          │         │ 세션 피드          │
│ (좌 1/2)    │ (우 1/2)          │         │  · 턴/후보 그리드   │
│ · 넥타이/    │ · 세션 헤더(제목·   │         │  · 후보 탭 →       │
│   타일 토글  │   세션 목록 열기)   │         │    프리뷰 모달      │
│ · 확대(호버  │ · 턴 피드(스크롤)   │         ├──────────────────┤
│   돋보기)    │   - user 프롬프트   │         │ 선택 액션 바        │
│ · 선택 후보  │   - 후보 그리드     │         │ (배리에이션·내보내기·│
│   액션 바    │   - finalize 결과  │         │  원단 시뮬레이션)    │
│             │ · 컴포저(하단 고정)  │         ├──────────────────┤
│             │   입력+칩+잔액+전송  │         │ 컴포저(하단 고정)    │
└─────────────┴──────────────────┘         └──────────────────┘
```

- **세션 패널이 주 무대**: 턴 피드가 대화 이력(요청→후보→finalize 결과)을 시간순으로 누적. 후보 그리드에서 선택하면 프리뷰 패널(모바일은 모달)이 갱신되고 선택 액션이 활성화된다.
- **프리뷰 패널**(데스크톱)/**프리뷰 모달**(모바일): 선택 후보의 SVG를 ① 타일 반복(seamless 확인) ② 넥타이 실루엣 마스크(상품 맥락) 두 모드로 렌더. 원본의 돋보기(데스크톱 호버)·핀치줌(모바일)을 재현하되 SVG라 확대 무손실.
- **세션 목록**: 세션 헤더의 "내 세션" → 데스크톱 `Menu`/모바일 `SwipeableMenuSheet`가 아니라 **ResponsiveModal**(목록이 카드형 — 썸네일 없음, `created_at`·상태·finalize 사용량 표시). 선택 시 해당 세션 로드. 원본에서 코드만 있고 페이지에 연결되지 않았던 히스토리를 이번엔 정식 포함.
- SVG 렌더는 **이미지 컨텍스트로만**(data URI를 `<img>`/CSS `background-image`) — `dangerouslySetInnerHTML` 금지. 워커 sanitize(allowlist)가 1차 방어지만 문서 삽입 자체를 하지 않는 것이 프론트 계약.

## 4. 흐름 시퀀스 (확정 계약)

```text
/design (공개)
  ├─ 최초 진입: 온보딩 다이얼로그(선염/날염 2页, localStorage 완료 플래그)
  ├─ 비로그인: 컴포저·예시 프롬프트는 보이되 전송 시 requireAuth
  ├─ [전송] (prompt, candidate_count 1~4 기본 4)
  │    └─ 세션 없으면 POST /design/sessions → POST /design/generate {session_id, prompt, candidate_count}
  │         · 로딩: 후보 스켈레톤 4타일 + "디자인을 생성하고 있어요 (수십 초 소요)" — 동기 응답 대기
  │         · 성공: 턴 피드에 후보 그리드 append(서버가 user+assistant 턴 기록 — BE1), 잔액 invalidate
  │         · warnings: 후보 그리드 상단 Callout(neutral) — glyph 거부·diversity shortfall 등
  │         · 실패 422: "요청을 이해하지 못했어요" + 프롬프트 수정 유도 (토큰 자동 환불 문구)
  │         · 실패 502/503: "일시적인 오류" + [다시 시도] (토큰 자동 환불 문구)
  │         · insufficient_tokens: Callout(warning) + [토큰 충전하기 → /token/purchase]
  │         · refund_pending: "환불 심사 중에는 생성할 수 없어요" 안내
  ├─ [후보 선택] → PATCH /design/sessions/{id} {current_intent: intents[design_index], seed, colorway}
  │    └─ 클라가 select 턴 append(§5) → 프리뷰 갱신 + 선택 액션 활성화
  ├─ [배리에이션] (선택 후보 기준, 재과금 — 버튼에 "N토큰" 표기)
  │    └─ POST /design/generate {session_id, intent: current_intent, seed: 새 시드, candidate_count}
  ├─ [다르게 요청] = 컴포저에 새 프롬프트 입력(같은 세션 누적)
  ├─ [내보내기] (무료) → ResponsiveModal: 형식 png/tiff · dpi 150/300/600 · 폭 mm
  │    └─ POST /design/export {session_id, svg, format, dpi, width_mm} → blob 다운로드
  ├─ [원단 시뮬레이션] (finalize, 세션당 10회 — 잔여 횟수 표기)
  │    └─ ResponsiveModal: 방식 print/yarn_dyed(온보딩과 동일 어휘: 날염/선염) → weave 선택
  │         (print는 twill-0/twill-45만 노출 — 서버 게이트 선반영. dpi 기본 300 고정)
  │       → POST /sessions/{id}/finalize → 잡 폴링(§6) → 결과 원단 PNG(result_url) 표시·다운로드
  │       → 클라가 finalize 턴 append(§5)
  └─ [이 디자인으로 주문 제작] (finalize 성공 후) → /custom-order 이동
       └─ custom-order pickerSlot 피커에서도 역방향 선택 가능(BE3 목록)
```

- **비용·잔액 상시 표시**: 컴포저 우측에 잔액(BE5 `generate_cost`와 함께 "생성 1회 N토큰") + [충전]. 원본의 사전 잔액 표시 UX 계승.
- **첨부·옵션 칩**: 원본의 색/패턴/원단 칩은 **프롬프트 합성 힌트**로 단순화 — 칩 선택이 프롬프트 앞에 문구를 덧붙이는 컴포저 로컬 기능(백엔드 입력은 `prompt` 하나). 이미지 첨부는 v2.
- **pending 복구**: 생성 시작 시 `localStorage["design:pending"] = {sessionId, at}`, 응답 수신/실패 시 제거. 재진입 시 남아 있으면 PageBanner "진행 중이던 생성이 있어요 — 세션 열기"(BE2로 서버 완주가 보장되므로 턴 조회로 결과 복구). 24h 지난 항목은 무시·제거.

## 5. 턴 payload 스키마 확정 (`design_session_turns.payload` — DB 골격 주석의 "5단계 구체화" 이행)

| role | type | payload | 기록 주체 |
|---|---|---|---|
| user | `generate_request` | `{type, mode: "prompt"\|"variation", prompt: str\|null, seed: int\|null, colorway: str\|null, candidate_count: int}` | **api** (generate 안에서 — BE1) |
| assistant | `generate` | `{type, response: DesignGenerateOut}` — 현행 api 저장 형태 유지 + BE1로 `intents` 포함 | api (현행) |
| user | `select` | `{type, candidate_id: str, design_index: int, seed: int, colorway_id: str}` | 클라 (`appendDesignTurn`) |
| user | `finalize` | `{type, job_id: uuid, production_method: str, weave: str}` | 클라 (`appendDesignTurn`) |

- **SVG는 assistant 턴 payload에 포함**(현행 api 동작 유지): 엔진 SVG는 pattern+use 구조로 통상 수 KB~수십 KB(2MB는 상한)이고 후보 수를 UI에서 4로 캡하므로 행 비대는 수용 범위. 세션 이어하기·재-export가 턴 조회만으로 성립하는 단순성이 우선. 성장 경로(로그 슬림화·GCS 오프로드)는 문제 관측 후.
- 프론트는 payload를 **zod로 방어적 파싱**(`model/turn-payload.ts`) — 미지 type·구버전 스키마는 "표시할 수 없는 턴"으로 강등(세션 전체를 죽이지 않음).
- 이어하기 복원: 턴 피드 재구성 + 마지막 `select`(없으면 세션 `current_intent`·`seed`·`colorway`)로 선택 상태 복원 + BE3 목록으로 finalize 결과 카드 복원.

## 6. finalize 잡 폴링 UX

- **훅** `model/use-finalize-job.ts`: `useMutation(createFinalizeJob)` → 반환 잡 id를 `useQuery(["design","job",id], getGenerationJob, { refetchInterval: (q) => q.state.data && ["queued","processing"].includes(q.state.data.status) ? 2500 : false })`. 터미널(succeeded/failed) 도달 시 자동 중단 — 별도 타이머·수동 clearInterval 없음.
- **진행 표시**: finalize 모달을 닫아도 진행되도록 **턴 피드에 진행 카드**로 표시(ProgressCircle + "원단 시뮬레이션 생성 중 — 보통 수십 초, 창을 닫아도 계속됩니다"). Cloud Tasks 재시도 중이면 `attempts > 1`로 "재시도 중" 문구.
- **성공**: 카드가 결과로 교체 — `result_url`(공개 버킷, BE3) ImageFrame + [다운로드] + [이 디자인으로 주문 제작]. 잔여 예산(`finalize_used/10`) 갱신은 세션 refetch.
- **실패**: `error_message` 기반 안내 + [다시 시도](잡 재생성 — 예산 재소모 안내 문구, D8). 5분(폴링 120회) 초과 시 폴링을 멈추고 "지연되고 있어요 — 나중에 세션에서 확인하세요"(BE3 목록으로 복원 가능하므로 유실 없음).
- 예산 소진(409 `finalize 예산을 모두 사용했습니다`): finalize 진입 버튼에 잔여 0 시 disabled + helperText, 방어적으로 409 응답도 동일 문구 처리.

## 7. 원본 대비 의도적 차이 (보존 예외 — 명세 보존 의무 없음, 참고 대조)

| YeongSeon | essesion | 근거 |
|---|---|---|
| Supabase edge `generate-tile`(OpenAI/Google 이미지 API) 단발 호출, PNG 타일 최대 4종 | api→worker 동기 generate, **SVG 벡터 후보** 1~4 | seamless 워커가 유일한 생성 경로(ARCHITECTURE §2). 확대 무손실·반복 프리뷰 무료·결정론 재현 |
| `tile_edit` — 이전 타일 URL·workId를 재전송해 편집 맥락 유지 | **결정론 정제** — 선택 후보의 intent를 세션에 확정, 배리에이션=같은 intent+새 seed | 같은 입력→같은 출력 계약이 있어 URL 재전송이 불필요. 편집 의미가 서버 LLM 재량이 아니라 재현 가능한 상태로 |
| regenerate = 마지막 프롬프트 재전송(전액 재과금) | 배리에이션(intent+새 seed, 재과금·비용 표기) + 새 프롬프트 입력 구분 | 두 의도(같은 방향 다른 결과 / 방향 수정)를 분리, 비용 사전 고지 |
| 이미지 첨부(ImageKit 업로드, 참고/로고) | **v1 제거** | 워커 이미지 입력 경로 미구현(worker-refactor "범위 밖"). v2에서 GCS 서명 업로드로 재설계 |
| 색/패턴/원단/수량/배치 첨부 칩 → edge payload 필드 | 색/패턴/원단 칩 = **프롬프트 합성 힌트**(컴포저 로컬), 수량 = `candidate_count`(1~4), 배치 개념 제거 | 워커 입력이 `prompt` 단일. one_point/accent 타일 개념은 seamless 엔진에 없음 |
| 세션: `design_chat_sessions/messages` + 페이지 미연결 히스토리 코드 | `design_sessions/turns` + **세션 목록·이어하기 정식 포함** | 세션 API·소유자 인가가 이미 구현됨. 원본의 미완 기능을 완성형으로 |
| 생성 피드(`design_generations` 별도 테이블, 날짜 그룹) | 턴 피드로 통합(세션 단위) | 테이블 이원화 제거 — 턴이 단일 이력 원장 |
| pending 배너: localStorage 흔적 + "결과 확인"이 배너 닫기뿐(복구 없음) | pending + **실복구**(BE2 서버 완주 + 턴 조회) | 원본은 이탈 시 결과 유실. 새 구조는 서버가 기록 소유 |
| 넥타이 마스크 프리뷰 + 돋보기/핀치줌/전체화면 | 유지(타일 반복 ↔ 넥타이 마스크 토글). 전체화면 API는 미이관 — 모바일 프리뷰 모달 확대로 갈음 | 상품 맥락 차별점. Fullscreen API는 iOS Safari 제약·유지비 대비 효용 낮음 |
| 캔버스 합성 PNG 다운로드(클라 렌더) | `POST /design/export` (png/tiff·dpi 선택, 무과금) | 워커 R4로 배선 완결. 인쇄 품질(물리 DPI 스탬프)은 서버 래스터가 정답 |
| (없음 — 원단 질감 시뮬레이션 부재) | **신규: finalize 플로우**(§4·§6) | 워커 핵심 신기능. UI 없으면 죽은 표면 |
| 주문 CTA: `/custom-order` 단순 라우팅(데이터 미전달) | finalize 결과 → custom-order 첨부 연결 + pickerSlot 피커(BE3) | C5 D12 이행 — 원본 DesignImagePicker의 역할 재현 |
| 온보딩 2页(선염/날염) localStorage | 동일 유지 | 마찰 최소 패턴, finalize 방식 선택과 어휘 연결 |
| 토큰 부족 = 에러 응답 후 채팅 메시지로 고지 | 잔액+생성 비용 **사전 표시**(BE5) + 부족 시 Callout·충전 CTA | 실패 후 고지 → 사전 고지 |
| PostHog analytics 이벤트 | 미이관 | store 전체 분석 인프라 부재(전 페이지 공통) |
| PageSeo 컴포넌트 | React 19 네이티브 `<title>`/`<meta>` JSX(홈 패턴), `robots: noindex` 보존 | 공용 SEO 추상화 없음 |

## 8. 데이터 계약

| 엔드포인트 | api-client | 용도 |
|---|---|---|
| POST /design/sessions | `createDesignSession` | 첫 전송 시 지연 생성 |
| GET /design/sessions | `listDesignSessions` | 세션 목록 모달 |
| GET /design/sessions/{id} · PATCH | `getDesignSession` / `updateDesignSession` | 이어하기 로드 / 후보 선택 확정(BE1) |
| GET /design/sessions/{id}/turns | `listDesignTurns` | 턴 피드 재구성 |
| POST /design/sessions/{id}/turns | `appendDesignTurn` | select·finalize 턴(§5) |
| POST /design/generate | `generateDesign` | 생성·배리에이션 (BE1로 `intents` 포함) |
| POST /design/export | `exportDesign` | 무과금 다운로드 — **바이너리 응답**: api-client(fetch)에서 blob 수신 확인, 필요 시 `parseAs: "blob"` 지정(구현 확인 포인트) |
| POST /design/sessions/{id}/finalize | `createFinalizeJob` | 잡 생성(예산 10) |
| GET /design/jobs/{id} | `getGenerationJob` | 폴링(§6) + `result_url`(BE3) |
| GET /design/jobs (신설) | BE3 | 완성물 목록 — picker·세션 복원 |
| GET /tokens/balance | `getTokenBalance` | 잔액 + `generate_cost`(BE5) |

- 모티프 프록시 2종(`motifCandidates`/`motifGenerate`)은 v1 미사용(게이트 UI 이연) — 계약만 유지.
- 서버 에러 코드 → UI 매핑: `insufficient_tokens`·`refund_pending`(과금), 422 `WorkerRequestError` detail(프롬프트 수정 유도), 502/503(재시도), 409(finalize intent 없음·예산 소진). 전부 §4의 분기.

## 9. Composite 경계 + AppLayout 변경안

```text
apps/store/src/
├─ app/layout/app-layout.tsx           # ★ 변경: isImmersive = pathname === "/design"
│    · 푸터 숨김(기존 isFocusedRoute 분기 확장)
│    · main Box에 minHeight:0 + overflow hidden — 페이지가 남은 높이를 자체 소유
│    · 헤더는 유지(데스크톱·모바일 공통)
├─ features/design/
│  ├─ model/turn-payload.ts            # §5 zod 스키마 + 방어 파싱 — 단위테스트 대상
│  ├─ model/queries.ts                 # 세션·턴·잔액·잡 useQuery 정의(queryKey 일원화)
│  ├─ model/use-generate.ts            # 세션 지연 생성 → generate → pending 마커 → invalidate
│  ├─ model/use-finalize-job.ts        # 잡 생성 + 폴링(§6)
│  ├─ model/use-selection.ts           # 후보 선택 → PATCH + select 턴 — 파생 selected 상태
│  ├─ model/pending.ts                 # localStorage pending(§4)
│  ├─ model/onboarding.ts              # localStorage 완료 플래그
│  ├─ model/svg-preview.ts             # svg → data URI·반복 배경 스타일 — 단위테스트 대상
│  ├─ ui/composer.tsx                  # TextAreaField+힌트 Chip+수량 Chip+잔액/비용+전송
│  ├─ ui/turn-feed.tsx                 # 턴 렌더 디스패치(스크롤 소유)
│  ├─ ui/candidate-grid.tsx            # 후보 타일(선택·warnings Callout)
│  ├─ ui/preview-panel.tsx             # 반복/넥타이 토글 + 돋보기 (데스크톱)
│  ├─ ui/preview-modal.tsx             # 모바일 확대(핀치줌·팬)
│  ├─ ui/tie-canvas.tsx                # 반복 배경 + 넥타이 실루엣 마스크
│  ├─ ui/finalize-dialog.tsx           # 방식·weave 선택(ResponsiveModal)
│  ├─ ui/finalize-turn-card.tsx        # 진행/성공/실패 카드(§6)
│  ├─ ui/export-dialog.tsx             # 형식·dpi·폭 → blob 다운로드
│  ├─ ui/session-list-modal.tsx        # 세션 목록·이어하기
│  ├─ ui/onboarding-dialog.tsx         # 선염/날염 2页
│  └─ ui/design-picker.tsx             # ★ custom-order pickerSlot 주입용 export (BE3 목록)
└─ pages/design/index.tsx              # 2-패널 조립 + immersive 높이 소유 + 네이티브 SEO 메타
```

- 페이지 루트가 `height:100%`(AppLayout이 준 고정 높이) 안에서 좌우 분할, **스크롤은 턴 피드 내부에만**(세로 스크롤 — 규칙 10의 상황별 허용). 가로 스크롤 없음.
- custom-order 쪽 변경은 **pickerSlot에 `<DesignPicker/>` 주입 1줄** + 선택 결과를 첨부 object_key 목록에 합류시키는 어댑터만 — C5 구조 무수정.

### UI 하네스 매핑

| 슬롯/요소 | 구성 |
|---|---|
| 컴포저 | `TextAreaField`(autoResize)+`Chip`(힌트·수량)+`ActionButton brandSolid`(전송, 화면당 1개 CTA)+잔액 `Text caption`+[충전] `ActionButton ghost` |
| 후보 그리드 | `Grid columns={{base:2, md:2}}` + `AspectRatio` 타일(`<img>` data URI) + 선택 링은 `-selected` 토큰, 로딩 `Skeleton` 4타일 |
| 프리뷰 토글 | `SegmentedControl`(반복/넥타이) |
| finalize·export·세션 목록 | `ResponsiveModal`(모바일 BottomSheet ↔ PC Modal) — 방식·weave는 `SelectBox`(설명 카드형), dpi는 `Chip` |
| 진행/결과 | 진행 `ProgressCircle`(형태 없는 대기), 결과 `ImageFrame`, 실패·빈 세션 `ContentPlaceholder` |
| 경고·안내 | warnings·토큰 부족 `Callout`, pending 복구 `PageBanner`(페이지당 1개), 완료·복사 등 휘발 알림 `snackbar()` |
| 파괴·차단 확인 | 없음(삭제 기능 v1 없음) — AlertDialog 불사용 |

## 10. 결정 사항

| ID | 결정 | 상태 |
|---|---|---|
| D1 | UI 패러다임 = **하이브리드**(턴 피드 + 프리뷰/작업 패널) | **사용자 확정** |
| D2 | custom-order 피커 연결 포함(BE3 동반) | **사용자 확정** |
| D3 | BE1·BE2·BE3·BE5를 선행 조건으로 명시, 구현은 별도 세션 | **사용자 확정** |
| D4 | 후보 SVG 인라인 렌더(이미지 컨텍스트 한정)·프리뷰 PNG 미사용, candidate_count UI 캡 4 | 확정 권장 |
| D5 | 턴 payload §5 스키마 + SVG 포함(성장 경로는 관측 후) | 확정 권장 |
| D6 | 배리에이션 = intent+새 seed(재과금·비용 표기), colorway 다양성은 후보 세트 내에서 소비 — 별도 recolor UI 없음(v2 `/palettes`) | 권장 |
| D7 | finalize v1 노출 노브 = 방식+weave만(dpi 300 고정, material_map·strength 기본값) | 권장 |
| D8 | finalize 실패 시 예산 미환급 유지(재시도=재소모 문구로 고지). 환급(BE4)은 실사용 데이터 후 재검토 | 권장 |
| D9 | 세션 삭제·이름 변경 v1 제외(DELETE 엔드포인트 부재 — 필요 시 별도 BE) | 권장 |
| D10 | 온보딩·pending = localStorage(원본 방식 보존) | 권장 |
| D11 | `/design` 공개 라우트 + 액션 requireAuth, SEO는 네이티브 JSX(`noindex` 보존) | 확정 권장 |

## 11. 작업 순서

1. **BE1+BE5 (api·worker 커밋 1)**: 워커 `intents` 응답 + api 전파·user 턴 기록 + 잔액 `generate_cost` → 테스트(§2 수용 기준) → `pnpm codegen` 동커밋.
2. **BE3 (api 커밋 2)**: `GET /design/jobs` + `result_url` → 인가 테스트 → codegen. (BE2는 독립 — 병행 가능.)
3. **feature model**: `turn-payload.ts`(+단위테스트) → `svg-preview.ts`(+단위테스트) → queries → use-generate/use-selection/use-finalize-job → pending/onboarding.
4. **UI**: composer → candidate-grid/turn-feed → preview(panel·modal·tie-canvas) → finalize(dialog·turn-card) → export → session-list → onboarding.
5. **페이지·셸**: `pages/design` 조립 + AppLayout immersive 분기 + 라우터 등록.
6. **picker**: `design-picker.tsx` + custom-order pickerSlot 주입.
7. **검증**: `pnpm lint` → `pnpm turbo typecheck test` → **aside-browser 왕복**(로컬 api+worker, 시크릿 없으면 Gemini 미구성 503이므로 intent 직접 전달 경로/시드 계정으로): ① 온보딩→전송→후보 4개 ② 후보 선택→프리뷰 토글·확대 ③ 배리에이션(비용 표기·잔액 갱신) ④ export 다운로드 ⑤ finalize 폴링→결과→다운로드 ⑥ 세션 이어하기(턴·선택·finalize 복원) ⑦ 토큰 부족·422·502 분기 ⑧ pending 배너 복구 ⑨ custom-order 피커 ⑩ 모바일 레이아웃(프리뷰 모달·하단 컴포저). 
8. `docs/CHECKLIST.md` C12 항목 갱신.

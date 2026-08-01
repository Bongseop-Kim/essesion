# 재설계 4단계 — store 풀블리드 캔버스 셸

실행일: 2026-07-31

상태: 구현·검증 완료. 1단계부터 의도적으로 깨져 있던 **store 빌드·타입체크가 복구됐다**.

범위: `docs/plans/design-redesign/04-store-canvas-shell.md` 전체. 좌우 2패널·채팅 피드·후보
그리드를 없애고, 넥타이가 화면을 채우는 캔버스 + 떠 있는 컨트롤 4그룹으로 바꿨다.

## 미결 결정 (플랜 M2) — 모티프 카드 접힘

**권고안 그대로 확정했다.** 접으면 제목 줄(`모티프 n/2` + 셰브론)만 남고 슬롯 2개가 24px 미니
칩으로 축소된다. 미니 칩은 표시 전용이라 교체는 펼친 뒤에 한다. 접힘 상태는
`design:motif-panel:collapsed` 키로 localStorage에 남긴다(`onboarding.ts`와 같은 패턴,
`model/motif-panel-state.ts`). 브라우저에서 접기 → 새로고침 → 접힘 유지를 확인했다.

## 신규

### `features/design/ui/`

| 파일 | 내용 |
|---|---|
| `design-canvas.tsx` | 풀블리드 캔버스 + TieCanvas + 빈 상태. 떠 있는 컨트롤을 7개 슬롯(`topStart`/`topEnd`/`notice`/`left`/`right`/`bottom`)으로 받는다 |
| `motif-panel.tsx` | 좌측 모티프 카드 — 슬롯 2개, 접기, `current_motifs` 소비 |
| `tool-rail.tsx` | 우측 레일 2열(액션 2 + 도구 5). 라벨·아이콘을 스스로 소유하고 페이지는 핸들러·플래그만 넘긴다 |
| `history-track.tsx` | 하단 이력 트랙(64px/모바일 44px, 현재·실패·대기 칸, 현재 칸 auto-scroll) |
| `prompt-bar.tsx` | 입력창 pill(문장·아이디어·전송, 잠금·전체선택) |
| `canvas-notice.tsx` | 상단 알림 레이어(2톤) + `designNotices()` 조립 함수 |
| `view-toggle.tsx` | 넥타이/타일 세그먼트 |
| `token-pill.tsx` | 잔액 pill(Menu로 상세·충전) + 비로그인 placeholder |
| `design-overlays.tsx` | **플랜에 없던 9번째 조각.** 오버레이 9종 + 목록 조회 + 삭제 확인 choreography를 한 레이어로 모았다 — 이게 없으면 `index.tsx`가 400줄에 들어가지 않는다 |
| `photo-reference-modal.tsx` | **플랜에 없던 10번째 조각.** `참고 사진` 레일 항목의 대상. shared `AttachmentDisplayField`로 첨부·제거를 보여준다 |

### `features/design/model/`

| 파일 | 내용 |
|---|---|
| `steps.ts` | 턴 목록 → 선형 편집 이력(`cells`·`currentRunId`·`currentSvg`). 마지막 `activate` 턴이 편집 포인터 |
| `use-steps.ts` | `useActivateDesignStep`(되돌리기) · `useActivateMotifSlot`(슬롯 교체) — 둘 다 무과금 |
| `use-prompt-generation.ts` | 문장 → 생성/구성 수정 흐름 전체(초안·경쟁 가드·거절·오류) |
| `use-design-output.ts` | `useDesignExport`(내려받기) · `useFinalizeFlow`(실사화 시작 + 종결 폴링·알림) |
| `use-photo-references.ts` | 참고 사진 첨부·업로드 1회 재사용 |
| `motif-panel-state.ts` | M2 접힘 상태 저장 |

## 삭제

플랜의 삭제 목록 전부 + 아래 2건.

| 파일 | 이유 |
|---|---|
| `model/warnings.ts`(+test) | **플랜의 유지 목록에 있었지만 지웠다.** 이 파일은 엔진 영문 진단(`partial: N candidate(s)`, `outside CMYK gamut`)을 정규식으로 골라 한글로 바꾸는 기계였다. 2단계에서 워커가 `warnings: [{code, message}]`로 한글 문구를 직접 내려주기로 바뀌었으므로 존재 이유가 없다. 후보 관련 문구는 애초에 1단계에서 폐기됐다 |
| `model/use-finalize-job.ts`의 `finalizeRetryInput`·`useCancelFinalizeJob`·`finalizeJobDelayed` | `finalize-turn-card`(피드용)만 쓰던 것. `finalizeRetryInput`은 1단계에서 사라진 `params.candidate_id`를 검사해 항상 null을 돌려주는 죽은 코드였다 |

## 계약을 새로 물린 곳

- `use-generate.ts` — `mode`(prompt/variation)·`candidateCount`·`patternConstraints`·`rerollDesign`
  제거. 응답이 `DesignGenerateOut | DesignGenerateRejectedOut` 유니온이 됐으므로 결과를
  `{sessionId, rejected, design, warnings}`로 평탄화한다. GA 이벤트 `generate_design`의 파라미터도
  `mode` → `rejected`로 바꿨다(`shared/lib/analytics.ts`).
- `turn-payload.ts` — 후보 스키마 전면 폐기. 캔버스가 실제로 읽는 `generate`(성공)·
  `generate_error`·`activate` 3종만 파싱한다. `generate_request`·`motif_activate`·`finalize`는
  화면이 쓰지 않아 파싱 대상이 아니다.
- `draft.ts` — `DEFAULT_CANDIDATE_COUNT`, 4축 `DesignPatternConstraints`와 라벨,
  `REFERENCE_IMAGE_PURPOSES`·`referenceImagePurposeLabel` 삭제. 사진 목적은 새 화면에 진입점이
  없어 `auto`(서버 자동 판단) 고정이다 — 모티프 정체성은 모티프 패널이, 색은 색 지정이 맡는다.
- `errors.ts` — `candidate_invalid` → `design_invalid`(1단계 워커 실패 코드 개명).
  `generation_in_progress`·`design_result_unavailable`·`design_not_started` 추가(되돌리기·슬롯
  교체 경로의 409). `constraint_conflict`·`intent_invalid`·`motif_input_conflict` 문구를 새 화면
  용어(색 지정·이력 스텝·모티프)로 다시 썼다.
- `export-dialog.tsx`·`finalize-dialog.tsx` — 형식·DPI·폭·제작 방식·짜임을 **다이얼로그 로컬
  state로 내렸다.** 요청 payload가 아니라 그 폼의 값이라 페이지가 들고 있을 이유가 없었다.
- `motif-library-modal.tsx` — 다중 선택(`selectedIds`/`max`/`onToggle`) → 슬롯 단건 선택
  (`onSelect`/`activeIds`). 폐기된 `+ 메뉴` 안내 문구도 고쳤다.
- `session-list-modal.tsx`·`ideas-modal.tsx` — "세션"·"패턴 설정"·"참고 방식" 문구를 새 용어로.

## shared 변경 1건

`TieCanvas`에 `surface?: "panel" | "none"` 추가(기본 `panel`). 기존 컴포넌트는 라운드 면
(`bg.neutral-weak` + `r4`)을 항상 그려서 풀블리드 캔버스에 얹으면 **넥타이 뒤에 카드가 보인다** —
플랜의 완료 판정 1("카드 테두리 없음")을 위반한다. 프리미티브 style prop은 inline style로
렌더돼 className이 이길 수 없으므로(하네스 규칙 8) 임의 값 우회 대신 컴포넌트에 축을 하나
넣었다(하네스 규칙 0의 ③). admin `plan-preview`·기존 미리보기는 기본값이라 변화 없다.

## 브라우저 확인에서 잡은 버그 1건

**턴 이력의 `response.warnings`는 `[{code, message}]`가 아니라 엔진 영문 진단 문자열
배열이다.** api는 `/design/generate` 응답에만 워커가 만든 고객 문구를 담고, 턴 payload에는
`seamless_generation_logs.warnings`(정본 = 영문)를 그대로 붙인다. 처음에 이력 스키마에
`z.array({code, message})`를 요구해서 **성공 스텝이 전부 파싱 실패로 버려졌다** — 캔버스가
디자인을 만든 뒤에도 "아직 만든 디자인이 없어요"를 그렸다. 수정:

- 이력 스키마에서 `warnings`를 읽지 않는다(썸네일에 필요 없다).
- 자동 조정 알림은 **생성·교체 응답의 warnings**에서 온다(`usePromptGeneration.warnings`,
  `activateMotif.data.warnings`). 그래서 알림은 "방금 적용한 편집"에 붙고 다음 문장을 쓰면
  사라진다 — 새로고침 후에는 남지 않는다. 목업 01은 편집 중 상태에도 알림이 있지만, 영문 진단을
  프론트에서 다시 한글로 매핑하면 방금 지운 `warnings.ts`를 되살리는 셈이라 택하지 않았다.

## 플랜과 다르게 한 것 (근거)

1. **신규 컴포넌트가 8개가 아니라 10개다.** `design-overlays.tsx`(오버레이 9종 + 삭제 확인
   choreography)와 `photo-reference-modal.tsx`(`참고 사진` 레일 항목의 대상)를 더했다. 전자는
   400줄 판정을 위해, 후자는 레일에 있는 도구에 목적지가 없으면 안 되기 때문이다.
2. **`참고 사진`은 커밋된 디자인이 있으면 비활성이다.** 2단계에서 서버가 커밋된 세션에
   사진·모티프가 오면 과금 전에 `motif_input_conflict`(422)로 막는다. 목업 01은 활성으로
   그렸지만 그건 눌러도 거절되는 버튼이다 — 첫 생성(목업 06)에서만 켠다.
3. **뷰 세그먼트는 아이콘이 아니라 `넥타이`/`타일` 두 글자 세그먼트다.** shared
   `SegmentedControl`을 쓰는 게 하네스 규칙 0의 ①이고, 아이콘 단독 세그먼트는 라벨이 필요하다.
   구조(2세그먼트 즉시 전환)는 목업과 같다.
4. **알림에 버튼을 두지 않았다.** 총괄의 "버튼 없음"을 거절뿐 아니라 오류에도 적용했다. 실패해도
   문장이 입력창에 남으므로 전송이 곧 재시도이고, 토큰 부족은 우상단 잔액 pill에 충전 경로가 있다.
5. **입력창 전송은 문장이 있을 때만 활성이다.** 색 지정만 바꾸고 보낼 수는 없다 — 워커
   `GenerateRequest`가 구성 수정 경로에 프롬프트를 요구한다(`conversation refinement requires a
   prompt`). 대신 고정 팔레트를 적용하면 `색 지정` 레일 아이콘이 채워져(brand solid) 대기 중임을
   알린다(목업 CSS의 `.ring.solid`).
6. **실사화 종결 알림을 남겼다.** 피드가 사라져 진행 표시가 없어졌지만, 잡 실패를 영원히 모르는
   건 기능 회귀다. `useFinalizeFlow`가 시작한 잡을 폴링해 성공·실패를 스낵바로 알린다(새 UI 없음).
7. **모바일 390 실제 리사이즈는 못 했다.** Aside 창 크기를 REPL·AppleScript로 바꿀 수 없다.
   대신 페이지 테스트가 `matchMedia`를 항상 false로 스텁해 **base 브레이크포인트(=모바일)에서
   전부 렌더**되고, 레일이 1열(`flexDirection: column`)·라벨 `display:none`·접기 토글과 슬롯
   메타가 접근성 트리에서 빠지는 것을 단정으로 고정했다.

## 남긴 것 (근거)

- **`ui/photo-motif-modal.tsx`·`ui/text-motif-modal.tsx`는 참조가 끊긴 채 남아 있다.** 5단계가
  이 둘을 통합 모티프 모달의 `사진에서 따오기`·`글자로 만들기` 경로로 흡수한다. 지금 지우면
  5단계가 그 기능을 처음부터 다시 써야 한다. **4단계에서 모티프를 새로 만드는 경로는 SVG
  업로드 하나뿐이다**(모티프 모달 하단 `SVG 올리기` → import → 슬롯 교체).
- `motif-library-modal.tsx`도 5단계 삭제 대상이지만, 슬롯 교체에 목적지가 필요해 계약만 좁혀
  살렸다.
- admin의 `candidate_count_requested` 등 관측 컬럼 표시 — 1단계 리뷰대로 6단계 몫.

## 검증

```
pnpm lint                       # biome + check-harness OK
pnpm turbo typecheck            # 4개 패키지 통과 (store 복구)
pnpm turbo test                 # store 50파일 195 / admin 52파일 229 / shared 14파일 / api-proxy 1
pnpm turbo build                # VITE_API_BASE_URL·VITE_TOSS_CLIENT_KEY 지정 시 store·admin 성공
```

Python·api 스펙은 건드리지 않았다(`git diff apps/api apps/worker db` 0건) → `pnpm codegen` 불필요.

### 새 테스트

- `model/steps.test.ts`(5) — 성공만 번호를 받고 실패는 칸만, 포인터 = 마지막 `activate`,
  되돌린 뒤 이후 스텝 유지, seq 뒤섞임 복원과 못 읽는 턴 폐기, **영문 진단 warnings가 스텝
  파싱을 막지 않음**(위 버그의 회귀 가드), 턴 0건 = 첫 진입.
- `pages/design/index.test.tsx`(5) — 이력 썸네일 클릭 → `steps/activate` 호출(되돌리기 버튼
  없음·현재 칸 비활성), 범위 밖 거절 시 문장 유지 + 전체 선택 + 빨강 알림 + 이력 무변화,
  적용 중 입력 잠금 + 대기 칸 + 액션 비활성, 첫 진입 안내·비활성, 모바일 1열 레일.
- `model/use-generate.test.tsx` — 단일 요청 payload, `rejected` 결과가 오류가 아님, pending
  marker 경쟁, stale 승인 거부.

### 브라우저 (Aside, 1440×900, localhost:3000/design)

실제 세션으로 확인했고 **콘솔 오류 0건**이다.

1. 첫 진입 — 빈 상태 안내, 슬롯 2칸 비어 있음, 내려받기·실사화 비활성, 참고 사진 활성.
2. 문장 생성 → 스텝 1 + 넥타이 렌더, 잔액 900 → 895, placeholder가 편집 문구로 바뀜,
   참고 사진 비활성 전환.
3. 두 번째 문장(구성 수정) → 스텝 2, 잔액 895 → 890, **노랑 알림 "무늬가 겹치지 않게 크기를
   조금 줄였어요."** (서버 문구 그대로).
4. 되돌리기 — 스텝 1 썸네일 클릭 → 포인터 이동, **스텝 2는 이력에 그대로 남는다**(총괄 결정).
5. **알림이 떠도 넥타이 top/height·이력 top·입력창 top이 1px도 변하지 않는다**(측정 대조).
6. 타일 뷰 전환, 모티프 모달·색 지정·아이디어·만드는 방법·내 디자인·완성본 전부 열림.
7. 내려받기 실제 실행 → "디자인 파일을 만들었습니다." 스낵바.
8. 실사화 → 잡 생성 후 `succeeded`, 완성본 목록에 이미지 1건.
9. 모티프 카드 접기 → 미니 칩 2개 + 새로고침 후 접힘 유지.

### 실행 환경에서 발견한 것

**:8001 워커가 하루 전 코드로 돌고 있었다**(`--reload` 없이 7/30 21:59 시작). 1–3단계가 오늘
바뀐 계약을 모르니 `candidates`를 돌려주고 api가 `이미지 워커 응답 형식이 올바르지 않습니다`로
실패했다. 워커를 재시작해야 이 화면이 동작한다. 잔액은 정상 환불됐고(900 불변) 실패 칸도
이력에 남아, 이 사고 덕분에 **실패 상태 UI가 실제로 검증됐다**.

## 완료 판정

1. **화면이 목업 01·02·05·06과 구조적으로 일치한다** — 패널 4그룹, 카드 테두리 없음(TieCanvas
   `surface="none"`). ✔
2. **알림이 떠도 넥타이·이력·입력창의 위치가 변하지 않는다** — 측정으로 확인. ✔
3. **`pages/design/index.tsx` 385줄** (1597 → 385). ✔
4. **삭제 목록의 파일이 존재하지 않고 참조도 없다** — `turn-feed`·`candidate-grid`·`composer`·
   `preview-panel`·`preview-modal`·`pattern-settings-modal`·`finalize-turn-card`·`finalize-turns`·
   `selection`·`use-selection`·`generation-controls.test` 전부 삭제, store 잔존 참조 0건. ✔

## 데이터

스키마 변경 없음. 단, **1–3단계 이전에 만든 세션·턴은 이 화면에서 읽히지 않는다**(후보 payload).
1단계 리뷰의 안내대로 두 테이블을 비우면 된다:

```bash
docker compose exec -T db psql -U essesion -d essesion -c "delete from design_sessions"
```

로컬에는 7/29에 만든 구스키마 세션 2건이 남아 있다 — `내 디자인`에서 고르면 이력이 비어 보인다.

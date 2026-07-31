# 재설계 5단계 — 모티프 모달 통합

실행일: 2026-07-31

범위: `docs/plans/design-redesign/05-store-motif-modal.md` 전체. 흩어진 모티프 모달 4개를 하나로
합쳐, 기본 경로를 목록이 아니라 **문장 → RAG 검색**으로 바꿨다. 유료 생성은 맨 아래 한 줄에서
확인 모달을 거쳐야만 호출된다.

## 결과

| 완료 판정 | 상태 |
|---|---|
| 1. 모티프 모달이 파일 기준 1(+생성 확인 1)개 | ✅ `motif-modal.tsx` + `motif-generate-modal.tsx` |
| 2. 모티프 목록을 통째로 노출하는 화면 없음 | ✅ `내 모티프`는 칩을 눌러야 조회(쿼리 자체가 그때 enable) |
| 3. 무료 경로에서 토큰 잔액 불변 | ✅ 컴포넌트 테스트 + 로컬 api 실측(890 → 890) |
| 4. 생성은 확인 모달 없이 호출되지 않음 | ✅ 테스트가 `generateMotif` 미호출 → 확인 모달 열림 → 호출 순서를 고정 |

## 신규

- `features/design/model/use-motif-search.ts` — 슬롯·검색어·결과·선택과 검색·확정·생성 호출.
  **페이지가 소유**한다(모달이 아니라) — 그래서 생성 확인 모달로 갔다 돌아와도 검색어·결과·선택이
  유지된다(플랜의 "취소하면 검색어·결과 유지").
- `features/design/ui/motif-modal.tsx` — 목업 03 전체.
- `features/design/ui/motif-generate-modal.tsx` — 목업 04. 프롬프트를 다시 쓸 수 있는 입력창.

## 삭제

| 파일 | 대체 |
|---|---|
| `ui/motif-library-modal.tsx` | 모달의 `내 모티프` 칩 |
| `ui/photo-motif-modal.tsx` | `사진에서 따오기` 칩 (4단계에서 이미 참조 0건이었다) |
| `ui/text-motif-modal.tsx` | `글자로 만들기` 칩 (같음) |
| `pages/design/index.tsx`의 숨은 SVG file input·`replaceMotif`·`importMotifFile` | 모달이 file input 2개(SVG·사진)를 직접 들고, 확정 경로는 훅 하나로 합쳤다 |

## 플랜과 다르게 한 것 (근거)

1. **유료 행에 `5토큰` 배지를 넣지 않았다.** 플랜 표와 목업은 "5토큰"이라고 적었지만
   `POST .../motifs/generate`는 **토큰을 차감하지 않는다** — 세션 Recraft 예산(3회)만 쓴다
   (3단계 리뷰: "모델 호출 0, 토큰 0", `charge_cost=0`). 과금 확정은 6단계 미결 M1이고
   6단계 플랜 §5도 "모티프 생성은 기존 5토큰 유지"를 **제안**일 뿐이다. 안 나가는 토큰을
   표기하면 완료 판정 3의 취지(무료·유료 경계를 문구로 정확히 알린다)를 정면으로 어긴다.
   그래서 지금은 **남은 횟수만** 말한다: `문장 그대로 새로 만들어요 · N번 더 가능`.
   확인 모달 버튼도 `이 문장으로 만들기`. **6단계에서 과금을 확정하면 이 두 문구에 가격을
   붙일 것** — 붙일 자리는 유료 행의 버튼 왼쪽과 확인 버튼 라벨이다.
2. **api에 필드 하나를 추가했다: `DesignSessionOut.recraft_remaining`.** 목업의 "2번 더 가능"과
   플랜의 "예산 소진 시 버튼 비활성"은 남은 횟수를 알아야 그릴 수 있는데, 상한은
   `settings.design_recraft_budget`(서버 전용)이라 프론트가 `recraft_used`만으로 계산할 수 없다.
   상수를 store에 복제하면 설정을 바꿀 때 조용히 어긋난다. 단건 GET·스텝 이동 응답에서만 채우고
   목록은 `None`으로 둔다(`finalize_quota`와 같은 규칙). `pnpm codegen` 생성물 동봉.
3. **입력창은 하나다.** `글자로 만들기`는 위 검색 입력창의 문장을 그대로 글리프로 만든다.
   생성 확인 모달도 같은 문장을 프리필한다(플랜 지시) — 문장이 이 모달의 유일한 입력이라는
   성질이 세 경로에 일관되게 적용된다.
4. **사진·글자 경로의 옵션 컨트롤을 뺐다.** 삭제한 두 모달은 배경 제거·단순화 강도·색상 수·
   글꼴·굵기·자간을 노출했다. 칩 하나로 대체하라는 플랜 지시에 컨트롤 6종이 들어갈 자리가 없고,
   플랜 규칙도 "무료 경로라 재시도 비용이 없다"고 못박았다. 서버 기본값
   (배경 제거·단순화 medium·4색 / 나눔고딕 400·자간 0)으로 부르고, 결과가 마음에 안 들면 다시
   고르면 된다. **되살려야 할 신호는 "결과가 나빠서 옵션을 찾는다"는 사용자 피드백이다.**
5. **모든 무료 경로를 카드 한 형태로 합쳤다.** `MotifCard{motifId | svg}` — 카탈로그 카드는 바로
   교체, SVG·사진·글자 결과는 확정할 때 import 한다. 그래서 확정 버튼(`이 그림으로 바꾸기`)이
   경로마다 갈라지지 않고 하나다.
6. **`내 모티프` 카드의 삭제 버튼을 남겼다.** 목업에는 없지만, 지우면 저장한 모티프를 삭제하는
   유일한 UI가 사라지고 `deleteUserMotif`가 죽은 엔드포인트가 된다. 확인 다이얼로그는 기존
   `design-overlays` choreography(닫고 → 250ms → AlertDialog)를 그대로 쓴다.
7. **`shared`의 `TextFieldProps`에서 native `prefix`를 Omit 했다.** `FieldOwnProps.prefix`(ReactNode)가
   `ComponentPropsWithRef<"input">.prefix`(RDFa 문자열)와 교차해 `string & ReactElement`가 되어
   **앱에서 한 번도 쓸 수 없는 슬롯**이었다. `Chip`이 이미 같은 처리를 하고 있어 그 패턴을 따랐다
   (`TextAreaField`도 같이). 컴포넌트 룩·런타임은 불변.

## 오버레이 계약

- 모달 위 모달 금지: 모티프 모달 ↔ 생성 확인 모달은 `switchOverlay`(닫고 → 퇴장 모션 후 열기)로
  교대한다. 상태가 훅에 있어 교대해도 화면이 비지 않는다.
- 테스트가 `dialog[open]` 목록으로 "한 번에 하나"를 단정한다 — `<dialog>` 자식은 닫혀도 DOM에
  남으므로 자식 조회로는 열림을 판단할 수 없다(테스트 헬퍼 `waitForDialog`).

## 검증

```
uv run pytest         # 1197 passed
uv run ruff check .   # clean · ruff format --check clean
uv run pyright        # 0 errors
pnpm lint             # clean (check-harness OK)
pnpm turbo typecheck test   # store 196 passed / admin 통과
pnpm turbo build      # 통과 (VITE_API_BASE_URL·VITE_TOSS_CLIENT_KEY 필요 — 선재 조건)
pnpm codegen          # 드리프트 0, 생성물 동봉(recraft_remaining)
```

새 컴포넌트 테스트(`pages/design/index.test.tsx`, 페이지 조립을 그대로 구동):

- 엔터로 `motifs/search` 호출(문장 그대로), 결과 카드 선택 → `motifs/activate`,
  `generateMotif` 미호출 + 토큰 pill 표시 불변
- `지금 쓰는 그림` 카드는 고를 수 있어도 확정 버튼이 잠긴다
- 결과 0건 → `찾은 그림이 없어요`
- `새로 만들기` → 확인 모달만 열림(생성 호출 없음) → 프롬프트 수정 후 생성 → activate
- `recraft_remaining: 0` → `이번 디자인에서 더 만들 수 없어요` + 버튼 비활성

api 테스트: 단건 GET의 `recraft_remaining`이 3 → 0으로 줄고 목록은 `None`
(`test_motif_generate_budget_exhaustion`, `test_session_reports_current_motifs_including_catalog`).

## 로컬 실측 (api 직접 호출)

Aside 브라우저 확인은 **하지 못했다** — Aside 앱은 떠 있으나 CLI·MCP가
`Chrome extension not connected for the requested browser profile`을 반환한다(확장 연결은 앱에서
사용자가 해야 한다). 대신 UI가 의존하는 계약을 실제 로컬 스택(api:8000 + worker:8001 + DB)에
`customer@local`로 직접 호출해 확인했다:

| 확인 | 결과 |
|---|---|
| `motifs/search "꽃 한 송이"` | 카드 4개, 전부 `preview_svg` 있음, 이름은 카탈로그 subject |
| 현재 모티프가 결과에 있으면 | `current: true` (`"작은 벌"` → bee 1건) |
| 슬롯 1 교체 | 200, 스텝(generate 턴) 2 → 3, **잔액 890 → 890**, `recraft_remaining` 3 → 3 |
| 빈 슬롯 2 추가 | 200, `current_motifs` 2개, 스텝 3 → 4, 잔액 불변 |
| `motifs/text-preview` | 200, svg 3987B (글자 경로 기본값 그대로) |

남은 브라우저 확인 항목(확장 연결 후): 모바일 390 BottomSheet 전환·결과 그리드 3열, 실제 카드
렌더, 생성 경로(Recraft 키 없으면 오류 표시까지).

## 후속 관찰 (이번 범위 아님)

- 로컬 시드 카탈로그의 `Motif.subject`가 영어("flower", "leaf")라 카드 이름이 영어로 뜬다.
  목업은 한국어 이름을 가정한다 — 시드 데이터·이름 정책 문제이므로 별도로 판단할 것.

# 디자인 플로우 E2E 후속 조치 — 실행 지시서

`docs/reviews/design-flow-e2e-2026-08-04.md`의 발견 7건을 처리한다. 실제 회귀는 3건이고
나머지는 관측성·시드·플랜 드리프트다. 새 추상화를 만들 일은 없다 — 대부분 한 줄짜리다.

## 처리 방침

| # | 발견 | 처리 | 위치 |
|---|---|---|---|
| 1 | 온보딩 `닫기`가 완료를 저장하지 않음 | 고침 | `apps/store/src/features/design/ui/design-overlays.tsx:196` |
| 2 | 현재 세션 삭제 후 다른 세션 자동 선택 | 고침 | `apps/store/src/pages/design/index.tsx:375` |
| 3 | 열린 store 탭이 admin 변경을 반영 안 함 | 고침(잔액·설정 한정) | `apps/store/src/features/design/model/queries.ts:110` |
| 4 | Recraft 생성이 admin에서 세션 상관 분석 불가 | 이미 있는 컬럼을 노출 | `apps/api/src/api/domains/admin/generation.py:282` |
| 5 | 시드 고객 토큰 원장 0건 | 시드에 초기 지급 추가 | `apps/api/scripts/seed.py:453` |
| 6 | lattice가 페이즐리 모티프를 잃음 | 별도 조치 없음 — `few-shot-reverse-eval.md`에 편입 | — |
| 7 | A5 산출물 키 확인 불가 | 문서만 정정 | 이 문서 하단 |

---

## 1. 온보딩 닫기 = 봤음

`OnboardingDialog`는 `onComplete`(마지막 버튼)에서만 `completeDesignOnboarding()`을 부른다.
X·바깥 클릭으로 닫으면 저장이 없어 재진입마다 다시 뜬다. 닫힘 자체를 "봤다"로 기록한다.

```tsx
<OnboardingDialog
  open={overlay === "onboarding"}
  onOpenChange={(open) => {
    if (!open) completeDesignOnboarding(); // 닫기·완료 모두 봤음으로 기록
    onOverlayChange(open ? "onboarding" : null);
  }}
  onComplete={onOnboardingComplete}
/>
```

`onComplete`에서 `completeDesignOnboarding()`은 제거한다 — `finish()`가 곧바로
`onOpenChange(false)`를 부르므로 닫힘 경로 하나로 합쳐진다. 다시 보고 싶은 사용자는
캔버스 좌상단 `만드는 방법` 버튼이 이미 담당한다.

검사: `apps/store/src/pages/design/index.test.tsx`에 케이스 1건 — 온보딩을 X로 닫으면
`localStorage[DESIGN_ONBOARDING_KEY] === "1"`.

## 2. 현재 세션 삭제 후 빈 캔버스

`onSessionDeleted`가 `openSession(null, false)`를 부른다. `false`는 `freshSession=false`라
`index.tsx:167`의 자동 선택 effect가 곧바로 `sessionsQuery.data[0]`을 집는다. 새 디자인
버튼(`:339`)과 같은 `true`로 바꾸면 자동 선택이 막힌다.

```tsx
onSessionDeleted={(id) => {
  if (sessionId === id) openSession(null, true);
}}
```

검사: 삭제 mutation 성공 후 `sessionQuery`가 호출되지 않는지 — 기존 design 페이지
테스트 하네스에 1건 추가.

## 3. 잔액·비용만 포커스 갱신

store `queryClient`는 `refetchOnWindowFocus: false` + `staleTime: 5분`(`shared/lib/query-client.ts`).
전역으로 켜지 말 것 — 고칠 값은 하나다. **admin이 `design_edit_cost`를 바꾸면 고객 화면에
틀린 차감 비용이 최대 5분 표시된다.** 토큰 잔액 쿼리가 그 값(`edit_cost`·`generate_cost`)을
같이 실어 오므로 이 쿼리만 신선하게 둔다.

```ts
export function designTokenBalanceQueryOptions(authenticated: boolean) {
  return {
    ...getTokenBalanceOptions(),
    enabled: authenticated,
    // 금액 표시 — admin이 단가를 바꾸면 탭 복귀 즉시 따라간다.
    staleTime: 0,
    refetchOnWindowFocus: true,
  };
}
```

디자인 예시 갤러리(A6)는 손대지 않는다 — 게시 순서가 몇 분 늦게 반영되는 건 금액이 아니고,
운영자가 확인할 때는 reload 한 번이면 된다. 고객 불만이 실제로 생기면 그때 같은 두 줄을 붙인다.

## 4. Recraft 생성의 세션 상관

`seamless_generation_logs`에 `motif_generation` 행을 새로 만들지 않는다 — `input_type` CHECK가
`prompt|intent`라 마이그레이션·워커 기록·admin 라벨·codegen까지 4단 변경이 되고, 얻는 정보는
이미 DB에 있다. `motifs.ingested_user_id` / `ingested_session_id`는 첫 Recraft 유입 시점에
기록되지만 **api·admin 어디에도 노출되지 않는다**(레포 전체 grep 0건). 그것만 꺼낸다.

1. `MotifDetailOut`(`admin/generation.py:282`)에 `ingested_user_id: UUID | None`,
   `ingested_session_id: UUID | None` 추가, `_motif_detail`(`:1128`)에서 매핑.
2. admin 모티프 상세(`apps/admin/src/pages/motifs/detail.tsx`)의 메타데이터 목록에
   `요청자` · `세션` 두 행 추가. 세션 값은 디자인 세션 상세로 링크한다.
3. `pnpm codegen` 후 생성물을 같은 커밋에.

검사: 기존 admin 모티프 상세 테스트에 두 필드 렌더 단언 1건.

## 5. 시드 고객 초기 토큰

`grant_initial_tokens`(`auth/service.py:159`)는 가입 경로에만 걸려 있고, 시드 계정은
`_ensure_user`로 직접 만들어져 원장이 빈다. 그래서 `design_token_initial_grant=30` 설정과
실제 잔액(0)이 어긋나고 E2E 플랜의 시작 잔액 전제가 재현되지 않는다.

`seed.py`에 멱등 단계 하나를 추가한다 — 설정 시드와 `_ensure_user` **이후**, `customer@local`의
`design_tokens` 행이 0건일 때만 `grant_initial_tokens`를 호출한다. 이미 결제·차감 이력이 있는
로컬 DB에는 아무 일도 일어나지 않는다.

검사: 빈 DB에 `seed.py` 2회 실행 → `select sum(amount) from design_tokens` = 30 (2회차에도 30).

## 6. lattice 페이즐리 소실

여기서 다루지 않는다. `docs/plans/few-shot-reverse-eval.md`가 이미 `lattice` 4건을 P1/P2로
등급 매기고 이탈 단계(리트리벌·저작·해석·컴파일)를 지목하도록 되어 있다. 같은 증상을 두 곳에서
쫓지 말고, 그 검토의 lattice 케이스에 **S3b 실사용 프롬프트 1건을 P2 입력으로 추가**한다.
그 결과가 나오기 전에 프롬프트·엔진을 손대지 않는다.

## 7. 다음 E2E 확인 기준 정정

- **A5**: finalize 작업 상세는 보안상 GCS 객체 키를 의도적으로 숨긴다. 확인 항목을
  "산출물 키 원문"이 아니라 **결과 객체 존재 + 공개 링크 열림**으로 쓴다.
- **S14**: 세션 개수 기대치를 고정 숫자로 쓰지 말 것. S3b가 새 세션 2건을 만들므로
  "직전 단계까지 생성한 세션 수"를 그 자리에서 세어 기준으로 삼는다.
- **S1**: 시작 잔액 기대치는 5번 조치 후 30으로 고정된다. Toss 테스트 결제 보정은 더 필요 없다.

---

## 실행 순서

1~3(store 프론트) → 5(시드) → 4(api+admin+codegen) 순. 1·2·3은 서로 독립이라 한 커밋에 묶어도
된다. 4는 codegen 드리프트 검사 때문에 생성물을 같이 커밋해야 한다.

## 검증

```bash
pnpm lint
pnpm turbo build typecheck test
uv run pytest
uv run ruff check . && uv run pyright
```

브라우저 확인은 Aside로 S1·S14·A2 3케이스만 — 나머지는 위 단위 검사로 충분하다.

## 기록

`docs/reviews/design-flow-e2e-followup-2026-08.md`에 조치 7건의 결과(고침/보류/문서)와
재확인한 S1·S14·A2 판정을 남기고 이 플랜을 제거한다.

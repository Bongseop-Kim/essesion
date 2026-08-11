# e2e-03 비로그인 주문제작 초안 이관 수정 플랜

> `docs/reviews/e2e-03-custom-sample-2026-08.md`의 유일한 FAIL — 비로그인 `/custom-order`에서
> 작성한 초안이 로그인 뒤 복원되지 않고, 로그인 후 홈으로 이동한다. admin 5건과 나머지
> store 9건은 전부 PASS라 이 플랜은 이 한 건만 다룬다. sample-order에는 같은 초안 패턴이
> 없어 범위는 custom-order 한정이다.

## 원인 — 이관이 특정 로그인 경로에만 배선돼 있다

초안 이관 메커니즘은 이미 있다: 가드 다이얼로그의 `requireAuth({path, state.customOrderDraft})`
→ `saveAuthReturn`(sessionStorage) → 로그인 성공 시 `takeAuthReturn()`으로 원래 경로+state 복귀
→ `loginDraft` effect가 사용자 키로 저장(`pages/custom-order/index.tsx:202`). 문제는 이 경로가
**가드 다이얼로그를 통과한 로그인에만** 동작한다는 것.

- 헤더 로그인 버튼(`app/layout/app-layout.tsx:115`)은 `state.from` 없이 `/login`으로 이동 →
  로그인 후 fallback `/`(홈)으로 간다. 다이얼로그로 차단만 확인하고 헤더로 로그인하면
  e2e가 본 그대로 홈 이동 + 이관 없음이 된다.
- 익명 초안은 `custom-order:draft:v3:anonymous` 키에 남지만, 로그인 뒤 재진입하면 사용자 키를
  먼저 읽고(`index.tsx:126`) 400ms 자동저장(`index.tsx:219`)이 **기본값 초안을 사용자 키에
  써버린다** — "익명 키에는 값이 남고 사용자 키에는 빈 초안" 관측과 일치.

## 1. 이관을 storage 기반으로 단일화 (로그인 경로 무관)

- `/custom-order` mount 시 authenticated이고 익명 키에 초안이 있으면 사용자 키로 이관하고
  익명 키를 지운다 — 게스트 장바구니 동기화(`syncGuestCartToAccount`)와 같은 패턴.
  어떤 경로로 로그인했든(다이얼로그·헤더·직접 `/login`) 동작한다.
- 전제 정리: **깨끗한 초안은 저장하지 않는다.** 지금은 페이지를 열기만 해도 400ms 뒤 기본값이
  저장돼, "익명 초안 존재 = 실제 입력"이 성립하지 않는다. `DEFAULT_CUSTOM_ORDER_OPTIONS`·
  `DEFAULT_QUOTE_CONTACT`와 같으면 저장을 건너뛰고 기존 키를 지운다. 이관 규칙은 단순해진다 —
  익명 초안이 있으면 그것이 가장 최근 작업이므로 사용자 초안보다 우선한다.
- `location.state` 라운드트립(`loginDraft`·`readLoginDraft`·`withoutLoginDraft`,
  `requireAuth`의 `state.customOrderDraft`)은 storage 이관이 대체하므로 제거한다 —
  같은 일을 두 경로로 하지 않는다.

## 2. 헤더 로그인도 원래 화면으로 복귀

- 헤더 로그인 버튼이 `state.from`에 현재 경로(`location.pathname + search`)를 실어 보내게
  한다. 로그인 페이지의 기존 fallback 처리(`pages/auth/login.tsx:66`)가 그대로 소화한다.
- 가드 다이얼로그 경로의 복귀는 코드상 정상으로 보이지만 e2e 관측과 어긋날 여지가 있으니
  Aside로 다이얼로그 → 로그인 → `/custom-order` 복귀를 실제 재현해 확인한다.

## 3. 첨부 재안내

파일은 보안상 storage에 저장할 수 없어 이관되지 않는다(기대 동작). 현재 재첨부 스낵바는
주문 제출 차단 시점에만 뜨고 로그인 뒤에는 아무 안내가 없다.

- 초안 저장 시 차단 시점에 첨부(파일·디자인)가 있었으면 `hadAttachments` 플래그를 함께
  저장하고, 이관 복원 시 플래그가 있으면 `참고 이미지를 다시 첨부해 주세요` 스낵바를 한 번
  띄운 뒤 플래그를 지운다.

## 검증

- 유닛(`features/custom-order/model/draft.test.ts`): 기본값 초안 저장 생략, 익명→사용자 이관,
  이관 후 익명 키 삭제, `hadAttachments` 왕복.
- Aside 재현 (Q3 재판정):
  1. 비로그인 `/custom-order`에서 폭·메모 입력 → 파일 선택 → 다이얼로그 → 로그인 →
     `/custom-order` 복귀 + 폭·메모 복원 + 재첨부 스낵바.
  2. 같은 입력 후 다이얼로그 취소 → **헤더 로그인** → `/custom-order` 복귀(from) + 초안 복원.
  3. 로그인 상태에서 초안 입력 → 새로고침 복원(Q2 회귀 확인).
- `pnpm turbo build typecheck test` 통과.

## 상태 — 계획

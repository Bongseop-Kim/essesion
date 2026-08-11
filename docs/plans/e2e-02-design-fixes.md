# e2e-02 디자인·토큰 결과 후속 수정 플랜

> `docs/reviews/e2e-02-design-2026-08.md`의 FAIL 2건과 WARN 3건을 다룬다.
> FAIL 2건은 둘 다 react-query 캐시가 window focus에서 갱신되지 않는 같은 계열 문제고,
> WARN 3(취소가 거부로 표시)은 API가 실제로 `거부` 상태를 기록하는 데이터 문제라 마이그레이션이 필요하다.

## 1. 토큰 단가 window-focus refetch 회귀 (FAIL 2)

**원인**: 8/4 후속의 focus refetch는 `designTokenBalanceQueryOptions`
(`apps/store/src/features/design/model/queries.ts:110`, `staleTime: 0` + `refetchOnWindowFocus: true`)
래퍼에만 있고, 이 래퍼는 `/design` 페이지만 쓴다. e2e가 확인한 토큰 상세 경로인
`pages/my-page/token-history.tsx:79`와 `pages/token-purchase/index.tsx:36`은 raw
`getTokenBalanceOptions()`를 직접 스프레드해 전역 기본값(staleTime 5분, focus refetch 없음)을 탄다.
store 전역 기본은 `shared/lib/query-client.ts`에서 `refetchOnWindowFocus: false`다.

- 래퍼를 feature 내부(`features/design/model/queries.ts`)에서 공용 위치로 옮기고
  (단가·잔액은 디자인 전용 데이터가 아니다), 세 소비처 모두 래퍼를 쓰도록 교체한다.
- 래퍼 JSDoc에 "잔액·단가 표시는 raw `getTokenBalanceOptions()` 직접 사용 금지 — admin 단가 변경을
  focus에서 따라가야 한다"를 명시해 재발을 막는다.

## 2. 디자인 예시 갤러리가 열린 store에 반영되지 않음 (FAIL 1)

**원인**: `/design` 갤러리는 `pages/design/index.tsx:104`에서 raw `listDesignExamplesOptions()`를
사용 — 전역 기본값이라 admin에서 순서·게시를 바꿔도 staleTime 5분 동안, focus가 와도 갱신되지 않는다.

- 1번과 같은 패턴으로 `staleTime: 0` + `refetchOnWindowFocus: true` 래퍼를 만들어 적용한다.
  목록이 6건 수준이라 focus마다 재조회해도 비용은 무시할 수 있다.
- 같은 탭 안에서의 실시간 push까지는 하지 않는다 — e2e 재현 경로(admin 탭 → store 탭 복귀)는
  focus refetch로 충분하다.

## 3. 사용자 취소 토큰 환불이 `거부`로 표시 (WARN 3)

**원인**: 표시 매핑이 아니라 데이터가 거부다. `apps/api/src/api/domains/tokens/ledger.py:599`의
`cancel_refund_request`가 고객 취소를 `claim.status = "거부"`(+ 로그 memo "고객 환불 요청 취소")로
기록한다. 일반 클레임의 고객 취소는 행 삭제(`claims/service.py:149`)지만, token_refund는
결제 감사 추적 때문에 행을 남겨야 해서 상태로 구분해야 한다. 클레임 status의 DB CheckConstraint
(`db/src/db/models/commerce.py:347`)에는 `취소`가 없다.

- Alembic 마이그레이션으로 status CheckConstraint에 `'취소'`를 추가한다 (DDL 직접 실행 금지 원칙).
- `cancel_refund_request`가 `취소`를 기록하도록 변경. 기존 `거부` 데이터의 소급 변환은 하지 않는다 —
  로그 memo로 구분 가능하고 로컬·초기 데이터뿐이다.
- 상태 전이는 추가하지 않는다 — 취소 후 흐름은 재신청(새 클레임)이 이미 커버한다(T4 확인).
  admin이 `취소` 상태를 만지는 액션도 없다(`admin_actions`에서 자연히 빈 목록).
- 표시 계열 갱신: store `features/claims/model/config.ts`(필터·라벨),
  admin `shared/ui/status-badge.tsx`·`pages/claims/list.tsx`(필터)에 `취소` 추가.
- status가 스키마상 자유 문자열이면 api-client 재생성은 불필요 — enum으로 노출된다면
  `pnpm codegen` 후 생성물을 같은 커밋에 포함한다(CI 드리프트 검사).
- 테스트: 취소 후 status가 `취소`인지, 취소 건이 거부 필터가 아닌 취소 필터에 잡히는지.

## 4. 범위 밖 거절 스낵바 미관측 (WARN 2) — 재현 검증 먼저

코드상 스낵바는 존재한다 — `pages/design/index.tsx:151`의 `onMotifIntent`에서 패널 확장과 같은
콜백으로 `snackbar(...)`를 호출한다. e2e에서 패널 확장은 관측됐으므로 호출 자체는 실행됐을
가능성이 높고, 남는 가설은 (a) 스낵바 duration이 짧아 Aside 캡처 타이밍을 놓침,
(b) 실제 렌더 실패(다른 오버레이·언마운트 경쟁).

- Aside로 범위 밖 프롬프트를 재현하며 스낵바 DOM을 액션 직후 즉시 감시한다.
- (a)면 코드 수정 없음 — e2e 결과 문서에 관측 한계로 기록하고 재실행 지시서에
  "스낵바는 응답 도착 직후 감시" 절차를 남긴다.
- (b)면 원인 지점을 수정한다. 범위를 넘는 UX 개편(지속 알림 전환 등)은 하지 않는다 —
  패널 확장 + 입력 전체선택이 이미 주 안내 수단이다.

## 범위 제외

- **WARN 1 (scatter/lattice 모티프 의미 보존)** — LLM 저작 품질 문제로 8/4에 평가 플랜으로
  이관되어 추적 중. 이 플랜에서는 다루지 않는다.

## 검증

- `pnpm turbo build typecheck test` + `uv run pytest` 통과.
- admin에서 예시 순서 변경·게시 해제 → store 탭 복귀만으로 갤러리 건수·순서 갱신 (DA4 재확인).
- admin `design_edit_cost 2→3` → store 토큰 상세 탭 복귀 시 `고치기 1회 3토큰` (DA6 재확인, 확인 후 2로 복구).
- 토큰 환불 신청 취소 → store/admin 목록에서 `취소` 표시, 재신청 정상 (T4 재확인).
- 범위 밖 프롬프트 재현으로 스낵바 표시 여부 판정 (D10).

## 상태 — 계획

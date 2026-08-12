# e2e-02·03·04·모티프 의미 보존 일괄 수정 결과 — 2026-08-11

4개 플랜(e2e-02 디자인·토큰, e2e-03 초안 이관, e2e-04 수선, 모티프 의미 보존)을 병렬로
수정하고 검증을 한 번에 실행했다. 원본 플랜: 삭제된 `docs/plans/e2e-0{2,3,4}-*.md`,
`design-motif-semantic-preservation.md` (git 이력 참조).

## e2e-02 디자인·토큰

- **FAIL 1·2 (focus refetch)**: 래퍼를 `apps/store/src/shared/lib/live-queries.ts`로
  승격(`tokenBalanceQueryOptions`·`designExamplesQueryOptions`, staleTime 0 +
  refetchOnWindowFocus). 소비처 4곳(/design·token-history·token-purchase·갤러리) 교체,
  raw options 직접 사용 금지 JSDoc 명시.
- **WARN 3 (취소가 거부로 표시)**: 클레임 status에 `취소` 추가 — Alembic
  `e71baf2532ce`(CheckConstraint), `cancel_refund_request`가 `취소` 기록,
  `request_refund` 중복 검사는 거부·취소 모두 제외. 표시 계열(store tone·shared
  claim-badge·admin 필터·ClaimStatusFilter enum) 갱신, status가 OpenAPI enum이라
  `pnpm codegen` 생성물 포함.
- **WARN 2 (거절 스낵바 미관측)**: 코드 수정 없음으로 판정. Aside에서 사이드카
  스낵바("모티프는 왼쪽에서 찾거나 만들 수 있어요")가 응답 도착 +2.5초에 표시됨을
  확인 — e2e 캡처 타이밍 문제였다. **재실행 시 스낵바는 응답 도착 직후 0.5초 간격으로
  감시할 것.**

## e2e-03 비로그인 주문제작 초안 이관

- 이관을 storage 기반으로 단일화(`restoreCustomOrderFormDraft`): 로그인 경로와 무관하게
  mount 시 익명 키 → 계정 키 이관. 기본값 초안은 저장 생략(첨부 플래그 있으면 예외).
  location.state 라운드트립(loginDraft 계열) 제거.
- 헤더 로그인(데스크톱·모바일 아이콘·모바일 메뉴 3곳)이 `state.from`으로 원래 화면 복귀.
- `hadAttachments` 플래그로 로그인 뒤 재첨부 스낵바 1회. 파일 선택이 차단된 경우도
  선택 의도를 플래그에 반영(검증 중 보강).
- **검증 중 발견한 근본 원인 추가 수정**: `LoginPage`의 authenticated 리다이렉트가
  lazy 라우트 청크 로드 중 `isPending=false`로 재렌더되며 목적지 내비게이션을 홈으로
  덮어쓰는 레이스 — e2e가 관측한 "로그인 후 홈 이동"의 실제 원인. `!login.isSuccess`
  조건 추가로 수정 (`pages/auth/login.tsx`).

## e2e-04 수선

- **FAIL 1 (success 새로고침 409)**: `/payments/confirm` 멱등 판정을 상태 일치에서
  `paid_at` 존재로 교체(사전체크·lock 이후 2곳). `payment_key_mismatch`·
  `payment_reconciliation_required`는 유지, `not_payable`은 미결제만.
- **FAIL 2 (업로드가 메모 덮어씀)**: `RepairShipmentFields` onChange를 patch 계약으로
  변경, 부모(order-form·repair-shipping)가 functional setState로 병합. 수정 전 코드로
  테스트가 실제 실패하는 것까지 확인.
- 알려진 표시 한계: 전액취소 주문의 옛 success URL이 이제 409 대신 200이라
  `submitted` 화면("발송 정보까지 등록되었습니다")이 보일 수 있다 — 기존 표시 로직,
  범위 밖으로 남김.

## 모티프 의미 보존 (D3b)

- **플랜 전제와 데이터가 달랐다**: 로그 154건에서 정상 매치(0.4422)가 공백 대체(0.4652)
  보다 similarity가 낮아 임계로 둘을 가를 수 없음(문장 전체 임베딩이 원인).
  기존 `match_type`을 쓰어 exact token은 제외하고 embedding 매치에만 노랑 안내.
  "작은 원형 모티프" 같은 정상
  embedding 매치에도 안내가 붙는 오탐 존재(안내는 거절이 아니라 비용 낮음).
- 어휘 확장: 페이즐리/다마스크/아가일/헤링본(한·영) — `_MATERIAL_WORDS`로 분리,
  매치 시 그 단어가 피커 검색어. 색변경 가드·줄무늬 제외 유지.
- 검증: 경고 API 스모크와 소재 어휘 파라미터 테스트로 커버.
- 카탈로그 소재 보강(플랜 4번, 실 Recraft 유료)은 **미실행 — 사용자 승인 대기**.

## 검증

- `pnpm lint`, `pnpm turbo build typecheck test` 11/11,
  `uv run pytest` 1,238개(신규 포함) 통과, ruff·pyright 0건.
  전체 실행에서 store 테스트 2건·contract 1건이 1회 플레이크였으나 재실행·격리 실행
  모두 통과(동시 실행 부하 기인, 코드 무관).
- Alembic `e71baf2532ce` 로컬 적용.
- Aside 재판정 (전부 mock Toss, Recraft 0회, 생성 3회·토큰 10개):
  - Q3·Q2: 다이얼로그 경로/헤더 경로 모두 로그인 후 `/custom-order` 복귀 + 폭·메모
    복원 + 재첨부 스낵바, 로그인 새로고침 복원 정상.
  - DA6: 열린 store 탭이 focus만으로 단가 3→2 갱신(원값 2로 복구 완료).
  - DA4: 열린 store 탭이 focus만으로 갤러리 순서·게시 반영(원상 복구 완료).
  - T4: 신청→취소 후 store `토큰 환불 취소`(neutral)·admin 취소 필터 1건·재신청 가능.
  - R10: 결제→발송 자동 등록(발송중 전진) 후 새로고침 3회 모두 같은 성공 화면, 409 없음.
    admin 전진 케이스는 pytest로 고정.
  - RA4: 사진 업로드 중 입력한 메모가 완료 후 유지, DB receipt memo 저장,
    admin 배송·수선 탭에 메모·송장 표시.
  - D10(WARN 2): 사이드카 스낵바 +2.5초 관측.
- 브라우저 콘솔 오류 0건.

## 남은 것

- ~~D3b 브라우저 재판정 보류~~ → **8/12 worker 재시작 후 완료**: 동백꽃 scatter는
  디자인 생성 + 노랑 경고(+9초 관측, 로그 warnings에
  `similarity 0.4065 < 0.55` 기록), 페이즐리는 응답 사이드카
  `{subject: 페이즐리}` → 스낵바("'페이즐리' 모티프는 왼쪽에서…") + 피커 검색어
  '페이즐리' 채움까지 확인. 중간의 미관측 2회는 검출 스크립트 버그 + 온보딩
  오버레이 가림이었고 기능 문제 아님.
- ~~카탈로그 소재 보강~~ → **8/12 완료** —
  `docs/reviews/motif-catalog-recraft-boost-2026-08-12.md`.

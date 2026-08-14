# 로컬 Aside 전체 화면·흐름 점검 — 2026-08-14

## 판정

`FAIL` — fail-fast를 해제하고 가능한 lane을 끝까지 실행했다. 결제·주문·클레임·후기·토큰·견적·샘플·수선 대표 경로는 통과했지만, 배포 차단 결함 3건과 접근성 결함 1건이 남았다.

- 실행 ID: `PREDEPLOY-20260814-0859`
- 실행 시간: 2026-08-14 08:59–09:35 KST
- 대상: `feat/cal` / `0df35ce5e0e3218e8a95fe5a6ce61dda07038f09`
- 시작 작업 트리: 2026-08-13 점검 산출물만 변경된 상태, 제품 코드는 후보 SHA와 동일
- URL: store `http://localhost:3000`, admin `http://localhost:3001`, api `http://localhost:8000`, worker `http://localhost:8001`
- 실제 content viewport: store 2280×1241, admin 1440×900
- provider: Toss `dry_run`, Solapi `dry_run`, worker `local`, finalize `inline`
- 외부 호출: OpenAI authoring 0, GPT Image 0, 실 Toss 0, DryRun Toss 승인 5·취소 1, 실 Solapi 0, UI에서 확인한 DryRun Solapi claim 알림 1
- lint·build·typecheck·동일 SHA CI: 사용자 요청에 따라 범위 밖

## Lane 결과

| Phase/lane | 결과 | 실제 확인 |
|---|---|---|
| A 환경·Aside | PASS | 6개 포트와 health/ready 정상, Alembic head와 무료 시드 3종은 전날 동일 SHA에서 확인, store/admin 단일 탭과 listener 사용 |
| B1 seed 상품 편집 | FAIL | `3F-SEED-002`의 빈 `option_label` 때문에 admin 저장 불가. 전날 동일 SHA 재현 결과 유지 |
| B2 focus 갱신 | FAIL | 예시 게시, 설정 단가, 클레임/견적/토큰 상태가 열린 반대편 탭에서 focus만으로 갱신되지 않고 reload 후 반영됨. 임시 설정은 원복 |
| B3 비로그인 초안 이관 | PASS | 폭 8.5와 `PREDEPLOY-20260814-0859 비로그인 초안`이 로그인 후 복원됨 |
| B4 결제 성공 재진입 | PASS | success URL 3회 reload에도 `ORD-20260814-001` 한 건만 생성 |
| B5 업로드 중 입력 보존 | PASS | 업로드 직후 입력한 `PREDEPLOY-20260814-0859 업로드 중 메모`가 store/admin에서 동일 |
| B6 디자인 UI 회귀 | BLOCKED | 유료 authoring 승인 없음, D2 결함으로 활성 session 생성도 불가 |
| B7 온보딩 닫힘 | BLOCKED | 현재 2개 고객 모두 기존 계정이며 API/관리자 UI에 지원된 초기화·신규 계정 생성 경로가 없음 |
| C 인증·상품·주문·클레임 | PASS | 고객/관리자 동시 세션, admin logout 후 보호 화면 로그인 gate, 상품 결제·교환 거부·구매확정·5점 후기와 admin 교차 확인 |
| D1 비로그인 디자인 | PASS | 게시 예시 노출과 로그인 gate 확인 |
| D2 seed 예시 무료 적용 | FAIL | 여러 게시 예시를 눌러도 canvas가 비어 있고 `Failed to fetch`가 반복됨 |
| D3–D4 authoring | BLOCKED | 최대 2회 유료 호출 승인이 없어 호출하지 않음 |
| D5–D8, D10 | BLOCKED | D2 실패로 활성 design session이 없어 motif·export·finalize·삭제를 판정할 수 없음 |
| D9 토큰 구매·환불 | PASS | 933→1,033→933, `TKN-20260814-001`/`TKR-20260814001524-7057`, admin 승인과 +100/−100 원장 일치 |
| E1 주문제작·샘플·견적 | PASS(디자인 첨부 제외) | `ORD-20260814-003`, `ORD-20260814-004`, `QUO-20260814-001`; 사양·메모·2.2KB 첨부·금액 교차 확인, 30,000원 샘플 쿠폰 발급 확인 |
| E2 수선 | PASS | `ORD-20260814-002`를 발송중→접수→수선중→수선완료→배송중→배송완료→완료로 전진, 업체 송장 `987654321098`과 CJ URL 일치 |
| F1 데스크톱·접근성 | FAIL | 대표 화면은 정상이나 쿠폰 선택 modal이 Escape로 닫히지 않고 dialog role도 노출되지 않음 |
| F2 390×844 모바일 | BLOCKED | Aside가 연결된 기존 탭은 viewport 변경 API를 제공하지 않음. cached size 변경은 실제 2280×1241에 영향을 주지 않아 PASS로 가장하지 않음 |
| F3 관측 | PASS(제한 있음) | store/admin console error 0, pageerror 0, listener가 포착한 예상 밖 4xx/5xx 0. D2는 response 없이 fetch 실패하여 status 미확정 |

## 교차 대조 키

- 상품 주문: `ORD-20260814-001`, ₩27,000, 교환 `CLM-20260814-001` 거부, 후기 `PREDEPLOY-20260814-0859 전체 점검 후기`
- 수선: `ORD-20260814-002`, ₩20,500, 고객 송장 `123456789012`, 업체 송장 `987654321098`
- 주문제작: `ORD-20260814-003`, ₩80,400, 폭 8.5cm, 참고 이미지 1개
- 샘플: `ORD-20260814-004`, ₩60,000, `SAMPLE_DISCOUNT_FABRIC_PRINTING` ₩30,000 쿠폰 발급
- 토큰: `TKN-20260814-001`, ₩2,500, 환불 `TKR-20260814001524-7057`
- 견적: `QUO-20260814-001`, 요청→견적발송→협의중→확정, ₩810,000

## Findings

### E2E-B1 — seed 옵션 상품 저장 불가

- 심각도/배포 차단: High / 예
- 기대: 옵션 묶음 이름이 채워지고 재고를 저장할 수 있음
- 실제: `3F-SEED-002`에서 `옵션 묶음 이름을 입력해 주세요.` validation으로 저장 요청 전 차단
- 영향: fresh seed 환경의 옵션 상품을 admin에서 운영할 수 없음
- 증거: [B1 실패 화면](assets/pre-deploy-aside-e2e-2026-08-13-b1.png)

### E2E-B2 — 열린 탭이 focus 복귀 시 서버 상태를 갱신하지 않음

- 심각도/배포 차단: High / 예
- 재현: admin에서 예시 게시 또는 설정 값을 바꾸거나 claim/quote/token 상태를 전이한 뒤 열린 store/admin 탭으로 focus 복귀
- 기대: reload 없이 최신 상태와 비용 표시
- 실제: 이전 상태가 유지되고 수동 reload 후에만 최신 상태가 보임
- 영향: 사용자가 오래된 가격·클레임·견적·잔액을 보고 다음 작업을 진행할 수 있음

### E2E-D2 — 게시 디자인 예시 적용 실패

- 심각도/배포 차단: High / 예
- 재현: 로그인 후 `/design`에서 `와이드 사선 스트라이프` 또는 `정규 격자` 선택
- 기대: 무료 session 생성, canvas/이력 갱신, 토큰 변화 없음
- 실제: 빈 canvas 유지, `Failed to fetch`; `POST /design/sessions/from-example` 시도 뒤 response status는 관측되지 않음
- 영향: 예시 기반 디자인 진입이 막히고 D5·D7·D8·D10도 검증/사용 불가
- 증거: [D2 실패 화면](assets/pre-deploy-aside-e2e-2026-08-14-d2.png) (PNG, 124,564 bytes, SHA-256 `3b163f8345ca6cbf94826ad313dfe44526b819cd154fbd28793704d17c55e3b4`)

### E2E-F1 — 쿠폰 선택 modal의 키보드 닫기·dialog semantics 누락

- 심각도/배포 차단: Medium / 아니오
- 재현: 주문제작 checkout에서 `쿠폰 선택`을 열고 Escape 입력
- 기대: modal이 닫히고 trigger로 focus 복귀, dialog semantics 노출
- 실제: modal이 열린 채 `닫기`에 focus가 남고 snapshot에 dialog/alertdialog role이 없음
- 영향: 키보드·보조기기 사용자가 modal을 빠져나가기 어렵고 구조를 인식하기 어려움

## 통과한 핵심 흐름 요약

- DryRun 결제 5건은 각각 한 주문만 만들었고 상품 success 재진입은 멱등이었다.
- 활성 교환 중 admin 주문 전이·송장 수정이 정확한 tooltip과 함께 차단됐고, 거부 후 DryRun 알림은 1회 발송 완료로 기록됐다.
- 수선 사진 async upload 중 입력한 메모가 소실되지 않았고 고객/회사 양쪽 배송 정보와 외부 조회 URL이 일치했다.
- 샘플 결제 후 본주문 checkout에서 ₩30,000 쿠폰을 실제 선택 항목으로 확인했다.
- 토큰 지급·회수 원장과 잔액 산술이 일치했고 사용 후 환불 불가 안내도 확인했다.

## 제한과 최종 결론

유료 OpenAI authoring, 그에 종속된 구성 수정, 활성 session 기반 motif/export/finalize/delete, 지원된 초기 상태가 필요한 onboarding, 실제 viewport 전환이 필요한 모바일 smoke는 실행 조건을 충족하지 못해 BLOCKED다. 실 OAuth·Toss·Solapi·Cloud Tasks·Cloudflare edge 검증도 이 로컬 실행 범위 밖이다.

`[E2E] 대상: 로컬 Aside 전체 화면·흐름 점검 | 결과: FAIL(4 findings) | 실패:B1 seed option_label, B2 focus 갱신, D2 예시 적용, F1 modal 접근성 | 후보:0df35ce`

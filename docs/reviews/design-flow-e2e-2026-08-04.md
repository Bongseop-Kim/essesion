# 디자인 플로우 전체 E2E 결과 — 2026-08-04

## 요약

- 환경: 로컬 store `:3000`, admin `:3001`, API `:8000`, worker `:8001`, PostgreSQL, fake GCS
- 브라우저: Aside, 1424×900 viewport
- 결과: store 12 PASS / 3 WARN / 2 FAIL, admin 4 PASS / 4 WARN / 1 FAIL
- 브라우저 오류: store/admin 모두 `pageerror=0`, `console error=0`
- Recraft: 생성 버튼 1회, 고객 Recraft motif `0 → 1`, 세션 예산 `3 → 2`; 재시도 없음
- 최종 원복: `design_edit_cost=2`, 디자인 예시 6건 모두 게시, 순서 `0,1,2,3,4,5`

빈 DB 준비 기록과 달리 시드 고객의 토큰 원장은 0건/0토큰이었다. 플랜이 허용한 Toss 테스트 결제로 Starter 100토큰을 충전한 뒤 진행했다. 따라서 S15의 기준 잔액은 30이 아니라 100이다.

## store 판정

| ID | 판정 | 확인 내용 |
|---|---|---|
| S0 | PASS | 비로그인 `/design`에서 게시 예시 6건과 로그인 전 상태를 확인했다. 예시 클릭은 `/login` 직행 대신 로그인 확인 다이얼로그를 열었다. |
| S1 | FAIL | 온보딩 표시 자체는 정상이다. 우상단 `닫기` 후 재진입하면 다시 표시됐고, 마지막 `디자인 시작하기`로 완료한 경우에만 유지됐다. 시드 고객 잔액도 기대한 30이 아니라 0이었다. |
| S2 | PASS | 예시 시작 스낵바의 무과금 문구, SVG 넥타이 렌더, 넥타이↔타일 전환을 확인했다. 잔액 100 유지. |
| S3 | PASS | `stripe_motif` 프롬프트 생성 후 SVG·이력 1건, 잔액 `100 → 95`를 확인했다. |
| S3b | WARN | scatter는 동백꽃 산포가 선명했다. lattice는 작은 격자 계열 배치는 보였지만 요청한 페이즐리 모티프는 육안으로 식별되지 않았다. 잔액 `95 → 90 → 85`. |
| S4 | PASS | 구성 수정 `85 → 83`, 이력 2건, 이전 스텝 이동과 전체 이력 모달을 확인했다. |
| S5 | PASS | `벌` 검색에서 `bee`를 선택·무과금 적용했다. 이후 검색에서 `지금 쓰는 그림` 카드 구분도 확인했다. |
| S6 | PASS | `영선` 글자 생성, 나눔명조/나눔고딕과 굵기 변경 시 preview `src` 즉시 변경, 적용 및 내 모티프 저장을 확인했다. |
| S7 | PASS | `logo.png` 원본↔배경 제거 비교, 제한 경고, 슬롯 적용을 확인했다. |
| S8 | WARN | SVG 업로드가 모달 없이 슬롯 progress를 보이고 `honeybee_top`으로 교체됐다. 성공 스낵바는 snapshot 타이밍에서 관찰하지 못했다. |
| S9 | PASS | `재봉틀` Recraft 생성 1회 성공, pending 저장, 내 모티프 저장 문구, 적용 및 캔버스 갱신, 남은 횟수 `3 → 2`를 확인했다. |
| S10 | WARN | 이력·잔액·Recraft 수가 변하지 않고 접힌 모티프 패널이 열렸다. 안내 스낵바는 관찰하지 못했고 서버에는 `-2/+2` 환불 원장과 거절 로그가 남아 순변동은 0이었다. |
| S11 | PASS | 아이디어 4건을 받고 2번 제안을 선택해 입력창을 교체했다. |
| S12 | PASS | PNG 다운로드 성공, `essesion-design.png` 140,488 bytes. |
| S13 | PASS | inline finalize 성공, 완성본 PNG 표시, 일일 잔여 `10 → 9`. |
| S14 | FAIL | 목록은 생성 경로상 4건이었고 예시 세션 삭제 후 3건이 됐다. 세션 전환·삭제는 동작했지만 현재 세션 삭제 후 빈 캔버스가 아니라 다른 세션이 자동 선택됐다. 플랜의 “3개” 기대도 S3b의 새 세션 2건을 포함하면 실행 전 4개가 되어 상충한다. |
| S15 | PASS | admin 전 잔액 83 = `100 - 생성 5×3 - 수정 2`. S10 거절은 `-2/+2`로 순변동 0. A8의 3토큰 수정까지 끝난 최종 잔액은 80이며 admin 원장과 일치했다. |

## admin 판정

| ID | 판정 | 확인 내용 |
|---|---|---|
| A1 | PASS | 대시보드 요약·차트·로컬 provider 상태 렌더, 콘솔 오류 0건. |
| A2 | PASS | 재봉틀 pending 1건, safe SVG·검토 메타데이터, 승인→거절→재승인과 필터 이동을 확인했다. |
| A3 | WARN | 인덱싱 명령 1회로 `updated 1`, `embedded=98/98`; 재봉틀 embedding과 store 검색 결과를 확인했다. 인덱싱 전 어휘 일치 검색은 별도로 캡처하지 못했다. |
| A4 | FAIL | S3 저작과 S4 구성 수정은 분류됐고 상세에 요청자, 세션/user 연결 필드, 경고, `-2` 토큰 정산이 보였다. S9 Recraft 생성은 `motif_generation` Seamless 로그가 전혀 남지 않았다(`motif_logs=0`). |
| A5 | WARN | finalize 작업 1건 succeeded, 입력 조건과 결과 이미지·공개 링크를 확인했다. 화면 정책상 객체 키는 숨기므로 플랜이 요구한 산출물 키 원문은 확인할 수 없었다. |
| A6 | WARN | 순서 변경, 게시 해제, store 6→5건, 원복 6건을 확인했다. 열린 store 탭은 즉시 갱신되지 않아 reload 후 반영됐다. 최종 순서/게시 상태는 원복했다. |
| A7 | PASS | 후보 0건 빈 상태와 선별된 오소링 예시 25건 목록·상세·preview를 확인했다. |
| A8 | WARN | 설정 `2 → 3`, store 안내 3토큰, 실제 수정 차감 `83 → 80`, 설정 `3 → 2` 원복과 pricing 화면을 확인했다. 열린 store 탭의 안내는 reload 전까지 2로 남아 있었다. |
| A9 | PASS | 고객 상세 잔액 80과 8건 원장을 확인했다. Starter `+100`, 생성 `-5×3`, 수정 `-2`, 거절 `-2/+2`, A8 수정 `-3`으로 합계가 일치한다. |

## 발견 사항

1. 온보딩 닫기 버튼이 완료 상태를 저장하지 않는다.
2. 현재 디자인 세션 삭제 후 빈 캔버스 대신 다른 세션이 자동 선택된다.
3. store의 디자인 예시와 설정 쿼리가 열린 탭에서 갱신되지 않아 admin 변경이 reload 뒤 반영된다.
4. Recraft motif 생성이 `seamless_generation_logs`에 기록되지 않아 admin에서 S9 상관 분석을 할 수 없다.
5. 시드 고객은 설정의 초기 지급량 30과 달리 토큰 원장이 비어 있어 플랜의 시작 잔액 전제가 재현되지 않는다.
6. lattice 대표 프롬프트가 격자는 재현했지만 페이즐리 모티프를 보존하지 못했다.
7. A5의 현재 보안 projection은 객체 키를 의도적으로 숨기므로 플랜의 확인 항목을 결과 객체 존재·공개 링크 기준으로 맞출 필요가 있다.

## 실행한 검사

- Aside 전체 store/admin 시나리오
- `uv run alembic -c db/alembic.ini current` → `6dbb8bb66939 (head)`
- `uv run python apps/worker/scripts/index_motif_embeddings.py --confirm-live` → `updated 1`, `embedded=98/98`
- store Vitest: 2 files, 15 tests PASS
- admin Vitest: 5 files, 36 tests PASS
- 최종 DB 대조: 세션 3, 잔액 80/원장 8, Recraft 1/approved 1/embedded 1, finalize 1/succeeded 1

`[E2E] 대상: 디자인 전체 플로우 | 이유: 로그인·API·DB·worker·외부 연동 경계 | 결과: FAIL(회귀 3축, 관찰/플랜 드리프트 별도 WARN) | 실패: 온보딩 닫힘 유지, 현재 세션 삭제 후 빈 캔버스, motif generation 로그 누락`

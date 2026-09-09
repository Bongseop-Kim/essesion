# 스토어 팝업 공지 — 템플릿 3종·기간 노출·admin 관리 (2026-09-09)

플랜 `docs/plans/store-popup-notice.md`(실행 완료 후 삭제)를 실행했다. 추석 일정처럼 **특정 기간에만** store 첫 진입에서
모달로 보여주는 안내를 admin에서 템플릿을 골라 등록·활성·수정·삭제한다. 시안은
[디자인 캔버스](https://claude.ai/code/artifact/3b8d14a1-6e91-49f0-9cb9-a05506f5a833)가 정본이고, 모바일은 하단 시트로 통일했다.
2026-09-09 논의 경과: 일반 공지 관리(정적 배열 → DB) 플랜을 먼저 썼다가 "팝업 공지"가 목적임을 확인해 폐기 → 텍스트 팝업 →
쇼핑몰 팝업으로 약하다는 피드백 → 국내 배송 안내 팝업 28장을 조사해 템플릿(NOTICE 태그·두 굵기 제목·선 그림 아이콘·
마감/휴무/재개 달력·라벨 값 표) 방식으로 확정.

## 한 것

- **DB** `db/src/db/models/content.py` `PopupNotice` + 리비전 `20260909_16d24e91da59_popup_notices.py`. 컬럼: template(CHECK
  holiday|operation|event)·title·title_emphasis·body·fields(JSONB)·link_url·starts_on·ends_on(CHECK 순서)·enabled. 데이터 이관 없음.
- **API** `apps/api/src/api/domains/popups/`
  - 공개 `GET /popups/active` — enabled + KST 오늘이 기간 안인 1건(`starts_on desc, created_at desc`), 없으면 200 `null`.
    응답은 렌더용 필드만(이미지는 공개 URL로 치환).
  - admin `GET·POST /admin/popups`, `PATCH·DELETE /admin/popups/{id}`, 배너 이미지 upload-url·complete·delete(상품 이미지 경로
    복제, `popup_upload → popup`). `fields`는 `template` 판별 discriminated union으로 검증(휴무 날짜 순서·표 1–4행·이벤트 링크 필수).
    PATCH는 병합 뒤 기간·링크를 다시 검증. 교체·템플릿 변경·삭제로 빠진 배너는 `expires_at=now()`.
  - `batch/router.py` 공개 버킷 판정 접두에 `popup` 추가(빠지면 정리 배치가 비공개 버킷에서 지우려다 실패).
  - `docs/api-spec/domains.md` §8·§10 갱신, `pnpm codegen`.
- **admin** `apps/admin/src/pages/popups/` — 목록(템플릿·제목·기간·상태 "노출 중/대기·종료/비활성"·활성 Switch·수정·삭제),
  등록·수정 공용 폼(템플릿 RadioGroup → 필드 묶음 전환, 날짜 순서 클라이언트 검증, 이벤트는 `AttachmentDisplayField`로 배너 1장),
  `popup-form-model.ts`(초안↔요청 변환·검증), `upload.ts`. 내비 운영 그룹 "팝업 공지", 라우트 3개.
- **store** `apps/store/src/features/popup-notice/` — `PopupNoticeModal`(shared Modal, 앱 레이아웃에 1회 마운트, `/design`·결제
  결과·로그인 화면에서는 비표시), 템플릿별 렌더: 휴무는 날짜 4개에서 **달력·범례를 자동 생성**(`model/calendar.ts`), 운영은
  라벨·값 표, 이벤트는 4:3 배너. `**굵게**` 마크 파서, "오늘 하루 보지 않기"는 팝업 id별 KST 날짜를 localStorage에 저장.
  버튼: 오늘 하루 보지 않기 · 확인(링크가 있으면 "자세히 보기" — 내부 경로는 navigate, https는 새 탭).

## 검증

- `uv run pytest apps/api/tests/test_popups.py apps/api/tests/test_authz.py -k popup` 8 passed(공개 조회 경계·겹침, 검증 422,
  이미지 연결·교체 만료·타인/미완료 거부, 인가 행렬 3케이스). `test_batch.py`·`test_contract.py`·`test_admin_products.py` 230 passed.
  `alembic check` 드리프트 없음. `ruff`·`pyright` 클린.
- store vitest 11(달력 2026 추석 입력·주 경계 띠·3주 절단, dismissal KST 경계, 굵게 파서), admin vitest 9(폼 모델 변환·검증,
  목록 토글·삭제 다이얼로그, 템플릿 전환·날짜 순서 차단) 추가. `pnpm lint`·`pnpm typecheck`·`pnpm architecture:check` 통과.
  admin 사이드바 테스트에 "팝업 공지" 추가. `pnpm codegen` 재실행 시 변화 없음.
- 브라우저(Aside, PC 1440 폭, 콘솔 오류 0건):
  - admin `/popups/new` 휴무 템플릿(마감 9/23 14:00, 휴무 9/24–27, 재개 9/28) 등록 → 목록 "비활성" → 활성 → "노출 중".
  - store `/` — 시안 1번과 같은 모달(NOTICE·두 굵기 제목·트럭·9월 달력의 23 검은 원/24–27 회색 띠/28 테두리 원·범례 3줄·하단 문구).
    "확인" → 새로고침 시 다시 뜸. "오늘 하루 보지 않기" → `popup:dismissed:<id>=2026-09-09` 저장, 새로고침 시 안 뜸 → 키 삭제 후
    다시 뜸. `/design`에서는 안 뜸.
  - 수정 화면에서 운영 템플릿으로 전환·3행 입력 → store에 시안 2번과 같은 표. 이벤트 템플릿으로 새 팝업 등록(배너 PNG 업로드 →
    fake-gcs 공개 URL) → store에 배너 + EVENT 태그, "자세히 보기"가 `/shop`으로 이동. 삭제 다이얼로그로 삭제 → 배너 행에
    `expires_at` 기록.
- 모바일 폭 시트 전환은 Aside REPL에 viewport 조절 API가 없어 브라우저로 확인하지 못했다(코치마크 리뷰와 같은 한계). shared
  Modal의 기존 동작에 의존한다.

## 시안과 다른 점 / 남긴 것

- **이벤트 배너는 모달 여백 안에 라운드로** 들어간다. 시안은 가장자리까지 차지하지만 shared Modal에 콘텐츠 여백을 넘기는 슬롯이
  없어 임의 값으로 우회하지 않았다(규칙 0). 전폭이 필요하면 Modal에 inset 슬롯을 추가한 뒤 바꾼다.
- 로컬 DB에 검증용 팝업 1건(배송·운영 안내, 비활성)이 남아 있다. 지워도 된다.
- admin 미리보기는 없다. 운영자 피드백이 오면 store 렌더 컴포넌트를 `packages/shared`로 올려 재론(플랜의 기각 대안 참조).
- 로컬 확인 중 store(3000)·admin(3001) vite와 api(8000)를 새로 띄웠다(다른 프로젝트 Next.js가 wildcard로 같은 포트를 쓰고 있어
  vite는 localhost 바인딩으로 함께 떴다).

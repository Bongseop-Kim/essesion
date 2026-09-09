# 스토어 팝업 공지 — 템플릿 3종으로 기간 한정 안내를 admin에서 띄우고 내린다

추석 일정 안내처럼 **특정 기간에만** store 첫 진입에서 모달로 보여주는 팝업 공지를 만든다. 팝업은 미리 디자인한
**템플릿 3종**(휴무·명절 안내 / 배송·운영 안내 / 이벤트·프로모션) 중 하나를 고르고 빈칸을 채우는 방식이다 —
관리자가 이미지를 매번 만들지 않아도 쇼핑몰 수준의 팝업이 나오게 하는 것이 목적이다. 시안은
[디자인 캔버스](https://claude.ai/code/artifact/3b8d14a1-6e91-49f0-9cb9-a05506f5a833)(2026-09-09 확정)가 정본이며,
모바일은 **하단 시트로 통일**한다. 기존 `/notice` 정적 공지 목록은 대상이 아니다. 새 의존성 없이 기존 골격(FastAPI +
Alembic + OpenAPI codegen + admin 표 위젯 + shared `Modal` + 상품 이미지 업로드 경로)만 쓴다. 브랜치 `feat/post`에서 실행한다.

## 왜 필요한가

- 명절 휴무·배송 지연처럼 기한이 있는 안내를 운영자가 배포 없이 올리고 내릴 수단이 없다. 지금 공지는
  `apps/store/src/pages/notice/model/notice-data.ts`의 정적 배열이고, 첫 진입에서 눈에 띄는 자리는 없다.
- 2026-09-09 논의: 텍스트만 띄우는 팝업은 쇼핑몰 팝업으로 약하다고 결정. 국내 쇼핑몰 배송 안내 팝업 28장을 조사한 결과
  구조가 일정했다 — NOTICE 태그, 두 굵기 제목, 선 그림 트럭·상자 아이콘, **마감일·휴무 띠·재개일을 표시한 미니 달력**,
  굵게 강조한 핵심 구절, 정책 변경은 라벨·값 표. 이 구조를 토큰으로 옮긴 것이 템플릿이다.
- 기간 노출은 조회 조건 한 줄(`starts_on <= 오늘 <= ends_on`)로 끝나서 운영자가 내리는 것을 잊어도 자동으로 사라진다.
- admin에는 같은 형태(목록·토글·삭제)의 화면이 있다 — `apps/admin/src/pages/design-examples/list.tsx`. 이미지 업로드도
  상품 이미지 경로(`apps/api/src/api/domains/admin/products.py:595` 이하, `apps/admin/src/pages/products/upload.ts`)가 있다.

## 범위 밖(non-goals)

- 일반 공지(`/notice`) 관리 화면, 팝업 노출 통계, 페이지별 노출 조건, 여러 팝업 동시 노출, 관리자 자유 레이아웃(HTML·리치텍스트).
- 모바일 중앙 카드·풀모달 형태 — 하단 시트로 통일하기로 결정(2026-09-09). 재론하지 않는다.
- `apps/store/src/pages/my-page/my-info/notice.tsx`는 알림 설정 페이지다. 이름만 겹치고 무관하니 건드리지 않는다.

## 실행 조건

- 로컬 DB·api·store·admin이 떠 있어야 검증 가능(AGENTS.md 부트스트랩). 기존 포트 확인 후 없을 때만 띄운다.
- `uv run alembic -c db/alembic.ini check`가 깨끗한 상태에서 시작한다. 다른 모델 드리프트가 있으면 그것을 먼저 해소하고 기다린다.
- 시안과 다른 모양을 만들면 안 된다 — 템플릿의 시각 요소(태그·아이콘·달력·표)는 캔버스가 정본이다. 구현하다 토큰으로
  표현이 안 되면 임의 값으로 우회하지 말고 멈춰서 토큰 추가를 제안한다(`packages/shared/AGENTS.md` 규칙 0).
- 실행하면 안 되는 조건: 노출 기간·달력 날짜를 timestamptz로 받아 브라우저 시간대에 맡기는 것. 운영자는 KST 날짜로
  생각하므로 `date` + 서버 KST 판정으로 고정한다.

## 설계 요약

### 데이터

- 테이블 `popup_notices`: `id uuid` · `template text`(CHECK `holiday|operation|event`, 이름 `ck_popup_notices_template`) ·
  `title text` · `title_emphasis text null`(제목 뒤에 굵게 붙는 부분, 예: "추석 연휴" + "배송 안내") · `body text null`
  (평문, `**굵게**` 마크만 허용) · `fields jsonb`(템플릿별 필드, 아래) · `link_url text null` · `starts_on date` ·
  `ends_on date` · `enabled bool default false` · `created_at`/`updated_at`(TimestampMixin).
  제약 `ck_popup_notices_period`: `starts_on <= ends_on`. 인덱스 `(enabled, starts_on, ends_on)`.
  근거: 템플릿마다 컬럼을 따로 두면 nullable 컬럼이 10개가 넘는다. `fields`는 API가 pydantic discriminated union으로
  검증하므로 DB에 CHECK를 더 두지 않는다(`db/README.md`의 text+CHECK 원칙은 `template` 컬럼에 적용).
- `fields` 형태(pydantic, `template`으로 분기):
  - `holiday`: `cutoff_on date`, `cutoff_time "HH:MM"`, `closed_from date`, `closed_to date`, `resume_on date`,
    `footnote str|null`. 순서 검증 `cutoff_on <= closed_from <= closed_to < resume_on`.
  - `operation`: `rows [{label 1–20자, value 1–80자}]` 1–4개, `footnote str|null`.
  - `event`: `image_upload_id uuid`(필수), `footnote` 없음. `link_url`은 이 템플릿에서 필수.
- 이미지(`event`만): 상품 이미지와 같은 방식 — 관리자가 서명 URL로 GCS 공개 assets 버킷에 직접 올리고 완료 등록,
  저장 시 팝업에 연결. `Image.entity_type`은 `popup_upload`(스테이징) → `popup`(연결). 응답에는 `image_url`(public URL)만 내려준다.

### API

- 공개 `GET /popups/active` — `enabled`이고 KST 오늘이 기간 안인 행 중 **1건**(`starts_on desc, created_at desc` 첫 행).
  없으면 **200 + `null`**. KST 오늘은 `apps/api/src/api/domains/admin/orders.py:113` 방식(`datetime.now(KST).date()`,
  `KST`는 `apps/api/src/api/domains/auth/phone.py:18`). 응답은 렌더에 필요한 것만: template·title·title_emphasis·body·
  fields(이미지는 `image_url`로 치환)·link_url.
- admin `GET·POST /admin/popups`, `PATCH·DELETE /admin/popups/{id}`, 이미지 `POST /admin/popups/images/upload-url`,
  `POST /admin/popups/images/{upload_id}/complete`, `DELETE /admin/popups/images/{upload_id}` — 모두 `AdminUser`.
  등록 직후 `enabled=false`. `AdminPopupNoticeOut`에 `active_now: bool`(지금 노출 중) 계산값 포함.

### store 렌더

- 앱 레이아웃 마운트 시 한 번 조회, 결과가 있고 오늘 닫은 적 없으면 shared `Modal`(PC 중앙 560 / 모바일 하단 시트)로 띄운다.
- 템플릿 공통: 우상단 X, 가운데 정렬의 검은 `NOTICE`/`EVENT` 태그(Badge solid), 제목 `title1`(앞 400 + `title_emphasis` 700),
  본문 `body`(`**…**`만 굵게), 하단 버튼 두 개 — `neutralWeak` "오늘 하루 보지 않기" · `brandSolid` "확인"(`link_url`이 있으면
  "자세히 보기"로 바뀌고 이동). 닫힘은 X·Esc·바깥 클릭·시트 쓸어내림. `/design`에서는 띄우지 않는다(코치마크와 겹침).
- `holiday`: 트럭 아이콘(앱 소유 SVG, `Icon` 래핑) → **달력**: `cutoff_on`과 `closed_from` 중 이른 날이 속한 주의 일요일부터
  `resume_on`이 속한 주의 토요일까지(최대 3주, 넘으면 3주에서 자른다). 마감일은 검은 원(`bg.neutral-inverted`), 휴무 기간은
  `bg.neutral-weak` 띠(주 경계에서 끊고 양끝 라운드), 재개일은 검은 테두리 원. 달력 아래 범례 3줄(마감·휴무·재개)은 같은
  날짜에서 자동 생성 — 관리자가 문장을 쓰지 않는다. `footnote`는 `caption` 회색 가운데 정렬.
- `operation`: 상자 아이콘 → 라벨·값 표(라벨 열 120px `bg.neutral-weak`, 행 구분 `stroke.neutral-weak`) → `footnote`.
- `event`: 상단 이미지(`ImageFrame ratio 4/3`, PC 560×420, 모바일은 시트 폭 4:3) 위에 흰 원형 X → EVENT 태그 → 제목 → 본문 → 버튼.
- "오늘 하루 보지 않기": localStorage `popup:dismissed:<id>`에 KST `YYYY-MM-DD` 저장(`Intl.DateTimeFormat("en-CA",
  { timeZone: "Asia/Seoul" })`). 같은 날이면 숨김, 팝업 id가 바뀌면 다시 뜬다. 스토리지 접근은
  `apps/store/src/shared/lib/browser-storage.ts`의 `resolveStorage` 경유(프라이빗 모드 방어).

## 절차

의존 순서다. 1→2→3(codegen)이 끝나야 4·5가 타입체크를 통과한다.

1. **모델 + 마이그레이션** — `db/src/db/models/content.py`(신규)에 `PopupNotice`를 위 필드·제약으로 정의하고
   `db/src/db/models/__init__.py:3` import 목록에 `content` 추가. `uv run alembic -c db/alembic.ini revision --autogenerate
   -m "popup_notices"` 후 생성물 검수(CHECK 이름 2개, 인덱스). 데이터 INSERT 없음. `downgrade()`는 테이블 drop.
   `Image.entity_type`은 자유 text라 마이그레이션 불필요.

2. **API** — `apps/api/src/api/domains/popups/__init__.py` + `router.py` + `schemas.py`(신규). 골격은
   `apps/api/src/api/domains/design/examples.py`(공개 `router` + `admin_router` 한 도메인). `schemas.py`에 `fields`의
   discriminated union(`HolidayFields|OperationFields|EventFields`, `template` 판별)과 날짜 순서 검증(`model_validator`,
   422 메시지 한글). 이미지 3종 엔드포인트는 `apps/api/src/api/domains/admin/products.py:595`–`757`의 upload-url·complete·
   delete를 **복제**해 entity_type만 `popup_upload`/`popup`, prefix `popups/`로 바꾼다(추상화하지 않는다 — 두 번째
   복제일 뿐이고 상품 쪽 계약을 흔들지 않는다). POST/PATCH 저장 시 `image_upload_id`를 `popup`으로 링크하고 교체·삭제된
   이전 이미지는 `expires_at = now()`(수기 주문 첨부와 같은 규칙, `docs/api-spec/domains.md` §8).
   `apps/api/src/api/domains/batch/router.py:141`의 `uses_assets_bucket` 접두 튜플에 `"popup"`을 추가한다 — 빠지면 만료
   정리 배치가 비공개 버킷에서 지우려다 실패한다.
   `apps/api/src/api/main.py:329` `_include_routers`에 두 라우터 등록.

3. **명세·codegen** — `docs/api-spec/domains.md` §10 끝에 "팝업 공지" bullet: 엔드포인트, 공개 조회 규칙(1건·`null`),
   템플릿 3종과 `fields` 형태·검증, 이미지 entity_type 2종과 만료 규칙, 등록 직후 비활성. §8 이미지 등록 종류 목록에
   `popup_upload → popup(entity_id=팝업 id, admin 전용, 공개 assets 버킷)` 한 줄 추가. 그 다음 `pnpm codegen`으로
   `packages/api-client`를 같은 커밋에(CI codegen-drift).

4. **admin 화면** — `apps/admin/src/pages/popups/list.tsx`·`form.tsx`·`upload.ts`(신규).
   - `list.tsx`: `design-examples/list.tsx` 복제. 컬럼 `템플릿`(Badge) · `제목` · `노출 기간` · `상태`(Badge: `active_now`
     "노출 중" / enabled+기간 밖 "대기·종료" / "비활성") · `활성(Switch)` · `관리(수정·삭제)`. `AlertDialog` 삭제 확인.
   - `form.tsx`: 등록·수정 공용(`useParams().popupId`). 맨 위 `RadioGroup`(horizontal)으로 템플릿 선택 — 선택에 따라 아래
     필드 묶음이 바뀐다. 공통: 제목·강조 제목·본문(`TextAreaField rows={4}`, 설명에 "굵게는 **로 감쌉니다")·링크·
     시작일·종료일(`TextField type="date"`, 패턴 `apps/admin/src/pages/coupons/coupon-form.tsx:270`).
     `holiday`: 마감일+시각(`TextField type="date"` + `type="time"`)·휴무 시작·휴무 종료·재개일·하단 문구.
     `operation`: 라벨·값 행 1–4개(행 추가/삭제 버튼, `NumberField` 아님 — 자유 텍스트)·하단 문구.
     `event`: `AttachmentDisplayField max=1`(패턴 `apps/admin/src/pages/products/product-form.tsx`)·링크 필수.
     날짜 순서·기간 검증은 제출 전 클라이언트에서도 막는다.
   - `upload.ts`: `apps/admin/src/pages/products/upload.ts` 복제, 팝업 이미지 API 3종으로 교체.
   - 라우트: `apps/admin/src/app/router/router.tsx:348` 부근에 `popups` · `popups/new` · `popups/:popupId/edit`.
   - 내비: `apps/admin/src/shared/config/navigation.ts` `operations` 그룹 `reviews` 뒤에
     `{ key: "popups", label: "팝업 공지", href: "/popups" }`.

5. **store 팝업** — `apps/store/src/features/popup-notice/`(신규): `ui/popup-notice-modal.tsx`(Modal 셸·공통 헤더·버튼·
   템플릿 분기), `ui/holiday-calendar.tsx`(달력+범례), `ui/operation-table.tsx`, `model/calendar.ts`(날짜 → 주 배열·표시 종류 계산,
   순수 함수), `model/dismissal.ts`(오늘 하루 보지 않기), `model/bold-markup.ts`(`**…**` → 세그먼트 배열, 순수 함수).
   아이콘 SVG 2개(트럭·상자)는 `apps/store/src/features/popup-notice/ui/icons.tsx`에 앱 소유로 두고 `Icon`으로 래핑
   (heroicons에 트럭은 있으나 시안의 선 그림과 다르면 시안을 따른다).
   마운트: `apps/store/src/app/layout/app-layout.tsx` 레이아웃 안 `Outlet` 옆 1회. 로그인 여부 무관.
   `pnpm architecture:check`의 dependency-cruiser 경계 — 다른 feature import 금지.

6. **테스트**
   - `apps/api/tests/test_popups.py`(신규): 공개 조회(비활성·기간 밖 숨김, 겹치면 1건, 없으면 `null`, KST 경계 포함),
     템플릿별 `fields` 검증 422(순서 위반, rows 5개, event에 link 없음), 등록 직후 `enabled=false`, 이미지 업로드→완료→저장
     링크→교체 시 이전 이미지 만료, 남의 스테이징 이미지 링크 거부. 패턴: `test_design_examples.py`·`test_admin_products.py:329`.
   - `apps/api/tests/authz.py:315` `AdminCase`에 `admin_popups_list`(GET)·`admin_popups_create`(POST)·
     `admin_popups_image_upload_url`(POST) 추가 — 익명 401·customer 403 행렬(대원칙: 인가 테스트 mock 금지).
   - `apps/admin/src/pages/popups/list.test.tsx`: 템플릿 전환 시 필드 묶음 변경, 날짜 순서 차단, 활성 토글, 삭제 확인.
   - `apps/store/src/features/popup-notice/model/calendar.test.ts`: 2026 추석 입력(마감 9/23, 휴무 9/24–27, 재개 9/28) →
     9/20 시작 2주·표시 종류가 시안과 같은지, 주 경계를 넘는 휴무 띠, 3주 초과 절단. `dismissal.test.ts`: 같은 날 숨김·
     날짜 바뀌면 표시·storage null이면 항상 표시. `bold-markup.test.ts`: 짝 안 맞는 `**`는 그대로 출력.
   - 마이그레이션 드리프트는 기존 `tests/test_migrations.py`의 `alembic check`가 잡는다.

## 검증

```bash
uv run alembic -c db/alembic.ini upgrade head && uv run alembic -c db/alembic.ini check
curl -s localhost:8000/popups/active            # 기대: null
curl -s -o /dev/null -w '%{http_code}\n' localhost:8000/admin/popups   # 기대: 401
uv run pytest apps/api/tests/test_popups.py apps/api/tests/test_authz.py -k "popup"
pnpm codegen && git status --short packages/api-client   # 재실행 시 변화 없어야 한다
pnpm lint && pnpm typecheck && pnpm test && pnpm architecture:check
```

브라우저(Aside 하네스, `.claude/skills/aside-browser/SKILL.md`):

1. admin `/popups/new`에서 `holiday` 템플릿으로 2026 추석 날짜 입력 → 등록 → 목록 "비활성" → 활성 토글 → "노출 중".
2. store `/` 새로고침 → 시안 1번과 같은 모달(NOTICE 태그·두 굵기 제목·트럭·9월 달력·범례 3줄). 캔버스 시안과 나란히 비교한다.
   "확인" → 새로고침 시 다시 뜸 → "오늘 하루 보지 않기" → 안 뜸 → localStorage 키 삭제 → 다시 뜸.
3. `operation` 템플릿으로 행 3개 등록·활성 → 표가 시안 2번과 같은지. `event` 템플릿으로 이미지 업로드·링크 → 시안 3번,
   "자세히 보기"가 링크로 이동. 저장 후 이미지를 교체하면 이전 이미지 행의 `expires_at`이 찍히는지 psql로 확인.
4. admin에서 종료일을 어제로 수정 → store에서 안 뜸(활성이어도 기간 밖). `/design`에서는 안 뜸.
5. 모바일 폭(390px)에서 하단 시트로 전환되고 달력 7열이 잘리지 않는지 — Aside REPL은 viewport 조절이 없어 jsdom 렌더
   테스트나 실기기로 확인한다(코치마크 리뷰에서 같은 한계를 겪었다).

## 되돌리는 법

`alembic downgrade -1`이 팝업 데이터를 지운다. 운영 중 되돌려야 하면 `pg_dump -t popup_notices`로 먼저 떠 둔다. 연결된
이미지 행은 `images`에 남으므로 정리 배치가 만료 처리하게 `expires_at`을 찍어 둔다. 프론트만 되돌리면 API는 남고 팝업이
안 뜰 뿐이라 안전하다. 상향 신호: 팝업이 뜨지 않는다는 보고가 오면 먼저 `GET /popups/active`를 curl로 확인한다 — 기간·활성
문제(운영)와 프론트 문제(코드)를 여기서 가른다.

## 기각한 대안

- **텍스트만 있는 단일 팝업**: 쇼핑몰 팝업으로 눈에 띄지 않는다는 이유로 기각(2026-09-09). 재론 조건 없음.
- **관리자 HTML/리치텍스트 입력**: sanitizer 의존성이 없고 디자인 시스템 밖에서 렌더돼 톤이 깨진다. 재론 조건 없음.
- **이미지 배너만**: 관리자가 매번 이미지를 만들어야 하고 접근성·모바일 가독성이 떨어진다. 이벤트 템플릿에만 이미지를 둔다.
- **일반 공지 테이블에 팝업 플래그**: 일반 공지가 정적 배열이라 공지 CRUD 전체를 먼저 만들어야 한다. 일반 공지 관리를
  admin으로 옮기기로 결정되면 `notice_id` 참조 컬럼 하나로 연결한다.
- **모바일 중앙 카드·풀모달**: 시트로 통일(2026-09-09). 풀모달은 안내 공지가 전면 광고처럼 읽힌다.
- **admin 안 실시간 미리보기**: store의 렌더 컴포넌트를 shared로 올려야 한다(2개 앱 사용 조건은 충족). 운영자가 미리보기
  없이 등록하기 어렵다는 피드백이 오면 `packages/shared`로 이동해 재론.
- **템플릿별 컬럼 분리**: nullable 컬럼 10개+. `fields jsonb` + pydantic 검증으로 대체.
- **`admin_settings` JSON 저장**: 숫자 설정용 검증·화면이고 공개 조회 엔드포인트가 없다.
- **timestamptz 기간·예약 시각**: 운영자는 날짜로 생각한다. 시각 단위 노출 요구가 나오면 재론.
- **여러 팝업 동시 노출·우선순위**: 1건만 고른다. 동시 노출 요구가 나오면 `ordinal` 추가로 재론.

**실패 모드:** 시안을 "참고"로 취급해 구현하며 모양을 바꾸는 것, 기간 판정을 브라우저 시간대에 맡기는 것, 배치의 버킷 접두
목록에 `popup`을 빠뜨려 만료 이미지가 지워지지 않는 것, 그리고 "일반적인 팝업 관리"를 떠올려 우선순위·페이지별 조건·자유
레이아웃을 붙이는 것이다.

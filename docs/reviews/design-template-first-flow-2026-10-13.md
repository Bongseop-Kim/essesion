# 디자인 템플릿 우선 흐름 — 1차 실행 기록 (2026-10-12 ~ 2026-10-13)

`docs/plans/design-template-first.md`(2026-10-08 판)의 고객 화면·색 API 부분을 실행했다. 남은 일(옛 캔버스 삭제, API 정리, 템플릿 컬럼, 실 색 표)은 같은 이름의 플랜을 2026-10-13에 다시 써서 둔다.

## 만든 것

- **store 흐름**: `/design`(템플릿 목록, 공개) → `/design/templates/:id`(상세, "이 템플릿으로 시작") → `/design/sessions/:id/color`(프리셋 선택, 화면 치환 미리보기, 다음에서 서버 적용) → `/design/sessions/:id/logo`(SVG 그대로·사진은 배경 제거, 생성 = 슬롯 교체 + 실사화) → `/design/sessions/:id/result`(실사 2장, 주문 / 템플릿·색·로고 다시 고르기). 파일은 `apps/store/src/pages/design/{templates,template,color,logo,result}.tsx`, 공용 샷 구성은 `features/design/ui/template-shots.tsx`.
- **색 API**: `POST /design/sessions/{id}/color {colorway_id}` — intent의 colorway만 바꾼 무료 결정론 재렌더(`motifs/activate`와 같은 dispatch, 턴 type `colorway`). 없는 id는 422 `invalid_colorway`. `docs/api-spec/domains.md` §11.
- **색 프리셋 데이터**: 새 컬럼 없이 엔진 colorway를 쓴다. `apps/worker/scripts/seed_design_examples.py`가 템플릿마다 임시 실 색 프리셋 5개(바탕 + 스트라이프 밴드 슬롯만 치환, 모티프 고유 색 유지)를 intent.colorways에 넣는다.
- **TieCanvas**(shared): `focus`(매듭·무늬·끝 확대)와 `emblem`(포인트 로고 미리보기) prop.
- `/design`은 세션을 자동 복원하지 않는다. 옛 캔버스는 `/design/sessions/:id`로 옮겨 두었고 고객 흐름에서는 거치지 않는다(삭제는 플랜 항목 1).

## 결정 (사용자)

- 실 색은 "일단 대충", 로고는 올린 파일 그대로(엔진 recolor 없음), 사전 검증 생략, 화면부터 만들고 백엔드는 필요할 때.
- 템플릿 목록은 다른 페이지와 같은 ContentLayout·브레드크럼·좌측 정렬, 칩 필터, 매거진형(한 줄 하나, PC 좌우 교대), 행 전체 링크. 상세는 모달이 아니라 페이지.
- 사진 구성 규칙: 공통 전체 샷 + 무늬 확대, 포인트 상단 = 매듭 확대 추가, 하단 = 끝 확대 추가, 올패턴 = 추가 없음.
- 성공 알림("토큰은 쓰지 않았어요")은 띄우지 않는다. 화면 전환이 결과다.
- 로고 뒤에는 옛 캔버스가 아니라 생성 → 결과 2장 → 네 갈래 선택.

## 확인한 것

- store 디자인 페이지 테스트 6파일 34건, api `color` 테스트 2건, lint·하네스·타입체크·ruff·pyright·architecture:check 통과.
- 브라우저(통합 브라우저 CDP, 1440·390): 템플릿 → 시작 → 색(버건디 적용, 서버 재렌더 확인) → 로고(SVG 업로드, 앵커 자리에 로고) → 생성은 잔액 부족으로 거절까지. 실사화는 유료라 돌리지 않았다.

## 알게 된 것

- worker(8001)가 꺼져 있으면 색 적용이 `upstream_error`로 남는다. 서버 기동 확인이 먼저다.
- 2026-08-03 이후 처음 돌린 갤러리 시드가 9월 엔진 변경을 반영해 일부 템플릿 모양이 바뀌었다(가드 밴드 앵커: 가는 선 → 24mm 밴드). 프리셋 주입과 무관함을 같은 플랜을 프리셋 유무로 합성해 확인했다.
- 엔진은 타일 반복만 그린다. 넥타이 한 곳의 포인트 로고는 intent·실사화·정본 타일에 개념이 없어 별도 플랜이 필요하다. 지금의 `emblem`은 미리보기 컴포넌트가 얹은 것이다.
- 로고 "생성"은 화면이 "내 모티프 저장 → 슬롯 교체 → 실사화" 세 번을 왕복한다. 저장은 worker의 content-hash id 덕에 멱등이지만, 슬롯 번호를 화면이 추측한다 — 플랜 항목 3의 근거.

## 2026-10-13 (2차) — 옛 캔버스 삭제와 API 정리 (플랜 항목 1~4)

재작성한 플랜 `docs/plans/design-template-first.md`의 항목 1~4를 실행했다. 남은 항목(템플릿 컬럼, 실 색 표)은 플랜에 둔다.

### 한 것

- **옛 캔버스 삭제(항목 1)**: 라우트 `design/sessions/:id`, `pages/design/index.tsx`, `features/design/ui/`의 캔버스·모티프 패널·채팅 입력·이력·코치마크·도구 레일·세션/완성본 모달·내려받기/실사화 다이얼로그, `features/design/model/`의 생성·검색·진행 중·온보딩·삭제·타이 이미지 훅, `use-design-output.ts`의 내려받기, `queries.ts`의 세션 목록 옵션, `index.css`의 코치마크·점등·패널 강조 CSS, `analytics.ts`의 `generate_design` 이벤트를 지웠다. 68파일, 약 8,600줄 감소. 남긴 것은 플랜의 "남긴다" 목록 그대로(주문제작의 완성본 피커 경로 포함).
- **세션 단건에 현재 SVG(항목 2)**: 새 필드 대신 목록의 `preview_svg`(편집 포인터 런의 디자인 SVG)를 단건 GET과 재렌더 응답(`_design_session_out`)에도 채운다 — 같은 서브쿼리(`_pointer_svg_query`)를 둘이 쓴다. 플랜은 `current_svg`를 더하라 했지만 뜻이 같은 필드가 이미 있어 재사용했다(스키마 변경 없음). store `color.tsx`·`logo.tsx`는 `session.preview_svg`를 읽고, 턴 이력(`steps.ts`·`turn-payload.ts`·`designTurnsQueryOptions`)과 턴 invalidate는 지웠다.
- **로고 한 번에 넣기(항목 3)**: `POST /design/sessions/{id}/logo {name, svg}` — 소유 확인 → 진행 중 409 → `import_user_motif`(멱등) → `activate_motif`를 그대로 이어 부른다. 슬롯은 서버가 정한다(모티프 레이어 둘이면 2, 아니면 1). store `logo.tsx`의 생성은 "logo → finalize" 두 호출이고, `useActivateMotifSlot`·`importDesignMotifSvg`·클라이언트 `finalize` 턴 기록(`appendDesignTurn`)은 지웠다. `pnpm codegen` 반영.
- **결과 복원(항목 4)**: `result.tsx` 새로고침 복원을 `GET /design/jobs?kind=finalize&status=succeeded&session_id=<id>&limit=1`(`latestFinalizedJobQueryOptions`)로 바꿨다. 주문 넘김은 route state 그대로.
- 루트 `AGENTS.md`의 Aside 항목 삭제, `docs/analytics.md`의 `generate_design` 행을 폐기로 표시.

### 확인한 것

- store 디자인·주문제작 테스트 12파일 51건, api `test_design.py -k "logo or pointer or colorway or motif_activate or current_motifs or lifecycle"` 8건(새 테스트: `test_logo_saves_motif_once_and_activates_server_chosen_slot` — 타인 403, 두 번 호출에 `user_motifs` 1행, worker payload `motif_slot` 2/1, 잔액·`token_works` 불변, 진행 중 409), lint·하네스·타입체크·ruff·pyright·architecture:check 통과. `grep "pages/design/index\|design-canvas\|motif-panel\|prompt-bar\|use-motif-search" apps/store/src` 0건.
- 로컬 api(curl): 단건 `preview_svg`가 psql의 포인터 런 `design->>'svg'`와 같다. `/logo` 200 뒤 `current_motifs`가 올린 로고 하나, 잔액 23 그대로. 이어서 `/color`로 다른 프리셋 적용 뒤에도 `current_motifs`와 SVG에 로고가 남는다(항목 4의 "색 다시 고르기" 확인).
- 브라우저(통합 브라우저, 로그인 상태): `/design` 템플릿 목록(행 6개), `/design/sessions/<id>`는 404 페이지, 색·로고 페이지가 세션 `preview_svg`로 그려지고 로고 페이지 미리보기에 방금 넣은 로고가 보인다. `/custom-order` 페이지 정상.
- 하지 않은 것: 실사화(유료, 잔액 23 < 비용)와 그에 따른 결과 페이지 새로고침 복원의 실데이터 확인. 코드 경로는 `result.test.tsx`로만 덮었다.
- 무관한 기존 실패: `features/my-page`의 `pending-verification`·`phone-verify-modal` 테스트 7건이 HEAD에서도 같은 이유(`sessionStorage.clear` undefined)로 실패한다.

## 2026-10-14 (3차) — 템플릿 데이터를 시드 코드로 (플랜 항목 1, 플랜 종료)

플랜 `design-template-first.md`의 마지막 항목을 실행하고 플랜을 지웠다. 사용자 결정(2026-10-14): **템플릿은 DB로 관리하지 않는다** — 정본은 `apps/worker/scripts/seed_design_examples.py`의 `CuratedExample`, DB 컬럼은 store로 전달하는 자리. admin 입력 화면은 만들지 않는다. **실 색 표는 플랜에서 뺐다** — 지금 임시 표로 동작하고, 실제 제작이 붙을 때 시드의 `YARN`·`PRESETS`만 바꾸면 된다.

### 한 것

- **db**: Alembic `7c2e9a4f1b63` — `design_examples`에 `category`(필터 칩 라벨)·`point`(`none|top|bottom`, CHECK)·`logo_slot`(1|2, CHECK)·`photo_full_url`·`photo_detail_url`, `design_sessions.example_id`(SET NULL, `use_alter`로 세션→예시→run→세션 FK 순환을 끊음). `db/README.md`에 한 줄.
- **시드**: `CuratedExample`에 위 값을 두고 upsert. 6종 분류는 스트라이프 2·격자·그림 2·도트, 포인트는 와이드 사선(top)·가드 밴드 앵커(bottom), 로고 슬롯은 모티프 템플릿 1(듀오는 2). 사진 URL은 전부 비워 둠(사용자가 준비).
- **api**: `GET /design/examples`(·admin 조회)에 다섯 값과 `logo_preview_svg`(로고 슬롯 모티프 미리보기, `current_motifs[].preview_svg`와 같은 형식, 슬롯 모티프는 한 번에 IN 조회). 세션 응답에 `example_id`, from-example가 채움. `place_design_logo` 슬롯 규칙은 템플릿 `logo_slot` 우선, 없으면 레이어 수 규칙. admin 등록·수정 본문은 그대로. `domains.md` 갱신, `pnpm codegen`.
- **store**: `template-shots.tsx`의 `?point=` 스위치·`DEMO_EMBLEM`·`usePreviewPoint` 삭제. 대신 `TemplateLayout`{point, emblemSvg, photos} — 템플릿 페이지는 `templateLayout(example)`, 색·로고 페이지는 `sessionLayout(session, example)`(세션 `example_id`로 공개 템플릿 목록에서 찾고, 엠블럼은 로고 슬롯에 지금 들어 있는 모티프 = 로고를 넣으면 로고). 엠블럼은 미리보기 SVG에서 `<symbol>`만 꺼내 TieCanvas 계약에 맞춘다(`emblemSymbol`). 사진 URL이 있으면 전체 샷·무늬 확대 자리에 `ImageFrame`, 없으면 결정론 샷. `template-picker.tsx`의 키워드 `FILTERS`는 데이터의 `category` 집합으로.
- (같은 날 앞서) 모바일에서 색·로고 페이지의 선택 영역을 이미지보다 위에 — `ContentLayout` `sidebarFirst`, 색 고르기 칩 아래 2:1 무늬 미리보기(`TemplatePatternShot`). 로고 페이지 액션바는 이전·생성 한 줄, 업로드 썸네일은 원본 유지 + 통과/미통과만.

### 확인한 것

- `alembic upgrade head` / `downgrade -1` / `upgrade head` 왕복, `alembic check` 드리프트 없음. 첫 시도에서 `sa.String()`이 모델의 Text와 달라 드리프트가 잡혀 Text로 고침.
- api `test_design_examples.py` 전체 + `test_design.py -k logo_saves` 8건(새 테스트: 템플릿 데이터·`logo_preview_svg`·슬롯 비면 null, 세션 `example_id`, 템플릿 `logo_slot`이 레이어 수 규칙보다 우선). store 디자인 테스트 11파일 50건(새 테스트: 분류 칩이 데이터 `category`, 하단 포인트에 아래 끝 확대 + 전체 샷 자리에 사진). admin 디자인 예시 테스트 5건. lint·하네스·store/admin 타입체크·ruff·pyright·architecture:check 통과. `usePreviewPoint|DEMO_EMBLEM|?point=` 참조 0건.
- 로컬: 시드 재실행 뒤 `GET /design/examples`가 분류·포인트·슬롯·슬롯 미리보기를 준다. 브라우저(통합 브라우저): `/design` 칩이 전체·스트라이프·격자·그림·도트, 와이드 사선은 매듭 확대, 가드 밴드 앵커는 아래 끝 확대 + 앵커 엠블럼. 상세 → 시작 → 색 페이지도 같은 구성(세션 `example_id` 경로).
- 하지 않은 것: 실사 사진이 들어간 모습(URL이 아직 없음 — `ImageFrame` 경로는 테스트로만), 실사화(유료).

### 남긴 것

- 실 색 표: 시드 `YARN`·`PRESETS` 교체 한 번. 별도 플랜 없음.
- 포인트 로고(비반복 배치)는 엔진에 없다 — `point`·엠블럼은 미리보기 구성일 뿐이다. 필요해지면 별도 플랜.

## 2026-10-14 (4차) — 템플릿 상세 페이지 제거

사용자 결정: 템플릿을 고르면 상세를 거치지 않고 바로 색 선택으로 간다. 위 1차의 흐름·결정 중 `/design/templates/:id` 상세 단계는 이걸로 대체된다.

- 흐름: `/design`(목록) → `/design/sessions/:id/color` → logo → result.
- `template-picker.tsx`의 행은 링크가 아니라 버튼, 누르면 `templates.tsx`가 세션을 만들고(무료) 색 선택으로 간다. 세션을 여는 동안 목록 전체를 막는다.
- 비로그인으로 누르면 로그인 복귀 대상이 `/design` + `state.startTemplate` — 돌아오자마자 그 템플릿으로 이어서 시작한다(state를 먼저 지워 뒤로 가기로 세션이 또 생기지 않게).
- `pages/design/template.tsx`·테스트·라우트 삭제. 옛 `/design/templates/:id` 주소는 404.

## 2026-10-15 (5차) — 샘플 템플릿 정리와 목록 샷 개편

- 시드: 샘플 6종(gallery-v1 기반)을 지우고 템플릿 전용 플랜 "핀 스트라이프와 세 고리"만 남김. 시드가 `CURATED`에 없는 예시 행을 지운다(run 로그는 남김, 세션 `example_id`는 SET NULL). 템플릿은 계속 추가 예정.
- 목록 샷(사용자가 시안 10종 중 9안 선택): 좌 = 칸을 꽉 채운 전체 샷, 우 = 넥타이 크롭 대신 평평한 원단(타일 2배, `FABRIC_ZOOM`). 컷마다 별도 카드, 묶음 6:5. 포인트 있으면 우측 = 포인트 확대 + 원단. 위 1차의 "공통 전체 샷 + 무늬 확대" 규칙을 대체한다(색 고르기 화면의 상세 샷은 그대로).
- 모바일(lg 미만): 나란히 두지 않고 4:5 한 칸에서 컷을 3초마다 크로스페이드(`CyclingShots`). 화면 가운데 띠에 든 행만 돌고, 동작 줄이기면 전체 샷에 멈춘다.

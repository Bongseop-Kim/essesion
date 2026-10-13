# 디자인 "템플릿 → 색 → 로고 → 생성 → 결과" 흐름 마무리 — 템플릿 컬럼과 실 색 표

2026-10-13 기준으로 store 고객 흐름은 **템플릿 선택 → 색 선택 → 로고 올리기 → 생성(실사화) → 결과(주문 / 템플릿·색·로고 다시 고르기)** 다섯 페이지로 돌아가고, 옛 캔버스 삭제와 API 정리(세션 단건 SVG, 로고 한 번에 넣기, 결과 복원)는 끝났다(실행 기록: `docs/reviews/design-template-first-flow-2026-10-13.md`). 이 플랜은 남은 일 — 템플릿 데이터를 정식으로 갖추는 것 — 을 지시한다. 고객 흐름을 다시 쓰지 않는다.

## 지금 상태 (이 문서만 들고 시작하는 사람을 위해)

```
/design                         템플릿 목록(공개)           apps/store/src/pages/design/templates.tsx
/design/templates/:id           템플릿 상세, "이 템플릿으로 시작"  pages/design/template.tsx   → POST /design/sessions/from-example (무료)
/design/sessions/:id/color      색 프리셋 선택 → 다음        pages/design/color.tsx      → POST /design/sessions/{id}/color (무료)
/design/sessions/:id/logo       로고 올리기 → 생성           pages/design/logo.tsx       → POST /design/sessions/{id}/logo (무료) → finalize (유료)
/design/sessions/:id/result     실사 2장 + 주문/다시 고르기   pages/design/result.tsx     → /custom-order (route state designJobs)
```

- 공용 조각: `features/design/ui/template-picker.tsx`(목록·필터·행), `template-shots.tsx`(샷 구성·색 칩·임시 포인트 스위치·임시 엠블럼), `model/use-steps.ts`(`useApplyColorway`·`usePlaceLogo`), `model/use-example-start.ts`, `model/use-design-output.ts`(`useFinalizeFlow`), `model/queries.ts`(세션 단건·완성본), `api/attachments.ts`(사진 업로드·SVG 읽기), `api/context-tools.ts`(`previewPhotoMotif`). 현재 디자인 SVG는 세션 단건 `preview_svg`다.
- 색 프리셋은 새 컬럼 없이 엔진 colorway다. `apps/worker/scripts/seed_design_examples.py`의 `YARN`·`PRESETS`·`_rough_colorways`가 템플릿마다 5개를 intent.colorways에 넣는다(임시 실 색). 시드를 다시 돌리면 현재 엔진으로 템플릿을 다시 그린다.
- 테스트: `apps/store/src/pages/design/*.test.tsx` 5파일, api `apps/api/tests/test_design.py`의 `test_colorway_*` 2건·`test_logo_*` 1건.
- 로컬 실행: 루트 `AGENTS.md` 부트스트랩 순서대로. **worker(8001)가 꺼져 있으면 색 적용·로고 넣기가 `upstream_error`로 실패한다** — `lsof -i :8001`로 먼저 확인. 테스트 계정은 `apps/api/scripts/seed.py`의 `customer@local`, `/login` 제목을 5번 누르면 id/pw 폼이 열린다(`pages/auth/login.tsx` `STAFF_REVEAL_CLICKS`). 실사화는 유료라 `OPENAI_API_KEY`(`.env`, 읽지 말 것)와 토큰이 있어야 한다. 토큰은 psql로 넣는다: `insert into design_tokens(id,user_id,amount,type,token_class,description) select gen_random_uuid(), id, 1000, 'grant', 'free', '로컬 검증' from users where email='customer@local'`.
- 브라우저 확인은 통합 브라우저(CDP)나 headless Chrome으로 한다. Aside는 2026-10-12부터 쓰지 않는다.

## 왜 필요한가

- **템플릿 데이터가 임시다.** 포인트 위치는 `?point=top|bottom` 쿼리 스위치(`template-shots.tsx` `usePreviewPoint`), 분류 필터는 이름 키워드(`template-picker.tsx` `FILTERS`), 포인트 로고 미리보기는 하드코딩 방패(`template-shots.tsx` `DEMO_EMBLEM`), 색 프리셋은 시드의 임시 실 색 표다. 사용자 결정(2026-10-12): 실 색은 "일단 대충", 로고는 올린 파일 그대로(엔진 recolor 없음), 템플릿 사진은 사용자가 뒤에 실사로 교체.
- **전면 재작성은 기각했다** (아래 "기각한 대안"). 결정론 엔진·colorway·로고 벡터화·실사화·토큰 장부가 서비스의 실체이고 `docs/reviews/design-*`·`finalize-*`(2026-07~09)가 그 검증 기록이다. AI 생성·채팅 API는 admin 템플릿 제작 도구로 그대로 쓴다(admin에 `pages/authoring/`·`pages/generation/`이 이미 있다). 옛 캔버스 삭제와 API 정리는 2026-10-13에 끝났다(리뷰 2차).

## 범위 밖

- **AI 생성·채팅·RAG 백엔드 삭제.** 고객 진입점만 지운다. `POST /design/generate`·`/design/ideas`·`motifs/search`·`motifs/generate`·`steps/activate`·`turns`는 admin 저작 도구와 운영 조사에 남긴다. 고객 화면에서 사라진 과금 경로(모티프 생성·편집)의 단가 정리는 `token-pricing-recalibration.md`에서 다룬다.
- **포인트 로고(비반복 배치).** 엔진은 타일 반복만 그리므로 넥타이 끝·매듭 한 곳에 로고를 놓는 개념이 intent·실사화·정본 타일에 없다. 지금 로고는 무늬처럼 반복된다. 별도 플랜으로 뺀다 — 이 플랜의 템플릿 컬럼(항목 1)은 그 플랜이 쓸 자리만 비워 둔다.
- **템플릿별 실사 사진 제작.** 사용자가 준비한다. 이 플랜은 사진이 들어갈 컬럼과 자리만 만든다.
- **고객용 조정 UI**(시안 여러 장, 슬라이더, 임의 색, 로고 크기·자유 배치)는 이전 판과 같이 두지 않는다.

## 실행 조건

- 항목 1(템플릿 컬럼)은 바로 실행한다. Alembic 경유만(대원칙). 항목 2(실 색 표)는 **사람이 실 색 표를 주기 전에는 실행하지 않고 기다린다** — 시드의 임시 표를 그대로 둔다.
- api 스펙을 바꾸는 항목(1)은 `docs/api-spec/domains.md`를 먼저 고치고 `pnpm codegen` 생성물을 같은 변경에 넣는다(CI codegen-drift).
- UI 작업 전 `packages/shared/AGENTS.md`를 읽는다. 커밋·푸시는 사람이 한다.

## 절차

효과 ÷ 난이도 순. 각 항목은 독립적으로 실행·검증 가능하다.

1. **템플릿 컬럼 (db · admin · store)**
   - `design_examples`에 Alembic으로 더한다: `category`(용도·스타일 분류, text), `point`(`none|top|bottom`, 기본 `none`), `logo_slot`(1|2, null 허용), `photo_full_url`·`photo_detail_url`(사용자가 준비할 실사 사진 자리, null 허용). 설계 의도는 `db/README.md`에 한 줄.
   - admin `pages/design-examples/new.tsx`와 목록 편집(`list.tsx`)에서 입력받는다. `GET /design/examples`·`GET/POST/PATCH /admin/design/examples` 응답·본문에 노출하고 `domains.md` 갱신, `pnpm codegen`.
   - store: `template-picker.tsx`의 키워드 `FILTERS`를 `category` 값으로, `template-shots.tsx`의 `usePreviewPoint`(`?point=`)를 `example.point`로, `DEMO_EMBLEM`을 "로고 슬롯 모티프의 preview_svg"(세션 단건 `current_motifs[].preview_svg`와 같은 형식)로 바꾼다. api `place_design_logo`(`router.py`)의 슬롯 규칙(레이어 둘이면 2)을 `logo_slot` 우선으로 바꾼다. 사진 URL이 있으면 `TemplateShots`·`TemplateDetailShots`의 해당 자리에 `ImageFrame`으로 사진을 넣고, 없으면 지금의 결정론 샷(`TieCanvas` `focus`·`emblem`)을 그린다.
   - 근거: 사용자 정의 사진 규칙(2026-10-12) — 공통 전체 샷 + 무늬 확대, 포인트 상단 = 매듭 확대 추가, 하단 = 끝 확대 추가, 올패턴 = 추가 없음. 임시 스위치 셋을 데이터로 바꾸는 항목이다.

2. **실 색 표 교체 (worker 시드 · admin)** — 사람이 실 색 표를 준 뒤에만
   - `seed_design_examples.py`의 `YARN`·`PRESETS`를 실 색 표(이름·hex)로 바꾸고, 프리셋 생성 규칙(`_rough_colorways`: 바탕 + 스트라이프 밴드 슬롯만 치환, 모티프 고유 색 유지)은 유지한다.
   - admin에서 템플릿별 colorway를 보고 고칠 수 있게 한다(intent `colorways` 편집 → 같은 run 재등록). 새 컬럼은 두지 않는다 — 프리셋은 엔진 colorway(`docs/api-spec/worker-engine.md` colorways 1..32, `default` 필수, 모든 슬롯 매핑 필수)로 충분하다.
   - 근거: 색은 템플릿별 검증된 조합에서만 고른다(이전 판 결정). 지금 표는 "대충"이다.

3. **실행 기록**
   - 항목 1·2가 끝나면 `docs/reviews/design-template-first-flow-2026-10-13.md`에 결과를 덧붙이고 이 문서를 삭제한다(플랜 하네스).

## 검증

- 항목 1: `uv run alembic -c db/alembic.ini upgrade head` / `downgrade -1` 왕복. admin에서 포인트·슬롯·사진 URL 입력 → store 목록에서 포인트 위치별 샷 구성이 바뀐다. `?point=`·`DEMO_EMBLEM`·키워드 `FILTERS` 참조 0건.
- 전체: 템플릿 → 색 → 로고 → 생성 → 결과 → 주문 진입까지 채팅 없이 끝난다. 실사화는 유료라 토큰을 넣은 계정으로 1회만 돌린다(위 psql).

## 되돌리는 법 / 상향 신호

- 항목 1은 컬럼 추가(null 허용·기본값)라 downgrade로 돌아온다. store의 임시 스위치 삭제 커밋은 따로 둔다.
- 신호: 배포 후 2주간 "디자인 진입 → 실사화" 전환율이 옛 캔버스 시절보다 낮으면 먼저 템플릿 수와 색 프리셋 폭(항목 1·2)을 의심한다. 코드 구조를 의심하지 않는다.

## 실패 모드

템플릿·프리셋이 적어 고를 게 없는 서비스가 되는 것이 이 플랜의 실패 모드다. 그건 코드가 아니라 데이터(항목 1·2)의 문제다. 임시 스위치(`?point=`·`DEMO_EMBLEM`·키워드 필터)를 컬럼 없이 더 키우지 않는다.

## 기각한 대안

- **처음부터 다시 만들기(2026-10-13 제안)**: 고객 흐름 다섯 페이지는 이미 백지에서 만든 것이라 다시 써도 같다. 백엔드는 결정론 엔진·colorway·로고 벡터화·실사화·토큰 장부가 실체이고 admin이 AI 생성을 그대로 쓴다 — 다시 쓰면 7~9월 검증을 다시 한다. 지우고 API 둘을 더하는 쪽이 같은 결과를 훨씬 싸게 냈다(2026-10-13 완료).
- **옛 캔버스를 "고급 편집"으로 남기기**: 사용자가 2026-10-13에 기각. 두 흐름을 유지하는 비용이 그 가치보다 크다.
- **로고를 세션이 아니라 템플릿 상세에서 먼저 받기(세션 없이 미리보기)**: 세션 없이는 무료 재렌더를 돌릴 곳이 없고, 색 선택이 먼저라는 흐름 결정(2026-10-13)과 어긋난다.
- **색 프리셋 전용 컬럼·테이블**: 엔진 colorway가 이미 같은 구조(id·name·slot→hex)다. 데이터가 두 곳에 생긴다.
- **실사화 뒤 서버가 finalize 턴을 기록하기**: 읽는 곳이 없다. 턴 이력 자체가 옛 캔버스의 장치다.
- **세션 단건에 `current_svg` 필드 추가**: 목록의 `preview_svg`가 같은 뜻이라 단건에도 그 필드를 채웠다(2026-10-13).
- **시안 여러 장 / 실 색 자유 조합 / AI 로고 합성·다듬기 / 카탈로그 피커·RAG 유지**: 이전 판에서 기각, 사유 그대로. 고객 대부분이 로고를 올린다는 전제가 틀린 것으로 확인되면 피커 재론.

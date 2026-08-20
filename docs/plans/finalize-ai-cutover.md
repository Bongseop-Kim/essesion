# AI 실사화 finalize — 컷오버·화면 흐름

캡슐은 구현·품질 검증 완료 — `docs/reviews/finalize-ai-fabric-2026-08-20.md`.
이 플랜은 그 뒤의 일괄 전환이다. 산출물 계약이 "seamless 타일 1장" → "실사 2장(넥타이·원단) +
정본 타일 1장"으로 바뀌는 데 따른 api 응답·store 화면·과금·명세의 일괄 전환이다.

## 왜 필요한가

- 2026-08-19 개편(`docs/reviews/finalize-sync-token-pricing-2026-08-19.md` §3)이
  실사화 PNG를 seamless 타일 전제로 `TieCanvas`에 직배선했다
  (`apps/store/src/features/design/ui/finalized-list-modal.tsx:136-138`).
  AI 산출물은 타일이 아니므로 이 배선은 컷오버와 함께 끊어야 한다.
- finalize 1회 = 외부 이미지 편집 2회가 되므로 단가·타임아웃 전제가 바뀐다.
  weave 피커는 이미 있으므로(`finalize-dialog.tsx`) 신설이 아니라 그 선택값의
  소비처가 절차 합성 → AI 프롬프트로 옮겨가는 것이다.

## 범위 밖 (non-goals)

- 캡슐 내부(프롬프트·참고 이미지·어댑터) 품질 — 완료(리뷰 문서). 스케일
  드리프트 보강 등 프롬프트 개선은 이 플랜의 범위 밖.
- 착장 샷·갤러리(design_examples) 개편, 과거 finalize 행의 이미지 재생성
  (기존 `result.object_key` 행은 원단 이미지로 간주해 표시 호환만 유지).

## 실행 조건

- 캡슐 품질 게이트는 2026-08-20 통과(리뷰 문서 참조) — 충족됨.
- 지연 실측은 리뷰에 기록됨(조합당 ~45s, quality=medium). **단가는 미확정** —
  usage 로그가 캘리브레이션에서 미포집됐으므로 3항 실행 시 공식 요금표 +
  운영 usage 로그로 확정한다. 기억·추정 단가로 과금을 정하는 것이 이 플랜의
  대표적 오류원이다.
- 캡슐 변경(worker)은 이미 작업 트리에 있다 — **이 플랜과 같은 릴리스로만
  배포한다**(리뷰 "배포 주의" 참조).

## 화면 흐름 (store)

목업(4단계 전체, 실측 토큰으로 재현 + 레드라인 주석):
https://claude.ai/code/artifact/51999f7c-6cbe-4bc3-9d0e-404bc82a766c

현행 화면 대부분이 finalize 산출물을 이미 "이미지"로 취급하고 있어, seamless
타일을 전제하는 곳은 완성본 카드 하나다. 다만 그 카드가 사실상 같은 화면인 두
컴포넌트에 중복 구현돼 있으므로, **먼저 합치고 한 번만 고친다.**

- **디자인 화면**(`apps/store/src/pages/design/index.tsx`) — 변경 없음. 툴레일
  "실사화"(`.../ui/tool-rail.tsx:48-66`)가 다이얼로그를 연다. 캔버스의 넥타이/타일
  ViewToggle은 저작 단계 전용으로 결정론 렌더를 계속 쓴다.
- **실사화 다이얼로그**(`.../ui/finalize-dialog.tsx`) — 「제작 방식」·「원단 짜임」
  SelectBox, 푸터 "실사화 만들기 · N토큰", 제출 버튼 `loading`(ProgressCircle),
  성공 250ms 후 완성본 모달 오픈이 **모두 이미 구현돼 있다**. 변경은 본문
  마지막 caption 한 줄뿐: "실사화 이미지는 300 DPI로 생성돼요" → "실제 제작물은
  장인이 직조 방식을 최종 결정하며 이미지와 다를 수 있어요."
  **참고 이미지 미리보기를 넣지 않는다** — 사용자는 캔버스에서 디자인을 충분히
  보고 결정한 뒤 이 모달에 들어오고, 모달의 세로 공간도 이미 빠듯하다.
  짜임 카드에 질감 스와치도 넣지 않는다(현행 텍스트 카드 룩 유지 —
  `packages/shared/AGENTS.md` 규칙 0).
- **완성본 목록 = 하나의 공통 컴포넌트** — 완성본 모달
  (`.../ui/finalized-list-modal.tsx`)과 DesignPicker
  (`.../ui/design-picker.tsx`)는 같은 목록(`kind=finalize, status=succeeded`)을
  같은 `Grid columns={2} gap="x3"`로 보여주는 사실상 같은 화면이고,
  `ContentPlaceholder`·`formatDateTime`·"미리보기 없음" fallback·Skeleton 그리드가
  모두 중복이다. **목록 본문을 `FinalizedGallery` 하나로 합치고 카드 액션만
  variant로 가른다**(절차 5항). 이미지 배선·토글·페이지네이션·빈 상태를 한 곳에서만
  고치게 되므로 컷오버 작업량이 오히려 줄고, 두 화면이 갈라질 여지도 없어진다.
  - 카드 이미지: `TieCanvas` → `ImageFrame ratio=1 borderRadius="r4" fit="cover"`.
    AI 출력은 seamless가 아니라 타일 반복 배선이 불가능하다 — 이것이 이 컷오버의
    유일한 구조적 강제 사항이다.
  - `ViewToggle`: 공통 컴포넌트가 소유하므로 **두 화면 모두** 갖게 된다. 의미는
    「넥타이 / 타일」(같은 타일의 두 렌더) → 「넥타이 / 원단」(서로 다른 두 실사
    이미지, `tie_url` / `fabric_url`). 토글 1개가 목록 전체에 동시 적용되는
    현행 동작 유지.
  - 고지 문구는 완성본 모달 쪽 그리드 아래 caption으로 상주. 정본 타일은 고객
    화면에 노출하지 않는다(디자이너 인수물).
- **주문제작 — 내 디자인**(custom-order "6. 추가 정보"의
  `AttachmentDisplayField` pickerSlot) — 트리거 `FieldButton`과 Modal 크롬
  (제목 "내 AI 디자인", 푸터 "닫기")은 그대로 두고 본문만 `FinalizedGallery`로
  교체한다. 선택 표시(2px brand 테두리·brand-weak 배경·우상단 체크 배지)도 유지.
  선택 결과는 첨부 아이템 **1개**(`design:{job_id}`,
  `custom-order/index.tsx:161-172`) — 7항의 2파일 복사는 서버 측 인수물 계약이며
  화면에 개수·경로를 드러내지 않는다. 레거시 행(`object_key`만 있는 과거
  finalize)은 해당 이미지를 그대로 썸네일로.

## 절차

1. **api 응답 스키마** — `_generation_job_out`
   (`apps/api/src/api/domains/design/router.py:2153-2166`)이 `result`의
   `tie_object_key`/`fabric_object_key`/`tile_object_key`를 각각 공개 URL로 변환해
   `tie_url`/`fabric_url`/`tile_url`로 노출. 레거시 `object_key`는 `result_url`로
   유지(표시 호환). `pnpm codegen` 생성물 같은 커밋(CI drift 검사).
2. **finalize 요청** — 형태 불변(피커가 이미 weave를 보낸다). api 측 weave 검증
   (`router.py:486` `KNOWN_WEAVES`)이 피커 옵션의 단일 정본임을 주석이 아닌
   명세(4항)에 적는다. 피커 옵션 추가·축소는 이 상수와 다이얼로그의 옵션 목록,
   그리고 프롬프트 매핑 표를 함께 갱신해야 하며 어느 하나만 바꾸면 무효 조합이
   된다 — 이 3곳 결속을 명세에 명시한다.
3. **과금·타임아웃** — 실측 단가(편집 2회 + Cloud Run)로 `design_finalize_cost`
   (`apps/api/src/api/config_defaults.py:24`)를 재산정한다. **현행 값은 코드와
   운영 DB(`admin_settings`) 양쪽을 직접 확인할 것** — 기본값과 실제 운영값이
   다를 수 있다. `money.md` §6 표 갱신,
   `docs/plans/token-pricing-recalibration.md`와 겹치는 실사화 행은 그쪽도 함께
   갱신하고 겹침을 기록. 지연: 편집 2회 순차·병렬 여부에 따라 p95 확인,
   api `worker_timeout_seconds`·Cloud Run worker-finalize timeout(180s,
   `infra/`)이 수용하는지 확인 후 필요 시 상향.
4. **명세 갱신 (대원칙)** —
   `docs/api-spec/worker-pipeline.md`: §2를 "결정론 렌더(타일·넥타이, 결정론
   계약 유지) → AI 실사화 편집 2회" 2단 구조로 재서술, 결정론 계약(:88)은 결정론
   렌더 단계 한정으로 축소, §4 finalize 계약에 삼중 산출물, §5 과금.
   `docs/api-spec/domains.md:102` finalize 행 갱신.
   **역할 명시 문구를 양쪽에 추가**: "정본은 intent JSON + 결정론 타일. AI 실사
   이미지는 시각적 설득·참고물. 직조 실현 가능성 판단은 원단 디자이너(사람)의
   영역이며 시스템은 이를 자동 판정하지 않는다."
5. **완성본 목록 병합 (선행, 동작 변경 최소)** — `apps/store/src/features/design/ui/`에
   `finalized-gallery.tsx`를 만들고 두 모달의 본문을 옮긴다. 순수 리팩터로
   먼저 커밋하고 6항의 이미지 배선을 그 위에 올린다 — 순서를 뒤집으면 같은
   변경을 두 파일에 두 번 하게 된다.
   - `FinalizedGallery`가 소유: `ViewToggle`과 `previewMode` 상태, `Grid columns={2}
     gap="x3"`, 카드 마크업, "미리보기 없음" fallback, Skeleton 그리드, 로딩·에러·
     빈 상태 `ContentPlaceholder`, 「더 보기」/`Callout` 페이지네이션.
   - 카드 액션만 variant로 가른다: `{ variant: "browse", onOrder, onDelete }` /
     `{ variant: "select", selectedId, onSelect }`. render-prop 슬롯을 만들지 말 것
     — 구현이 두 개뿐이라 판별 유니온이 더 짧고, 카드 마크업이 공통 컴포넌트
     안에 남아 두 화면이 갈라지지 않는다. 셸 요소만 `select`에서 `button`,
     `browse`에서 `div`가 된다(browse 카드 안에 버튼이 있어 중첩 불가).
   - 호출측은 Modal 크롬만 남는다: `FinalizedListModal`(제목 "내 완성본" +
     고지 caption), `DesignPicker`(`FieldButton` 트리거 + 제목 "내 AI 디자인" +
     푸터 "닫기").
   - **병합 과정에서 정리되는 불일치 3건**: ① DesignPicker의 `limit: 100` 단일
     쿼리를 `finalizedJobsInfiniteQueryOptions`(`model/queries.ts:52`)로 교체 —
     완성본이 100개를 넘으면 피커가 조용히 잘리는 현행 버그가 사라지고 디자인
     페이지와 쿼리 캐시를 공유한다. ② 날짜 포맷을 보관함용 긴 형식으로 통일
     (피커 `FieldButton`의 짧은 형식은 그대로 둔다). ③ Skeleton 라운드 r4/r2 통일.
   - 그 외 store 변경은 실사화 다이얼로그 caption 한 줄과 7항의 첨부 복사뿐이다.
6. **이미지 배선 (병합 후)** — `FinalizedGallery` 카드의 `TieCanvas` →
   `ImageFrame`, 이미지 소스를 `previewMode`에 따라 `tie_url` / `fabric_url`로.
   레거시 행은 `result_url`로 폴백. **한 파일에서 끝난다.**
   비율 주의: 넥타이 실사의 원본은 베이스 사진 비율 **2:3**(1024×1536)이다 —
   `ratio=1` + `fit="cover"`는 매듭이나 끝단을 잘라먹는다. 넥타이 뷰는
   `ratio=1` + `fit="contain"` + `bg.neutral-weak` 바탕(현행 TieCanvas의 회색
   패널 룩과 동일)으로, 원단 뷰는 `fit="cover"`로 배선한다.
   라벨 주의: "넥타이/타일"이 `view-toggle.tsx:21-22`에 하드코딩이고 디자인
   캔버스와 공유된다. 캔버스는 결정론 타일을 계속 보여주므로 "타일"이 맞고,
   갤러리만 "원단"이어야 한다 — `ViewToggle`에 두 번째 세그먼트 라벨 prop
   (기본값 "타일")을 추가해 갤러리에서 "원단"을 넘긴다. `DesignPreviewMode`
   ("tie" | "repeat") 값 자체는 shared 소유이므로 바꾸지 않는다.
7. **주문 인수물** — order-reference 복사(`router.py:2065-2115`)가 현재 이미지
   1장만 `uploads/`로 복사 → **넥타이 실사 + 정본 타일 2장 복사**로 확장.
   근거: 주문을 받는 디자이너의 인수물은 타일이고, 실사는 고객 기대치의 증빙.
   **UI 첨부 아이템 수는 1개로 유지** — 파일 개수·경로는 사용자에게 노출하지
   않는 내부 계약이다.
8. **테스트** — api: `test_design.py` finalize 과금·환불·스키마 스위트 갱신
   (testcontainers 유지). store: 완성본 모달·피커 테스트를 `FinalizedGallery`
   테스트 한 세트 + variant별 얇은 테스트로 재편(중복 2세트가 1.5세트로 줄어야
   병합이 값을 한 것이다). worker 골든은 캡슐 플랜에서 완료.
9. **제거 항목 없음을 기록** — 절차적 합성 경로(fabric.py)는 참고 이미지·정본
   타일 생성기로 존속한다. "기존 finalize 제거" 작업은 이 구조 선택으로
   소멸했다 — 컷오버 완료 리뷰에 이 사실을 명시한다.

## 검증

- **병합 단독 검증(절차 5항 커밋 시점)**: 완성본 모달과 피커의 화면이 이전과
  동일하게 동작하는지 확인 — 목록·더 보기·선택·주문제작·삭제·빈 상태. 이 시점에
  달라지는 것은 피커의 무한스크롤 전환, 피커의 토글 등장, 날짜 포맷 통일뿐이다.
  `git diff --stat`에서 **총 라인 수가 줄어야** 병합이 값을 한 것이다.
- 로컬 E2E(체크포인트 1회, `e2e-test-harness` 기준): store에서 직조 선택 →
  실사화 → 완성본 모달에 넥타이/원단 토글 표시 → 주문제작 피커에서도 같은 토글
  동작 확인 → 첨부 아이템 1개 확인.
- `docker compose exec -T db psql -U essesion -d essesion -c "select result from
  generation_jobs where kind='finalize' order by created_at desc limit 1"` —
  세 object_key 존재.
- 주문 첨부: `uploads/`에 넥타이 실사 + 타일 2파일 복사 확인.
- `pnpm build && pnpm typecheck && pnpm test`, `pnpm architecture:check`(명세
  링크), api 도메인 테스트.

## 되돌리는 법 / 상향 신호

- 캡슐 경계 덕에 worker finalize 라우트에서 AI 편집 단계만 우회(결정론 타일을
  `object_key`로 직반환)하면 1커밋으로 구형 동작 복귀 — 이 우회 경로가 가능하도록
  캡슐 함수 시그니처를 유지한다. store는 레거시 `result_url` 호환 표시로 동작.
- 상향 신호: 업스트림 콘텐츠 거절율 상승, finalize p95 > 60s, 편집 단가 급변,
  "이미지와 실물이 다르다" CS 유입.

## 실패 모드

캡슐 품질 검증 전에 컷오버를 실행하는 것 — 화면·과금이 먼저 바뀌면 저품질
AI 이미지가 그대로 고객 설득물이 된다.

## 기각한 대안

- **병합을 컷오버 뒤로 미루기**: 한 번 이렇게 계획했다가 뒤집었다(2026-08-20).
  "리팩터와 산출물 교체를 섞으면 실패 원인을 가를 수 없다"는 논거는, 같은 변경을
  두 파일에 두 번 하는 비용과 그 사이 두 화면이 갈라질 위험을 감당하지 못한다.
  절차 5항을 순수 리팩터로 **먼저 커밋**해 검증 경계를 세우면 원인 분리도 유지된다.
- **`FinalizedGallery`에 render-prop 카드 슬롯 두기**: 구현이 browse·select 둘뿐이라
  판별 유니온이 더 짧고, 카드 마크업이 공통 컴포넌트 안에 남아야 두 화면이 다시
  갈라지지 않는다. 재론 조건: 세 번째 사용처가 생기고 카드 구조가 실제로 달라질 때.
- **`FinalizedGallery`를 `packages/shared`에 두기**: api-client 타입에 의존하는
  앱 전용 조합이다. shared는 도메인 무지 상태를 유지한다(`packages/shared/AGENTS.md`).
- **DesignPicker에 토글을 넣지 않기**: 한 번 이렇게 판단했다가 뒤집었다. "식별만
  하면 되니 넥타이 한 장으로 충분"은 두 모달이 같은 화면이라는 사실 앞에서
  약한 논거다 — 이제 공통 컴포넌트가 토글을 소유하므로 저절로 해결된다.
- **finalize와 별도의 "프리뷰" 엔드포인트 병행**: 산출물 이원화로 UX·과금이
  복잡해진다. finalize 자체를 교체하는 편이 단순. 재론 조건: 실사화 없이 타일만
  뽑는 유료 수요가 확인될 때.
- **TieCanvas에 AI 원단 이미지를 타일로 공급**: AI 출력은 seamless가 아니라
  반복 시 이음새가 노출된다(현황 불가 판정, 2026-08-20).
- **과거 finalize 행 일괄 재생성**: 유료 재호출 비용 대비 효익 없음. 표시 호환만.

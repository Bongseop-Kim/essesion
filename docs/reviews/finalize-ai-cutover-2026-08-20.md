# AI 실사화 finalize 컷오버 실행 결과 (2026-08-20)

플랜 `docs/plans/finalize-ai-cutover.md`(제거됨) 실행 완료. 캡슐(worker) 구현·품질 검증은
`finalize-ai-fabric-2026-08-20.md`. 이 문서는 그 뒤의 api·store·명세 일괄 전환이다.

산출물 계약이 "seamless 타일 1장" → "실사 2장(넥타이·원단) + 정본 타일 1장"으로 바뀌었다.

## 구현

- **api 응답 스키마** (`domains/design/router.py`): `_run_finalize`가 worker 응답의 네 키
  (`tie/fabric/tile_object_key` + 레거시 `object_key`)를 화이트리스트로 `GenerationJob.result`에
  보관하고, `GenerationJobOut`이 `tie_url`/`fabric_url`/`tile_url`(+레거시 `result_url`)로 공개한다.
  `object_key`만 오는 응답도 그대로 성립한다 — **롤백(AI 편집 단계 우회) 시 스키마 변경 불필요**.
- **잡 삭제 정리**: 실사 2장(잡마다 고유)만 지운다. **정본 타일은 지우지 않는다** — 결정론 렌더라
  같은 디자인의 다른 finalize 잡과 콘텐츠 주소를 공유하고, 지우면 남의 잡 이미지가 사라진다.
- **주문 인수물** (`create_design_order_reference`): 넥타이 실사 + 정본 타일 **2장**을 `uploads/`로
  복사한다(원단 실사는 고객 설득용이라 싣지 않는다). 응답이 `{object_key, upload_id}` 단수에서
  `{items: [...]}`로 바뀌었고, 실패 시 그 요청이 복사한 객체 전부를 정리한다.
  화면의 첨부 카드는 여전히 디자인 1개당 1개 — 파일 개수·경로는 내부 계약이다.
  `MAX_REFERENCE_IMAGES` 5 → 10: 서버 상한은 남용 방어용이고 UX 상한은 store의 `MAX_IMAGES`(5)다.
  올리지 않으면 "디자인 1개 + 파일 4개"가 refs 6개로 422가 됐다.
- **store 완성본 목록 병합** (`features/design/ui/finalized-gallery.tsx`): 완성본 모달과 주문제작
  디자인 피커의 목록 본문이 하나가 됐다. 갤러리가 `ViewToggle`·`previewMode`·그리드·카드 마크업·
  "미리보기 없음" 폴백·Skeleton·로딩/에러/빈 상태·「더 보기」를 소유하고, 카드 액션만 판별 유니온
  (`browse` / `select`)으로 갈린다. 셸 요소만 `select`=button / `browse`=div(안에 버튼이 있어 중첩 불가).
  호출측은 Modal 크롬만 남는다.
- **이미지 배선**: `TieCanvas` → `ImageFrame ratio=1 borderRadius="r4"`. 넥타이 뷰는 원본이 베이스
  사진 비율 2:3이라 `fit="contain"` + `bg-bg-neutral-weak`(cover면 매듭·끝단이 잘린다), 원단 뷰는
  `fit="cover"`. 레거시 행은 `result_url` 폴백. `ViewToggle`에 `repeatLabel` prop(기본 "타일")을 추가해
  갤러리만 "원단"을 넘긴다 — 디자인 캔버스는 결정론 타일을 계속 보여주므로 "타일"이 맞다.
  `DesignPreviewMode`("tie" | "repeat") 값 자체는 shared 소유라 건드리지 않았다.
- **병합으로 정리된 불일치 3건**: ① 피커의 `limit: 100` 단일 쿼리를
  `finalizedJobsInfiniteQueryOptions`로 교체 — 완성본 100개 초과 시 조용히 잘리던 버그가 사라지고
  디자인 페이지와 쿼리 캐시를 공유한다 ② 날짜 포맷을 보관함용 긴 형식으로 통일(피커 `FieldButton`의
  짧은 형식은 유지) ③ Skeleton 라운드를 r4로 통일.
- **문구**: 실사화 다이얼로그 caption "300 DPI" → "실제 제작물은 장인이 직조 방식을 최종 결정하며
  이미지와 다를 수 있어요." 같은 문구를 완성본 모달 그리드 아래 caption으로 상주시켰다.
- **명세**: `worker-pipeline.md` §2를 "2.1 결정론 렌더 → 2.2 AI 실사화 편집 2회" 2단으로 재서술,
  결정론 계약을 §2.1 한정으로 축소(§6), §4·§5에 삼중 산출물·레거시 별칭·롤백 경로·인수물 계약.
  `domains.md` finalize·order-reference 행 갱신. **역할 명시 문구를 양쪽에 추가**: 정본은 intent JSON
  + 결정론 타일, AI 실사는 시각적 설득·참고물, 직조 실현 가능성 판단은 원단 디자이너(사람)의 영역.
  weave **3곳 결속**(api `KNOWN_WEAVES` · `assets/fabric/*.png` · worker `WEAVE_PROMPTS`)을 §2.2에 명시.
- **테스트**: api `test_design.py` — fake worker가 삼중 산출물을 반환하고, 세 URL 노출과
  "실사 2장 중 넥타이 + 타일만 복사"를 핀. store — `finalized-list-modal.test.tsx`를
  `finalized-gallery.test.tsx`로 재편(토글별 이미지 소스·레거시 폴백·페이지네이션·select variant).
  중복 2세트가 1세트로 줄었다.

## 단가는 미확정 (후속 필수) — 2026-08-20 해소

이 절이 요구한 재산정은 같은 날 실행됐다 — quality=low 전환 + 200토큰 확정. 근거·절차는
`docs/reviews/finalize-pricing-low-quality-2026-08-20.md`, 정본은 `money.md` §6. usage 로그
operation은 `finalize`가 아니라 `finalize_tie`·`finalize_fabric` 두 줄이다(당시 표기 오류).

## 타임아웃 — 상향 불필요

편집 2회가 `asyncio.gather` 병렬이라 p95는 편집 1회분(~45s)에 가깝다. api
`worker_timeout_seconds`(180s) < Cloud Run worker-finalize timeout(240s) 관계가 유지되므로 api가
먼저 만료해 환불 경로를 탄다. `infra/cloudrun.tf`의 낡은 근거 주석("실측 p95 로컬 최악 ~2s",
"CPU·메모리-바운드")만 실측값·I/O 바운드로 갱신했다.

## 제거 항목 없음

절차적 합성 경로(`render/fabric.py`)는 **참고 이미지·정본 타일 생성기로 존속**한다. 플랜 초기에
있던 "기존 finalize 제거" 작업은 이 구조 선택(결정론 렌더를 AI 편집의 입력으로 쓰는 2단 구성)으로
소멸했다. 삭제한 것은 store `jobTileScale`(타일 반복 배선이 사라져 미사용)뿐이다.

## 범위 밖으로 남긴 것

- 착장 샷·갤러리(`design_examples`) 개편, 과거 finalize 행의 이미지 재생성 — 표시 호환만 유지.
- 캡슐 내부 프롬프트 개선(스케일 드리프트 보강 등).
- 로컬 E2E는 실행하지 않았다(`e2e-test-harness` 기준의 체크포인트 — 배포 직전 1회).
  DB `generation_jobs.result`의 세 object_key 확인과 `uploads/` 2파일 확인도 그때 함께.

## 플랜의 라인 수 검증은 통과하지 못했다

플랜은 "`git diff --stat`에서 총 라인 수가 줄어야 병합이 값을 한 것"이라고 적었다. 실제로는
목록 3파일 합계 **432줄 → 462줄(+30)**이다. 순수 리팩터라면 줄었겠지만, 이번 병합은 두 화면이
갖고 있지 않던 일을 함께 흡수했다: `previewMode`에 따른 이미지 소스 분기, 레거시 `result_url`
폴백, 선택 배지가 공통 카드로 이동(이전엔 피커 전용), variant별 빈 상태. 중복 제거의 값은
라인 수보다 **고칠 자리가 하나뿐이라는 점**에 있다 — 이미지 배선(6항)이 실제로 한 파일에서 끝났다.
테스트는 2세트 → 1세트로 줄었다.

## 검증

`pnpm lint` · `pnpm architecture:check`(계약 5/5) · `pnpm build` · `pnpm typecheck` ·
`pnpm test`(store 236 / admin 235) · `uv run ruff check .` · `uv run pyright`(0 errors) ·
`uv run pytest apps/api/tests/test_design.py apps/api/tests/test_orders_create.py
apps/api/tests/test_order_image_security.py`(93 passed) ·
`apps/worker/tests/test_photoreal.py test_finalize_jobs.py`(18 passed).

## 배포 주의

worker 캡슐 변경과 이 컷오버는 **같은 릴리스로만** 배포한다. 캡슐만 먼저 나가면 store가 실사
이미지를 타일로 반복 렌더해 이음새가 노출되고, 컷오버만 먼저 나가면 세 URL이 전부 null이 된다.

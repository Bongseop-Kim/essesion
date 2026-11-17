# 주문 제작 첨부 칸 개편과 스토어 표시 결함 2건 (2026-11-17)

플랜 `docs/plans/custom-order-attachments-and-store-polish.md`(실행 완료 후 삭제)를 실행했다. 2026-11-17 사용자
요청 4건이다. 플랜은 소검 칸 삭제를 담았으나 실행 직전 사용자가 "소검 보기는 유지"로 바꿔, **소검 칸과 디자인
도구의 소검 그림 전달은 그대로 두고** 브랜드 라벨 칸을 추가하는 것으로 실행했다.

## 한 것

- **제목 포커스 테두리** `apps/store/src/app/layout/app-layout.tsx` — 경로 전환 때 `h1`으로 포커스를 옮기는
  effect는 유지하고(스크린 리더용), `main`에 `[&_h1:focus]:outline-none`을 더해 링만 숨겼다. 원인은 `h1`에
  그려지던 브라우저 기본 포커스 링이다. 스토어 전 페이지에 적용된다.
- **상세 탭 좌우 빈틈** `apps/store/src/shared/ui/sticky-section-nav.tsx` — 탭 바에 `-mx-x4 md:-mx-x6 lg:mx-0`
  (`guide-section.tsx`와 같은 값)을 더해 lg 미만에서 화면 끝까지 펼쳤다. 주문 제작·수선·샘플 주문·상품 상세
  네 페이지에 같이 적용된다.
- **참고 이미지 부위** — API `ReferencePart`에 `brand_label`·`logo` 추가(`apps/api/src/api/domains/orders/schemas.py`),
  `docs/api-spec/money.md` §3·`domains.md` §8 갱신, `pnpm codegen`. 부위는 `item_data` JSON이라 마이그레이션 없음.
  `REFERENCE_PART_LABELS`(shared)에 "브랜드 라벨"·"로고"를 더해 admin 주문·견적 상세가 그대로 표시한다.
- **주문서 칸** `apps/store/src/features/custom-order/ui/reference-slots.tsx` — `referenceParts(options)`가 보여 줄
  칸을 정한다: 기본 전체·대검·매듭·소검, 포인트(자수·필름) 주문이면 넥타이 칸 대신 **로고 한 칸**, 브랜드 라벨을
  체크하면 **브랜드 라벨 칸** 추가. 두 새 칸은 라벨·엠블럼 모양 SVG 마스크
  (`public/images/slot-brand-label-mask.svg`·`slot-logo-mask.svg`)를 플레이스홀더로 깐다.
- **업로드** `apps/store/src/pages/custom-order/index.tsx` — 업로드 목록과 "첨부 있음" 판정이 보이는 칸만 센다.
  숨은 칸의 파일은 state에 남아 옵션을 되돌리면 복원되지만 올라가지는 않는다. 포인트 주문일 때 필드 라벨·설명
  문구를 로고 기준으로 바꿨다. 추가 이미지 칸은 남겼다(로고 위치 참고 사진용).
- **상세 "정보" 탭** `custom-order-service-guide.tsx` 09 포인트 섹션에 "넥타이 사진 없이 로고 이미지만 올린다"는
  문단을 글로만 추가했다.
- 브랜드 라벨·로고 이미지는 둘 다 필수가 아니다.

## 검증

- `pnpm lint`, `pnpm typecheck`, `pnpm architecture:check` 통과.
- `apps/store` vitest — `pages/custom-order`(칸 전환 테스트 1건 추가), `features/custom-order`,
  `sticky-section-nav` 통과.
- `uv run pytest apps/api/tests/test_orders_create.py` 15건 통과.
- 로컬 실측(2026-11-18, 헤드리스 Chrome, 모바일 390px·PC 1280px):
  - 제목 — `h1`이 포커스를 받고 `:focus-visible`이 참인 상태에서 `outline-style: none`(모바일·PC).
  - 탭 바 — `/custom-order`·`/reform`·`/sample-order` 모바일에서 화면 왼쪽 끝~오른쪽 끝, 가로 스크롤 없음.
    PC는 본문 컬럼 폭 그대로.
  - 칸 — 기본 전체·대검·매듭·소검 → 브랜드 라벨 체크 시 라벨 칸 추가 → 자수·필름 체크 시 로고·브랜드 라벨만.
  - 포인트 주문에 로고·라벨 이미지를 올려 제출 → `reference_images`가 `logo`·`brand_label` 두 건,
    주문 생성 201, admin 주문 상세에 "로고 · "·"브랜드 라벨 · "로 표시.
  - 주문 생성 자체는 결제 화면 대신 스토어가 올린 `upload_id`로 `POST /orders/custom`을 직접 호출했다.

## 하지 않은 것

- 서버에서 부위와 옵션을 교차 검증하지 않는다(포인트 주문에 넥타이 부위가 와도 받는다) — 스토어가 유일한
  클라이언트이고 돈 경로가 아니다.
- 디자인 도구에서 넘어온 제작용 원본(추가 이미지)은 포인트를 켜도 자동으로 지우지 않는다.

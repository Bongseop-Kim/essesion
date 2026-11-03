# 스토어 홈 재구성 — pen 시안 `Yg3ke`(D-03F v2) 이식

스토어 홈(`/`)을 pen 시안 `Yg3ke`(「D-03F v2 · 마플 참조 개선 (커머스 밀도)」, 1440×7912)대로 다시 만든다.
시안 파일은 pen 앱의 `~/.pencil/documents/d50ca757-edd9-4079-ba4d-5c6b1e7ff0d0/untitled.pen`이고, 이미지는 같은 폴더
`images/` 아래에 있다. 데스크톱 시안만 있으므로 모바일은 같은 구조를 세로로 쌓아 만든다. API·스키마·api-client는
바꾸지 않는다. 2026-11-03 사용자 결정에 따라 아래 다섯 가지를 정했다.
- Journal 섹션은 제외한다.
- 시안의 `[확인 필요]` 값은 기존 FAQ·환불정책에서 채운다.
- 시안 이미지는 webp로 변환해 그대로 쓴다.
- 카카오톡 상담 링크는 `http://pf.kakao.com/_gZpqX/chat`이다.
- 히어로 영문 디스플레이는 서체 토큰을 추가하지 않고 기존 `display1`로 먼저 만든다.

## 왜 필요한가

- 현재 홈(`apps/store/src/pages/home/index.tsx:57-103`)은 다음 순서로 흐른다.
  - 캐로셀 히어로 → 인기 상품 → 단체 CaseSection → 룩북 → 수선 CaseSection → 파트너 → 리뷰
  - 디자인(`/design`) 진입점은 캐로셀 배너 하나뿐이다.
  - FAQ와 상담 연결은 홈에 없다.
- 시안은 흐름을 **구매 → 디자인 3단계 → 신뢰 → 수선 → 단체 절차 → 용도 → 후기 → 브랜드 → FAQ → 상담**으로 바꾼다.
  - 2026-10 템플릿 우선 디자인 개편(#98)에 맞춰 "고르고, 바꾸고, 끝" 흐름을 홈에서 보여 준다.
  - 단체 주문 조건(최소 수량, 기간)을 홈에서 바로 답한다.

## 범위 밖

- 글(Journal) 기능, 브랜드 소개 페이지, 리뷰 전체 페이지는 만들지 않는다. 시안의 해당 링크는 갈 곳이 없으므로 뺀다.
- Header·Footer(`apps/store/src/app/layout/app-layout.tsx`)와 상품 데이터·상품 사진은 건드리지 않는다.

## 실행 조건

- 시안 `Yg3ke`가 pen 앱에서 열려 있어야 한다. `get_app_state`로 노드를 확인한다. 노드가 없거나 섹션 구성이 아래 표와 다르면 실행하지 말고 사용자에게 최신 시안을 확인받는다.
- 1단계에서 디자인 시스템에 없는 토큰이나 컴포넌트가 필요하다고 판정되면 거기서 멈추고 제안한다(`packages/shared/AGENTS.md`).
- **실패 모드**: 시안 밀도(작은 캡션, 썸네일 3열, 5단계 가로 행)를 모바일에 그대로 옮기면 깨진다. 섹션마다 390px에서 확인하지 않고 넘어가는 것이 이 플랜의 실패 모드다.

## 섹션 매핑 (시안 순서)

| # | 시안 노드 | 구현 (`apps/store/src/features/home/`) | 링크 |
|---|---|---|---|
| 1 | Hero `oyWmk` | `hero.tsx` 재작성. 캐로셀을 없애고 풀블리드 1장 + "TIE? WHY NOT." + "직접 만들고, 직접 고쳐요" 카피 + CTA 2개 | `/design`, `/custom-order` |
| 2 | Best `u205M4` | `popular-products.tsx` 유지. 제목만 "요즘 자주 담기는 넥타이"로 바꾼다 | `/shop` |
| 3 | Template `QWeRK` | 신규 `template-steps.tsx`. 카드 3장(템플릿 고르기, 색 바꾸기, 로고 넣기), 큰 사진 + 썸네일 3개 | `/design` |
| 4 | Trust `NgCMN` | `partners.tsx` 유지. 제목을 "믿고 맡길 수 있는 제작 경험"으로 바꾼다 | — |
| 5 | Repair `R6MQn` | 신규 `repair-steps.tsx`. REPAIR와 01~03 단계 + 세로 이미지. 수선 CaseSection을 대체한다 | `/reform` |
| 6 | Cases `EYmis` | `case-section.tsx`를 단체 전용으로 재작성. 태그 카드 3장 + "단체 주문 절차" 5단계 + 조건 줄 + 견적 문의 | `/custom-order` |
| 7 | Occasions `N6t7Cn` | 신규 `occasions.tsx`. 용도 칩 6개를 각 라우트로 연결한다 | 칩별 |
| 8 | Reviews `l3BuV` | `reviews.tsx`의 문구 3개를 시안 문구로 바꾸고 사진을 넣는다 | — |
| 9 | Story `HlB9k` | 신규 `story.tsx`. OUR STORY 카피 + 이미지 | — |
| — | Journal `djMLV` | **제외** | — |
| 10 | FAQ `eLONv` | 신규 `home-faq.tsx`. shared `Accordion`으로 질문 4개 + 배송·교환 박스 | `/faq` |
| 11 | Final CTA `ZgEyQ` | 신규 `contact-cta.tsx`. 카카오톡 상담(새 탭)과 `tel:0507-1381-7422` 버튼 | 카카오 채널 |

카피는 pen 텍스트 노드를 그대로 쓴다. 노드는 `Get("Yg3ke", n => n.type==="text" && Print(n.content))`로 뽑는다. 사업자 표기는 영선산업(ESSE SION)이다.

## 절차

1. **하네스 판정.** `packages/shared/AGENTS.md`와 `packages/shared/src/theme.css`를 읽고 세 가지를 정한다.
   - (a) 히어로 영문 디스플레이(시안은 Archivo Black): 기존 `display1`로 만든다(2026-11-03 결정). 결과를 보고 부족하면 그때 서체 토큰을 제안한다.
   - (b) 이동용 칩: `Tag`와 링크 조합으로 될지 정한다. shared `Chip`은 선택용이라 쓰지 않는다.
   - (c) 히어로 글자 대비: `apps/store/src/features/home/scrim.tsx`를 재사용할 수 있는지 본다.
   - 근거: 하네스 밖 스타일은 `pnpm lint`(`scripts/check-harness.mjs`)에서 막힌다.
2. **이미지 이관.** 시안이 참조하는 이미지를 `apps/store/public/images/home/`으로 옮긴다.
   - 목록은 pen에서 image fill URL을 뽑아서 만든다. 약 30장이고 상품 사진은 제외한다.
   - 기존 네이밍(`name-{w}.webp` 1x·2x 쌍, `index.tsx:68-70` 참고)을 따른다.
   - 로고 4장(`images/essesion.shop/*.png`)이 기존 `partner-*.png`와 같으면 재사용한다.
   - 근거: 기존 홈 자산이 모두 반응형 webp 쌍이다.
3. **섹션 구현.** 위 표 순서대로 만든다.
   - 기존 `Section`·`SectionHeader`(`section.tsx`), `ProductCard`(`apps/store/src/entities/product/ui/product-card.tsx`), `Grid`, `ScrollFog`를 재사용한다.
   - 카드 3열은 `Grid columns={{base:1, md:3}}`로 둔다.
   - 단체 절차 5단계와 칩 행은 모바일에서 `ScrollFog`로 가로 스크롤한다.
4. **FAQ·배송 박스 값.** 출처는 `apps/store/src/pages/faq/model/faq-data.ts`와 `apps/store/src/pages/refund-policy/index.tsx`다.
   - 최소 4개와 28~42영업일은 출처 문구와 대조하고, 다르면 출처 값을 따른다.
   - 반품 7일은 `faq-data.ts:68`에서 가져온다.
   - `{{REFORM_SHIPPING_COST}}`처럼 설정값으로 치환되는 항목은 숫자로 박지 않고 "자세히 보기 → /faq"로 대체한다.
   - 출처가 없는 줄(무료배송 기준, 출고일 등)은 뺀다.
5. **조립.** `apps/store/src/pages/home/index.tsx:57-103`의 섹션 순서를 표대로 바꾼다.
   - sr-only h1(`:54-56`), JSON-LD, meta는 유지한다.
   - `hero-accessibility.test.tsx`는 단일 히어로 구조에 맞게 고친다.
6. **정리.** 고아 여부를 `rg`로 확인한 뒤 다음을 지운다.
   - `lookbook.tsx`
   - 히어로 캐로셀 상수
   - 참조가 없어진 `public/images/home/*`: `ai|custom|showcase|repair-*`, `1~4-*`, `tile-*`, `custom1·2-*`, `repair1·2-*`

## 검증

- `pnpm lint`, `pnpm --filter store typecheck`, `pnpm --filter store test`
- `lsof -i :3000`으로 store가 떠 있는지 확인하고, 없을 때만 `pnpm --filter store dev`로 띄운다.
- browser-use로 `/`를 1440px과 390px에서 캡처하고, pen `TakeScreenshot`의 같은 섹션과 나란히 비교한다. 순서, 카피, 이미지, 링크 대상을 본다.
- 키보드 탭 순서, 이미지 alt, 같은 이름의 링크가 겹치지 않는지 확인한다.

## 기각한 대안

- 템플릿 섹션을 `GET /design/examples` 실데이터로 그리기: 시안은 단계 설명용 연출 사진이다. 홈에서 템플릿 목록을 노출하기로 하면 재론한다.
- `CaseSection`을 범용으로 유지하기: 수선이 단계형으로 바뀌어 사용처가 단체 하나만 남는다.
- Journal을 정적 카드로 넣기: 링크가 갈 곳이 없다. 글 기능이 생기면 재론한다.

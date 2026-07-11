# store 맞춤 주문(C5) 재구현 플랜

> YeongSeon `/custom-order`(위저드) + `/checkout`(OrderCheckoutPage 경유 맞춤 결제)을 essesion store `/custom-order` + `/order/custom-payment`로 재작성.
> **백엔드 변경 0건** — `/orders/custom/calculate`(공개)·`/orders/custom`·`/quotes`·`/images/upload-url(kind=custom_order)` 전부 구현·api-client 생성 완료. codegen 불필요.
> 결제는 C3 composite(`use-checkout-payment`·`PaymentWidget`·`features/shipping`·`features/coupon`) 재사용 — C3 D7(공용 결제 페이지 골격, C5에서 추출)을 이 청크에서 이행한다.

## 1. 범위

- **라우트 2개 신설** (`app/router/index.tsx`, lazy):
  - `/custom-order` — **공개 라우트**(ProtectedRoute 아님). 서버가 calculate를 공개로 설계(`orders/router.py:43` "비로그인 견적 UX") → 비로그인도 사양 조합·견적 확인 가능, 제출·업로드 액션만 `useAuthGuard().requireAuth`.
  - `/order/custom-payment` — ProtectedRoute. router state로 draft를 받아 결제(state 없으면 `/custom-order` 복귀).
- **feature 신설**: `features/custom-order` (옵션 상수·zod 스키마·디바운스 견적 훅·섹션 UI·업로드).
- **C3 D7 이행**: `features/checkout`에 결제 페이지 골격(`CheckoutShell`) 추출 — order-form이 첫 소비자로 교체되고 custom-payment가 두 번째, C6(sample)이 세 번째 예정.
- **제외 (이연)**: 견적 내역 조회 페이지(`GET /quotes` — C10 `/my-page/quote-request`), "내 AI 디자인에서 선택" 피커(원본 DesignImagePicker — **C12 이연**: 완성물 갤러리 목록 엔드포인트와 store 디자인 페이지가 모두 미구현. 첨부 섹션은 원본처럼 pickerSlot 주입 구조로 자리만 남긴다), success 페이지의 custom 전용 문구 분기(기본 "결제가 완료되었습니다"로 충분), 알림톡은 서버 BackgroundTasks가 처리하므로 프론트 무관.
- **백로그 (C5 밖, 기록만)**: 견적 '확정' 상태 → 결제 전환. 원본에도 없음(견적은 오프라인 협의로 종결). `quoted_amount`가 이미 저장되므로 quote→custom order 변환 엔드포인트 하나로 온라인 결제까지 닫을 수 있음 — 별도 기획 필요.

## 2. 흐름 시퀀스 (확정 계약)

```text
/custom-order (공개)
  ├─ 6개 섹션 세로 스크롤: 수량 → 원단 → 봉제 → 규격 → 마감 → 참고자료
  │    (원단 섹션은 fabricProvided면 숨김 — reorder는 노출 유지, §3·D9)
  ├─ 폼 변경 → 디바운스 400ms → POST /orders/custom/calculate → sidebar 견적 갱신 (§5-A)
  ├─ quantity < 100 ──[주문하기]──▶ 섹션 검증(§5-C) → requireAuth
  │      └─ navigate("/order/custom-payment", { state: draft })   ← 주문 레코드는 아직 없음
  │         draft = { options(요청 형태), quantity, referenceImages[], additionalNotes, estimate }
  └─ quantity ≥ 100 (견적 모드, §5-B) ──[견적 요청하기]──▶ 검증 → requireAuth
         └─ AlertDialog 확인 → POST /quotes → snackbar("견적 요청이 접수되었습니다") → 홈 이동

/order/custom-payment (ProtectedRoute, state 없으면 /custom-order 복귀)
  ├─ 본문: 사양 요약 + ShippingAddressCard(기본 배송지 자동선택) + 쿠폰 선택
  ├─ sidebar: SummaryCard(봉제비/원단비/쿠폰할인/합계) + PaymentWidget
  └─ [결제하기] = useCheckoutPayment.pay()
       createOrder = POST /orders/custom {shipping_address_id, options, quantity,
                                          reference_images, additional_notes, user_coupon_id}
                     → {payment_group_id, total_amount}   (서버: Order(custom,대기중)+쿠폰 reserved)
       expectedAmount = estimate.total_cost − 클라 쿠폰할인 → 불일치 시 중단(C3 계약)
       snapshot 캐시(D6)·USER_CANCEL 무시·중복클릭 가드는 훅이 공통 처리
       → requestPayment(orderId=payment_group_id) → /order/payment/{success,fail} (C3 페이지 재사용)
```

- confirm은 order_type 무관 단일 경로(`POST /payments/confirm`) — success 페이지 수정 불필요: snapshot에 `cartItemIds` 없음 → cart 정리 스킵, `planRepairOutcome`는 custom 주문에 no-op.
- **fail 페이지 1줄 수정**: "주문서로 돌아가기"가 `/order/order-form` 고정 — snapshot에 `returnTo` 힌트를 추가해 custom이면 `/custom-order`로 복귀(§9-D6).
- `orderName` = `맞춤 넥타이 제작 {quantity}개`.
- 이탈 주문은 C3와 동일하게 30분 stale 배치가 취소 + 쿠폰 복원(C3 D8 반영 완료).

## 3. 원본 대비 의도적 차이 (기능 명세는 보존)

| YeongSeon | essesion | 근거 |
|---|---|---|
| 견적을 **클라에서 계산**(pricing_constants 로드 + pricing.ts, 디바운스 없음) + 서버가 생성 시 재계산 → CHILD/7폴드에서 표시≠청구 버그 | **서버 calculate 단일 소스**(디바운스 400ms) — 클라 가격 산식 미보유 | 대원칙 "과금 로직은 api에만". 표시=청구로 원본 불일치 자동 해소 |
| 미로그인 시 예상 비용 숨김("로그인하면 확인") | **미로그인도 견적 표시** — calculate가 공개 엔드포인트 | 서버가 이미 공개로 설계(`orders/router.py:43`). 전환 퍼널 개선 |
| ImageKit 업로드(`/custom-orders` 폴더) | **GCS 서명 업로드**: `POST /images/upload-url(kind="custom_order")` → PUT → object_key 수집. 미리보기는 `URL.createObjectURL`(주문 전엔 Image 레코드가 없어 read-url 불가) | 인프라 이관(domains.md §8). reform upload.ts 패턴 |
| 첨부 개수 무제한·image/* 전체 허용 | **최대 5장, 10MB, jpg/png/webp** — `AttachmentDisplayField` 계약 | 서버 허용 타입(`images/router.py:25-26`)과 일치. 무제한은 options 10KB 제한과 충돌 여지 |
| 견적 접수 후 마이페이지 견적 목록으로 이동 | snackbar + **홈 이동** (견적 목록은 C10) | 청크 경계. `GET /quotes` 준비돼 있어 C10에서 붙이기만 |
| 결제 페이지가 zustand 없이 location.state (`CustomOrderPaymentState`) | 동일 — router state draft, 새로고침 시 `/custom-order` 복귀 | C3 D4와 같은 패턴 |
| 새로고침 시 위저드 입력 전부 소실 | **sessionStorage draft 보존** — 저장은 watch 디바운스, 복원은 zod 파싱 통과분만 | 6섹션 긴 폼 이탈 보호 (개선, D10) |
| 연락처 프로필 자동 채움(`quote-contact-defaults`) | 로그인 세션(`useSession().user`)의 name/phone/email로 동일 재현, 사용자 편집값 보존 | 보존 |
| **reorder 체크 시 원단 스텝 숨김 + fabricType/designType 기본값(폴리·날염) 유지 → 숨은 기본값으로 원단비 과금**(버그성 — 실크 재주문도 폴리 단가) | **reorder여도 원단 스텝 노출** — "기존 주문과 동일한 원단을 선택해 주세요" 안내 문구, 선택값대로 과금 | 숨은 과금 제거·견적 정확성. 서버는 reorder를 모르므로 프론트가 동작을 소유(D9) |
| 유의사항 4문구 중 ④ "접수 전 취소 시 수선 택배비…" | ① 제주/도서산간 추가 배송비 ② 제작 기간 ③ 접수 후 취소·환불 불가 — **3문구만** | ④는 reform 공용 문구 오재사용(맞춤 주문에 부정확). 배송비는 서버 미청구·안내용(원본 동일) |
| `?showCostBreakdown=true` 옵션별 원가 상세(진입점 없는 내부 디버그) | 미이관 — calculate 응답의 봉제/원단 분리 표시로 갈음 | 클라 가격 산식 미보유(D1)라 재현 불가. 프로덕션 동선에 없던 기능 |
| `analytics.track("form_submit")` 2건 | 미이관 | store 전체에 분석 인프라 부재(전 페이지 공통) |
| options에 `interlining_thickness:"THICK"` 항상 포함 | 키 제거 | 선택 UI 없음·가격 무관·항상 동일값 — 죽은 메타데이터 |
| PageSeo 컴포넌트(title·description·og) | React 19 네이티브 `<title>`/`<meta>` JSX(홈 index.tsx 패턴) | 공용 SEO 추상화 없음. 문구는 원본 보존 |
| 수량 직접 입력 상한 없음 | 상한 10,000 clamp | 비정상 입력 방어 |

보존: 6섹션 스크롤 위저드 + 검증 실패 시 해당 섹션 스크롤, 옵션 의존성 리셋(fabricProvided→reorder/원단 리셋, 수동 타이→딤플 해제+안내), 100개 임계 안내, 수량 프리셋 `[4,8,12,20,50,100]`·최소 4개, 넥타이 폭 6~12cm 0.5 단위 clamp, 예상 제작 기간(직접 제공 7~14일/재주문 21~28일/기본 28~42일), 견적 모드 담당자 정보 필수 + 확인 다이얼로그, **이미지 업로드 진행 중 제출 차단**, 선주문 생성 → Toss → confirm 순서.

## 4. 데이터 계약 (전부 생성 완료 — codegen 불필요)

| 엔드포인트 | api-client | 용도 |
|---|---|---|
| POST /orders/custom/calculate (공개) | `calculateCustomOrder` (sdk 직접 — useQuery로 감쌈, §5-A) | 실시간 견적. `{options, quantity}` → `{sewing_cost, fabric_cost, total_cost}` |
| POST /orders/custom | `createCustomOrderMutation` | 결제 1단계. → `{order_id, order_number, payment_group_id, total_amount}` |
| POST /quotes | `createQuoteMutation` | 견적 요청(≥100 서버 강제). 담당자·배송지 필수, options 10KB 제한 |
| POST /images/upload-url | `createUploadUrl` | `kind:"custom_order"` 서명 URL 발급(인증 필요) → PUT 업로드 → `{object_key}` |
| POST /payments/confirm | `confirmPaymentMutation` | C3 success 페이지 그대로 |
| GET /users/me/addresses · GET /coupons/mine | C3 composite 그대로 | 배송지·쿠폰 |

**options dict는 프론트가 소유** (`features/custom-order/model/options.ts` — 서버는 `dict[str,Any]`로 저장, 가격 관련 키만 검증 `orders/service.py:481-535`):

- 가격·사양 키(서버 계약): `tie_type: ""|"AUTO"`, `interlining: ""|"WOOL"`, bool 9종 `triangle_stitch/side_stitch/bar_tack/dimple/turn_knot/spoderato/fold7/brand_label/care_label`, `fabric_provided: bool`, `design_type: "PRINTING"|"YARN_DYED"` + `fabric_type: "POLY"|"SILK"`(fabric_provided=false일 때 필수). `turn_knot`은 사양 기록용이며 자동 타이 비용에 포함된다.
- **주의: 심지 POLY는 `interlining: ""`로 정규화** — 서버가 `""|"WOOL"` 외를 400 처리. 딤플·돌려묶기는 AUTO 전용(서버도 검증하지만 클라 의존성 리셋이 선차단).
- 기록용 키(calculate는 무시, item_data/quote에 스냅샷): `reorder`, `size_type: "ADULT"|"CHILD"`, `tie_width: number`.

## 5. 착수 전 제안 3건 (프롬프트 요구사항)

### A. calculate 디바운스

- **훅**: `features/custom-order/model/use-custom-quote.ts`. RHF `watch` 값 → 요청 payload 변환 → `useDebouncedValue(payload, 400ms)` → `useQuery({ queryKey: ["custom-order","calculate", debounced], queryFn: () => calculateCustomOrder({ body: debounced }), placeholderData: keepPreviousData, staleTime: 5m })`.
- mutation이 아니라 **useQuery로 감싸는 이유**: queryKey=payload라 경쟁 응답(늦게 도착한 이전 요청이 최신 견적을 덮는 문제)이 구조적으로 없고, 같은 조합 재방문은 캐시 히트로 요청 0회.
- `enabled` 가드: `quantity ≥ 4` && (fabric_provided || design/fabric 선택 완료). 미충족 시 sidebar는 "사양을 선택하면 예상 비용이 표시됩니다".
- 표시 상태: 최초 로딩 `Skeleton`(견적 행 형태) / 재계산 중엔 `isPlaceholderData`로 이전 금액 유지 + 은은한 표시(opacity) — 금액이 0으로 깜빡이지 않게. 서버 400(invalid_options)은 의존성 리셋이 선차단하므로 방어적으로만 처리(에러 문구 + 재시도).
- 견적 모드(≥100)에서도 계속 계산해 **참고 견적**으로 표시(원본 동작 보존).

### B. 견적 모드 분기

- 단일 분기점: `isQuoteMode = quantity >= QUOTE_THRESHOLD(100)` — 파생값 하나로 통일, 별도 상태 없음.
- 임계 통과(미만→이상) 순간 1회 `snackbar("100개 이상은 견적 요청으로 접수됩니다.")`.
- 견적 모드에서 추가되는 것 (수량 섹션 하단에 조건부 노출):
  1. **담당자 정보** — `contact_name`(필수)·`business_name`(선택)·`contact_method` phone/email(Chip)·`contact_value`(필수, method별 형식 검증). 로그인 시 프로필로 자동 채움.
  2. **배송지 카드** — `QuoteCreateRequest.shipping_address_id`가 필수이므로 `features/shipping` 카드+선택 모달을 이 페이지에 노출. (즉시주문 경로는 결제 페이지에서 선택 — C3 패턴 유지, 페이지 책임 분리.)
- actionBar 전환: 금액 표시는 유지(참고 견적), 버튼 라벨 "주문하기" ↔ "견적 요청하기", helperText로 미로그인/배송지 미선택 안내.
- 제출: 섹션 검증(§C) 통과 → `requireAuth` → **AlertDialog**("입력한 사양과 연락처로 견적 요청을 접수할까요?" — 진행 차단 확인이므로 Alert) → `createQuote` → 성공 snackbar + 홈 이동. 알림톡은 서버가 백그라운드 발송.

### C. 스텝 검증 흐름

- **폼**: `react-hook-form`(이미 catalog 의존성) + 섹션별 zod 스키마. 스텝 정의는 `model/schema.ts`의 배열 하나로: `{ id, title, schema, visible(values), anchorId }` — 렌더 순서·검증 순서·스크롤 대상이 같은 소스.
- 각 섹션은 `<section id="custom-order-{id}">` + `scroll-mt`(sticky 헤더 보정) 래퍼(`ui/wizard-section.tsx`).
- 제출 시: 스텝 배열 순회 → `visible=false`(fabricProvided로 숨긴 원단 섹션) 스킵 → 첫 실패 스텝에서 중단 → `snackbar(에러 문구)` + `scrollIntoView({behavior:"smooth"})` + 첫 오류 필드 focus. 통과 후 견적모드/즉시주문 분기.
- 인라인 에러: 제출 시도 전에는 표시하지 않음(RHF `submitCount`) — 작성 중 빨간 화면 방지. 시도 후엔 필드별 `errorMessage`(Field/TextField 배선).
- 실검증 규칙: quantity ≥ 4(직접 입력은 10,000 상한 clamp) / 원단: fabric_provided 아니면 design+fabric 필수(**reorder도 원단 선택 필수** — D9로 원단 스텝이 노출되므로) / tie_width 6~12(입력 시 clamp+0.5 정규화라 사실상 통과) / 견적 모드: contact_name·contact_value 필수 / 봉제·마감·첨부는 검증 없음.
- 제출 비활성 조건에 **이미지 업로드 진행 중(isUploading)** 포함(원본 동작). 다중 파일 업로드는 기존 `mapWithConcurrency`(features/reform/api/upload.ts) 재사용.
- 값 변경 즉시 처리하는 의존성(검증과 별개, `useEffect`+watch): fabricProvided on → reorder/design/fabric 리셋, AUTO→수동 → dimple 해제 + snackbar 안내, 100개 임계 snackbar.

## 6. Composite 경계 (D7 이행 + 신규 배치)

```text
apps/store/src/
├─ features/checkout/
│  └─ ui/checkout-shell.tsx          # ★ D7 추출 — ContentLayout+PaymentWidget+PaymentActionBar 조립
│     # props: { breadcrumbs, children(본문), summary(ReactNode), amount, orderName 아님 —
│     #   결제 배선은 콜러 소유: onPay(widgetHandle), payDisabled, payLoading, helperText }
│     # 위젯 ref·ready 상태만 내부 관리. 도메인 로직 0 — order-form을 이걸로 교체(동작 불변),
│     # custom-payment가 두 번째, C6 sample이 세 번째 소비자.
├─ features/custom-order/
│  ├─ model/options.ts               # 옵션 상수·라벨·기본값·QUOTE_THRESHOLD (프론트 소유, §4)
│  ├─ model/schema.ts                # zod 섹션 스키마 + 스텝 정의 배열 (§5-C)
│  ├─ model/to-request.ts            # 폼 값 → options dict (snake_case·interlining 정규화) — 단위테스트 대상
│  ├─ model/use-custom-quote.ts      # 디바운스 calculate (§5-A)
│  ├─ model/estimate.ts              # 예상 제작 기간(7~14/21~28/28~42) 등 표시 전용 파생
│  ├─ model/draft.ts                 # sessionStorage draft 저장·복원(zod 파싱 통과분만, D10)
│  ├─ api/upload.ts                  # createUploadUrl(kind=custom_order) → PUT (reform upload.ts 패턴)
│  ├─ ui/wizard-section.tsx          # 앵커 섹션 래퍼
│  ├─ ui/{quantity,fabric,sewing,spec,finishing,attachment}-section.tsx
│  │                                 # attachment는 pickerSlot?: ReactNode 계약 — C12 AI 디자인 피커 주입 자리
│  ├─ ui/quote-contact-fields.tsx    # 견적 모드 담당자 정보
│  └─ ui/estimate-summary.tsx        # sidebar 견적(봉제/원단/합계·단가·제작기간) — C6 재사용 후보
└─ pages/
   ├─ custom-order/index.tsx         # 위저드 조립 + 분기 (§2·§5)
   └─ order/custom-payment.tsx       # CheckoutShell + createCustomOrder 주입
```

- `use-checkout-payment`는 **무수정 재사용** — `createOrder`에 `createCustomOrderMutation`, `storageKey=CHECKOUT_PENDING_KEY`(success 정리 로직 공유), snapshot=draft. 설계 의도대로(`store-checkout.md:93`).
- `features/shipping`·`features/coupon`·`SummaryCard`·`PaymentActionBar` 무수정 재사용.

## 7. UI 하네스 매핑

| 슬롯/요소 | 구성 |
|---|---|
| /custom-order 본문 | WizardSection × 6. 시작 방식·봉제 스타일·마감·라벨 = `Checkbox`, 원단 4조합·타이 종류·사이즈·연락 수단 = `Chip`(단일 선택), 수량 프리셋 = `Chip` + `TextField`(직접 입력), 넥타이 폭 = `TextField` suffix "cm", 요청사항 = `TextAreaField maxLength 500`, 첨부 = `AttachmentDisplayField`(max 5, onAddFiles=requireAuth 가드) |
| sidebar | `SummaryCard`(원단/봉제/수량 요약 Row + 견적 Total) + estimate-summary(단가·예상 제작 기간 caption) + 유의사항 `Callout`(neutral — §3의 3문구: 제주/도서산간 배송비·제작 기간·취소 불가) |
| head | React 19 네이티브 `<title>맞춤 넥타이 제작 주문 | …</title>`·`<meta description>`·og 태그 JSX(홈 index.tsx 패턴 — 공용 PageSeo 없음) |
| actionBar | `PaymentActionBar`(amount=견적, 라벨 주문하기/견적 요청하기, helperText) |
| /order/custom-payment | CheckoutShell: 본문=사양 요약 카드+ShippingAddressCard+쿠폰, sidebar=SummaryCard+PaymentWidget, actionBar=결제하기 |
| 피드백 | 임계·의존성 해제·검증 실패 = `snackbar()`, 견적 접수 확인 = `AlertDialog`, 견적 로딩 = `Skeleton`/이전값 유지, 업로드 중 = ProgressCircle(버튼 인라인) |

- 검증: 임의 색/px 금지 — `pnpm lint`(check-harness)가 강제. 모바일 하단 sticky actionBar는 ContentLayout이 처리.

## 8. 결정 사항 (구현 전 확정)

| ID | 결정 | 권장 |
|---|---|---|
| D1 | 견적 = 서버 calculate 단일 소스 + 디바운스 400ms + useQuery(queryKey=payload) 경쟁 차단 (§5-A). 클라 가격 산식 미보유 | 확정 권장 |
| D2 | `/custom-order` 공개 라우트 + 미로그인 견적 표시(원본과 의도적 차이). 제출·업로드만 requireAuth | 확정 권장 |
| D3 | D7 이행 = **얇은 CheckoutShell만 추출**(위젯 ref·actionBar 배선). 주문 데이터·쿠폰·배송지는 콜러 소유 — 과추상화 회피 | 권장 (대안: 직조립 1회 더, C6에서 추출) |
| D4 | 견적 모드에서만 배송지 카드를 /custom-order에 노출. 즉시주문 배송지는 결제 페이지에서(C3 패턴) | 확정 권장 |
| D5 | 첨부 = GCS 서명 업로드 kind="custom_order" 고정(견적 요청도 동일 키 — 서버는 object_key 문자열만 기록), 미리보기 createObjectURL, max 5장 | 확정 권장 |
| D6 | pending snapshot에 `returnTo: "order-form"\|"custom-order"` 추가 — fail 페이지 복귀 분기(payment-fail.tsx 소수정) | 권장 |
| D7 | 견적 접수 완료 = snackbar + 홈. 견적 목록은 C10(`GET /quotes` 대기) | 권장 |
| D8 | 심지 POLY → `interlining:""` 정규화(서버 400 계약). 표시 라벨은 프론트 상수로 복원 | 확정 (서버 계약) |
| D9 | **reorder여도 원단 스텝 노출**(원본의 숨은 기본값 과금 버그 미재현). 원단 스텝 숨김 조건 = fabricProvided만 | 확정 권장 |
| D10 | 위저드 draft를 sessionStorage에 보존(저장 디바운스, 복원은 zod 파싱 통과분만) — 원본은 새로고침 시 소실 | 권장 |
| D11 | SEO = React 19 네이티브 `<title>`/`<meta>`/og JSX(홈 패턴). 문구는 원본 PageSeo 값 보존 | 확정 권장 |
| D12 | AI 디자인 첨부 피커 = C12 이연. attachment 섹션에 `pickerSlot` 계약만 남김 | 권장 |

## 9. 작업 순서

1. **D7 추출 (독립 커밋)**: `features/checkout/ui/checkout-shell.tsx` 신설 + `pages/order/order-form.tsx`를 셸 소비로 교체 — 동작 불변 리팩터, C3 왕복 재검증.
2. **features/custom-order model**: options 상수 → zod 스키마·스텝 정의 → `to-request.ts`(+단위테스트: interlining 정규화·fabric 조건·reorder 시 원단 필수·interlining_thickness 미포함) → `use-custom-quote.ts` → `draft.ts`(sessionStorage 보존·복원 +단위테스트).
3. **섹션 UI 6종** + wizard-section + quote-contact-fields + estimate-summary. attachment는 pickerSlot 계약 포함.
4. **api/upload.ts** + AttachmentDisplayField 연결(requireAuth 가드, 업로드 중 제출 차단).
5. **pages/custom-order/index.tsx**: 조립 + 의존성 리셋 + 검증-스크롤(§5-C) + 견적/즉시 분기(§5-B) + draft 복원 + 네이티브 SEO 메타(D11).
6. **pages/order/custom-payment.tsx**: CheckoutShell + createCustomOrder 주입 + 쿠폰/배송지. D6 returnTo 반영(fail 페이지 소수정).
7. **라우터 등록** 2건(공개 / ProtectedRoute).
8. **검증**: `pnpm lint` → `pnpm turbo typecheck test` → 실렌더 왕복 — 로컬 API(Toss DryRun)로 ① 사양 조합 변경→견적 갱신(디바운스·이전값 유지) ② 4개 미만/원단 미선택 검증 스크롤 ③ 수동 타이 딤플 해제 ④ 즉시주문: 결제창→success confirm ⑤ 100개 견적: 담당자+배송지→AlertDialog→접수 snackbar ⑥ 비로그인 견적 표시+제출 가드 ⑦ custom-payment 직접 진입/새로고침 복귀 ⑧ fail 복귀 분기 ⑨ reorder 체크 시 원단 스텝 노출·선택값 과금(D9) ⑩ 새로고침 후 draft 복원(D10) ⑪ 업로드 진행 중 제출 차단. 반응형(모바일 하단 actionBar) 확인.
9. `docs/CHECKLIST.md` C5 항목 갱신.

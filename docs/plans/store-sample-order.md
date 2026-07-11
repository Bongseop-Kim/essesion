# store 샘플 주문(C6) 검증·개선 플랜

> YeongSeon `/sample-order` + `/order/sample-payment`(SampleOrderCheckoutPage)를 essesion store 동일 라우트로 재작성.
> **⚠ 상태: 구현 완료** — `c3d9bf3`에 프론트 2페이지·`features/sample-order`·API(`/orders/sample`, `/orders/sample/calculate` 공개)·api-client 생성물·서버 테스트 2건·라우터/nav 등록까지 전부 커밋됨(CHECKLIST C6 완료 표기). 따라서 이 문서는 신규 구현 플랜이 아니라 **① 원본 대비 파리티 검증 기록 ② 남은 갭·개선 작업 플랜**이다.
> 결제는 C3 composite(`use-checkout-payment`·`CheckoutShell`·`features/shipping`·`features/coupon`) **무수정 재사용 완료** — C5가 이행한 D7(CheckoutShell)의 세 번째 소비자.
> **개선 실행 완료(2026-07-11)** — S1·S2·S3·S5 구현. S4는 운영 근거를 확인할 수 없어 현행 값을 유지하고 운영 결정 대기 상태로 기록했다.

## 1. C5와의 공유(재사용) 현황 — 프롬프트 요구 "재사용 계획"의 실적 확인

| 자산 | 출처 | sample에서의 사용 |
|---|---|---|
| `CheckoutShell` (결제 페이지 골격) | C5 D7 추출, `features/checkout/ui/checkout-shell.tsx` | `pages/order/sample-payment.tsx:101` 무수정 재사용 |
| `useCheckoutPayment` + `CHECKOUT_PENDING_KEY` | C3, `features/checkout/model/` | snapshot=`{sampleOrder draft, returnPath, returnState}` 주입만 다름 |
| `SummaryCard` (견적 카드) | store 로컬 `shared/ui/summary-card.tsx` | 폼 sidebar·결제 사양 요약 양쪽 재사용 — 별도 estimate 컴포넌트 신설 안 함(옵션 4개뿐이라 Row 직조립이 더 얇음, 원본 `SampleOrderEstimate`의 표시 항목은 전부 재현) |
| GCS 업로드 | C5 `features/custom-order/api/upload.ts` | `uploadOrderImage(file, "sample_order")` — kind만 다름 |
| `ShippingAddressCard`·`AddressSelectModal`·쿠폰 모달/할인 | C3 `features/shipping`·`features/coupon` | 무수정 재사용 |
| `ContentLayout` sidebar+actionBar | store 공용 | 폼 페이지가 직접 사용(C5 위저드와 동일 패턴) |

sample 전용으로 새로 만든 것은 `features/sample-order/model/options.ts`(옵션 타입·기본값·라벨·api 변환)와 페이지 2개뿐 — C5 대비 옵션이 4그룹(유형·원단조합·타이·심지)으로 단순해 zod 스텝 스키마·wizard-section·디바운스 훅 분리는 하지 않았다(§5-C에서 일부 재평가).

## 2. 흐름 시퀀스 (구현 확정 계약)

```text
/sample-order (공개 라우트)
  ├─ 4개 섹션: 샘플 유형 → 원단 조합(sewing이면 숨김) → 봉제 사양(타이·심지) → 참고 자료(이미지 max 5·요청사항 500자)
  ├─ 가격 결정 키(sample_type·design_type) 변경 → TanStack Query로 POST /orders/sample/calculate
  │    (공개, 부작용 0, staleTime 5분·동일 조합 캐시) → sidebar 금액 갱신
  └─ [주문하기] → 금액 확인 중이면 차단 → requireAuth(복귀 시 location.state로 옵션 복원, 파일은 재첨부 안내)
        → 이미지 GCS 업로드(kind=sample_order) → navigate("/order/sample-payment", { state: { sampleOrder: draft } })
           draft = { options, imageRefs, totalCost }   ← 주문 레코드는 아직 없음

/order/sample-payment (ProtectedRoute, state 없으면 /sample-order 복귀)
  ├─ 본문: 배송지 카드(기본 자동선택) + 샘플 사양 요약 + 쿠폰 선택
  ├─ sidebar: SummaryCard(샘플 제작/쿠폰 할인/배송비 0원/합계) + PaymentWidget
  └─ [결제하기] = useCheckoutPayment.pay()
       createOrder = POST /orders/sample {shipping_address_id, sample_type, options,
                                          reference_images, additional_notes, user_coupon_id}
                     → {payment_group_id, total_amount}  (서버: Order(sample,대기중,qty=1)+쿠폰 reserved)
       → requestPayment(orderId=payment_group_id) → /order/payment/{success,fail} (C3 재사용)
       → confirm 시 서버가 후속 정규주문 할인 쿠폰 발급 (§3 — 원본에 없던 신규 도메인 기능)
```

- 서버 가격: `sample_pricing_key(sample_type, design_type)` → `pricing_constants` 단일 lookup (`orders/service.py:621`). 수량 항상 1, 배송비 0원, 제작 기간 28~42일 — 전부 원본 보존.
- confirm은 order_type 무관 단일 경로. 단 sample은 **Toss 승인 전 사전검증**(`_ensure_sample_orders_couponable`)으로 "돈 받고 DB 미확정" 창을 차단(money.md §5).

## 3. 원본 대비 차이 (기능 명세는 보존 — 구현에 이미 반영된 것)

| YeongSeon | essesion | 근거 |
|---|---|---|
| 견적을 클라에서 계산(`getSamplePrice` + usePricingConfig) 표시, 서버 RPC가 재계산 | **서버 calculate 단일 소스**(공개, 부작용 없음 — 테스트로 고정) | C5 D1과 동일 — 과금 로직은 api에만, 표시=청구 |
| 폼 진입부터 로그인 유도(confirmLogin) | **공개 라우트** — 제출·업로드만 requireAuth, 복귀 시 옵션 복원 | C5 D2와 동일. 전환 퍼널 개선 |
| ImageKit 업로드(`/sample-orders` 폴더), 폼에서 즉시 업로드 | **GCS 서명 업로드 kind="sample_order"**, 제출 시점 일괄 업로드. 로그인 리다이렉트 시 파일 소실 → 재첨부 snackbar | 인프라 이관. 미결제 이탈 시 고아 업로드 감소 |
| `DesignImagePicker`(내 디자인에서 선택) | 미이관 — **C12 이연**(C5 D12와 동일 근거: 갤러리 엔드포인트·디자인 페이지 미구현) | 청크 경계. §5-B에서 pickerSlot 자리 논의 |
| failUrl `?returnTo=/sample-order` 쿼리 | snapshot `returnPath="/order/sample-payment"` + `returnState`(draft 보존) — 실패 후 **결제 페이지로 draft째 복귀** | C5 D6 메커니즘 재사용. 원본보다 복귀 지점이 가까움 |
| `orderName: "샘플 주문"` | `"넥타이 샘플 제작"` | Toss 결제창 표기 명확화 |
| seed의 `sample_discount_*` 상수가 **코드 경로에서 미사용**(죽은 데이터) | **후속 쿠폰 기능으로 실체화** — 샘플 결제 confirm 시 sample_type 조합별 정규주문 fixed 할인 쿠폰 발급(멱등 upsert, `payments/service.py:345`) | 죽은 상수의 도메인 의도("샘플 후 본주문 할인") 복원. 신규 기능이므로 여기 명시 |
| 샘플 단가: 봉제 100,000 / 원단 100,000(날염=선염) / 원단+봉제 200,000 | seed: 봉제 50,000 / 원단 날염 60,000·선염 80,000 / 원단+봉제 100,000·120,000 — **선염 차등 + 전반 인하** | ⚠ **원본 스냅샷과 다른 값** — §5-D에서 확인 필요. 구조(키 5종)는 동일, 값은 admin이 pricing_constants로 운영 조정 가능 |
| 옵션 칩 = ChipSinglePicker 4그룹 | 샘플 유형은 `SegmentedControl`, 원단·타이·심지는 설명형 `SelectBox` | §5-C — 화면 전환과 비교·확정 선택의 의미를 분리 |
| 유의사항: shipping-notices(제주/도서산간 4,500원 등) | Callout에 도서산간 추가 배송비·접수 후 취소/환불 불가·후속 쿠폰 발급 안내 | §5-E 보강 완료 |
| 첨부 제한 불명(useImageUpload 공용) | **max 5장**, jpg/png/webp·10MB(C5 CUSTOM_IMAGE_ACCEPT 재사용) | C5와 통일 완료 |

보존 확인: 옵션 4그룹·선택지·기본값(fabric / POLY·PRINTING / AUTO / WOOL) 전부 일치, `sewing`이면 원단 섹션 숨김+"봉제 전용" 라벨, options dict 형태(`tie_type` MANUAL→null, sewing→fabric/design null — 단위테스트 있음), qty=1·배송비 0·제작기간 28~42일, additionalNotes 500자, 가격 미확정/업로드 중 제출 차단, item_data 스냅샷(sample_type/options/reference_images/additional_notes/pricing), 쿠폰 reserved→confirm 확정→stale 배치 복원.

## 4. 데이터 계약 (전부 생성 완료 — codegen 불필요)

| 엔드포인트 | api-client | 용도 |
|---|---|---|
| POST /orders/sample/calculate (공개) | `calculateSampleOrderMutation` | `{sample_type, options}` → `{total_cost}`. 부작용 없음(테스트 고정) |
| POST /orders/sample | `createSampleOrderMutation` | 결제 1단계 → `{order_id, order_number, payment_group_id, total_amount}` |
| POST /images/upload-url | `createUploadUrl` | `kind:"sample_order"` (images/router.py 허용 목록에 포함) |
| POST /payments/confirm · GET /users/me/addresses · GET /coupons/mine | C3 그대로 | 결제·배송지·쿠폰 |

## 5. 개선 제안 (남은 작업 — 이 플랜의 실행 대상)

### A. calculate를 useQuery 패턴으로 통일 (권장, 효과 큼)

**완료**. `useSampleQuote`가 `sample_type`·`design_type`만 queryKey로 사용하고 staleTime 5분으로 캐시한다. 타이·심지 변경은 재요청하지 않으며 동일 가격 조합 재방문은 캐시를 사용한다.

### B. attachment pickerSlot 계약 (기록만, C12 일괄)

C5는 첨부 섹션에 `pickerSlot?: ReactNode` 자리를 남겼지만 sample 페이지에는 없다. C12(AI 디자인 갤러리)에서 custom·sample 양쪽에 피커를 붙일 때 함께 처리 — 지금 별도 작업 불필요, C12 범위에 "sample-order 첨부에도 피커 주입" 1줄 추가만.

### C. 선택 컨트롤 의미 정합성 (권장)

**완료**. 하네스 기준(SegmentedControl=현재 화면 콘텐츠 즉시 필터/전환)에 따라:

- **샘플 유형**: 선택이 원단 섹션 show/hide를 즉시 전환 → SegmentedControl **유지 타당**.
- **원단 조합(4지)·타이·심지**: 비교·확정형 선택 → custom과 동일하게 `SelectBox` 전환. 두 페이지가 같은 도메인 옵션을 다른 컨트롤로 노출하는 비일관 해소.

### D. 샘플 단가 seed 값 확인 (운영 결정 필요 — 코드 아님)

원본 스냅샷(100k/100k/100k/200k/200k, 선염=날염)과 seed(50k~120k, 선염 차등)가 다르다. 선염 차등화 자체는 합리적 개선이지만 "도메인 데이터 의미 보존" 원칙상 **의도 확인 후 기록**이 필요: 의도한 재책정이면 이 표가 근거 문서, 아니면 seed를 원본 값으로 정렬. 후속 쿠폰 금액(`sample_discount_*` 30k~60k)도 단가와 비율이 연동되므로 함께 결정.

**2026-07-11 실행 결론**: Git 이력상 현재 단가와 후속 쿠폰 값은 초기 seed 커밋(`c55c1f9`)부터 존재하지만, 원본 대비 재책정을 승인한 운영 근거는 저장소에서 확인되지 않았다. 임의 가격 변경은 결제 금액과 쿠폰 정책을 함께 바꾸므로 이번 개선에서는 **현행 seed를 유지**한다. 운영자가 재책정 의도 또는 원본 복원을 확정하면 단가 5종과 후속 쿠폰 5종을 한 결정으로 갱신한다.

### E. 유의사항 안내 보강 (소규모)

**완료**. 폼 sidebar Callout에 제주/도서산간 추가 배송비, 접수 후 취소·환불 불가, **후속 쿠폰 안내**("샘플 결제 완료 시 본 주문 할인 쿠폰이 발급됩니다")를 보강했다. 제작 기간은 기존 SummaryCard Row와 중복되어 추가하지 않았다.

### F. 소소한 정리 (일괄 커밋 1건)

- 첨부 상한 custom 5 vs sample 6 → **5로 통일 완료**.
- sample 단가 상수의 pricing category가 `custom_order`로 seed됨(`sample_discount`는 별도 카테고리 존재) → `sample` 카테고리 분리는 admin 화면(미구현)의 필터 요구가 생길 때 마이그레이션과 함께 — 지금은 기록만.
- 프론트 테스트 보강: `options.test.ts`는 sewing→fabric null 1건뿐 → `tie_type` MANUAL→null 변환, `readSampleOrderDraft` 방어 파싱(결제 페이지 진입 가드) 추가.

## 6. 결정 사항

| ID | 결정 | 상태 |
|---|---|---|
| S1 | calculate를 useQuery(queryKey=가격 결정 키 2개)로 교체 — 요청 수렴·경쟁 차단·C5 패턴 통일 (§5-A) | 완료 |
| S2 | 원단조합·타이·심지 SelectBox 전환, 샘플 유형만 SegmentedControl 유지 (§5-C) | 완료 |
| S3 | 유의사항 Callout 보강 + 후속 쿠폰 발급 사전 안내 (§5-E) | 완료 |
| S4 | 샘플 단가 seed 원본 대비 차이 — 의도 확인 후 이 문서에 확정 기록 (§5-D) | **현행 유지·운영 결정 대기** |
| S5 | 첨부 상한 5로 통일 + 프론트 테스트 2건 보강 (§5-F) | 완료 |
| S6 | pickerSlot·pricing category 분리 — 각각 C12·admin 청크로 이연, 기록만 (§5-B·F) | 이연 |
| S7 | sessionStorage draft(C5 D10)는 sample에 **미적용 유지** — 선택 4개+메모라 재입력 비용이 낮고, 로그인 복귀는 location.state 복원이 이미 커버 | 확정 |

## 7. 작업 순서 (개선분만 — S4 확인과 병행 가능)

1. **S1**: `features/sample-order/model/use-sample-quote.ts` 신설(useQuery, queryKey=`["sample-order","calculate",{sample_type,design_type}]`, staleTime 5m) → 페이지의 mutation/version ref/setTimeout 제거.
2. **S2**: 원단조합·타이·심지를 `SelectBox`로 교체(custom-order의 교체 커밋 패턴 참조).
3. **S3+S5**: Callout 문구 보강·후속 쿠폰 안내, MAX_IMAGES 5, options 테스트 2건 추가.
4. **검증**: `pnpm lint` → `pnpm turbo typecheck test` → Aside 브라우저 왕복 — ① 유형 전환 시 원단 섹션 show/hide·금액 즉시 갱신(캐시 히트 확인) ② 타이/심지 변경 시 **재요청 없음** ③ 비로그인 제출 → 로그인 복귀 시 옵션 복원·파일 재첨부 안내 ④ 결제: 배송지 자동선택 → 쿠폰 적용 → Toss(DryRun) → success confirm → **후속 쿠폰 발급 확인**(`/coupons/mine`) ⑤ sample-payment 직접 진입/새로고침 → /sample-order 복귀 ⑥ 결제 실패 → draft 보존 복귀. 반응형(모바일 하단 actionBar) 확인.
5. `docs/CHECKLIST.md`에 개선 항목 체크 라인 추가, S4 결론을 §5-D에 기록.

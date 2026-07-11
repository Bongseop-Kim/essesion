# store 정적 페이지(C11) 구현 플랜

> YeongSeon `/faq`, `/notice`, `/privacy-policy`, `/terms-of-service`, `/refund-policy`를 essesion store로 재작성.
> **상태: 구현 완료 (2026-07-11)** — D1~D7 확정·반영. 책임자·시행일 등 D6 운영값은 공개 전 확인 필요.
> 원본 참고(복사 금지): `../git/YeongSeon/apps/store/src/features/{faq,notice}/**`, `pages/{notice,privacy-policy,terms-of-service,refund-policy}/**`, `shared/composite/policy-components.tsx`, `shared/layout/popup-layout.tsx`.

## 1. 범위 (라우트)

| 경로 | 성격 | 내용 |
|---|---|---|
| `/faq` | 신규 | FAQ 목록 — 단일 페이지, Accordion 18항목(카테고리 뱃지) |
| `/notice` | 신규 | 공지사항 목록 — 단일 페이지, Accordion(중요 뱃지 + 날짜), 수선비 토큰 치환 |
| `/privacy-policy` | 신규 | 개인정보처리방침 — 정적 문서(9개 섹션) |
| `/terms-of-service` | 신규 | 이용약관 — 정적 문서(15개 섹션) |
| `/refund-policy` | 신규 | 환불정책 — 정적 문서(12개 섹션) |

- 5개 전부 **공개 라우트**(ProtectedRoute 밖), `app/router/index.tsx`에 lazy 추가. 현재는 catch-all(`*` → Home)로 흡수되는 상태.
- **푸터 링크는 이미 존재**(`app-layout.tsx` SUPPORT_LINKS·POLICY_LINKS) — 페이지만 만들면 링크가 살아난다. 푸터 수정 불필요.
- 상세 라우트·페이지네이션 없음(원본 보존 — FAQ 18개·공지 8개 규모에서 불필요).

## 2. 원본 명세 요약 (보존 대상 = "무엇을 하는가")

- **FAQ**: 인트로(제목·안내) + 단일 아코디언(한 번에 하나 열림, collapsible). 항목 = 카테고리·질문·답변. 카테고리는 뱃지 표시용(필터·그룹핑 없음), 정렬은 배열 순서.
- **공지**: 같은 구조 + 항목에 날짜, `important`면 "중요" 뱃지(정렬 고정은 없음 — §7 D4에서 개선).
- **수선비 토큰 치환**: FAQ 1건·공지 1건의 본문에 `{{REFORM_SHIPPING_COST}}`·`{{REFORM_PICKUP_FEE}}` 플레이스홀더 → 서버 요금 조회로 치환. 로딩/에러 시 `—` 표시 + `aria-live` 안내. 원본은 Supabase `pricing_constants` 직접 쿼리였고, essesion은 `GET /reform/pricing`(`ReformPricingOut.shipping_cost`/`pickup_fee`)이 이미 있어 치환만 재현하면 됨.
- **약관 3종**: 섹션(h2) + 목록(ul) + 안내 박스 조합의 정적 문서. 원본은 430×650 `window.open` 팝업 + Header/Footer 숨김 최소 레이아웃(닫기 = `window.close()`) — §3 D1에서 페이지로 대체.
- **진입점**: 푸터(고객지원 → FAQ·공지 / 정책 → 약관 3종), 마이페이지 허브 고객지원 링크(C8 §10 이연분), 로그인 화면 동의 문구(원본은 이용약관·개인정보처리방침을 팝업으로).

## 3. 약관 표기 방식 제안 (착수 전 제안 ① — 팝업 → 일반 페이지)

**원본의 `window.open` 팝업을 버리고 Header/Footer가 있는 일반 라우트 페이지로 통일**한다.

| 근거 | 설명 |
|---|---|
| 모바일·접근성 | 새 창 팝업은 모바일/인앱 브라우저·팝업 차단에서 깨진다. 원본도 차단 폴백을 따로 두고 있었음 |
| 팝업이 필요한 시나리오가 없음 | 팝업의 존재 이유는 "폼 상태를 유지한 채 약관 확인"인데, essesion은 공개 회원가입이 없고(소셜 OAuth) 약관 동의 체크박스 플로우도 없다. 유일한 사용처였던 로그인 동의 문구는 라우트 링크(`target="_blank"` 새 탭)로 충분 |
| AppLayout 변경 zero | 페이지로 가면 Header/Footer 숨김 정책(PopupLayout 상당물)이 아예 불필요 → **C12의 "전체높이+Footer 숨김" 작업과 완전히 분리**된다. C11이 순서 무관 청크라는 성격에도 부합 |
| 선례 | C8에서 배송지 `window.open`+`postMessage`를 페이지+모달로 대체한 것과 같은 결정(store-my-page.md D1) |
| 링크 가능성 | 정식 URL로 SEO·공유·고객센터 안내가 가능해진다 |

- 대비책: 이후 결제 화면 등에서 "이탈 없이 약관 확인"이 필요해지면, 약관 본문을 페이지와 분리된 콘텐츠 컴포넌트(§8)로 두므로 `ResponsiveModal`에 그대로 담아 재사용할 수 있다. 지금은 만들지 않는다.

## 4. 공지/FAQ 데이터 제안 (착수 전 제안 ② — 정적 상수 유지, 엔드포인트 신설 안 함)

C11 프롬프트의 "공지/FAQ는 해당 조회 엔드포인트" 문구와 달리, **원본의 실제 구현은 하드코딩 상수**이고(FAQ `constants/FAQ.ts`, 공지 `constants/NOTICE.ts`) 신규 스택에도 notices/faqs 테이블·라우터·시드가 전혀 없다. 따라서:

- **정적 상수로 재현**한다(기능 명세 보존 = 최소 경로). 새 테이블·라우터·codegen 전부 불필요 — C11은 순수 프론트 청크가 된다.
- 유일한 서버 의존은 기존 `getReformPricingOptions()`(수선비 토큰 치환)뿐.
- **DB화(+admin CRUD)는 이연**: 공지를 운영자가 배포 없이 등록·수정하려면 자연스러운 다음 단계지만, admin 앱 범위의 별도 청크다. §10에 스키마 초안(published_at·pinned·is_visible)만 기록해 두고, 프론트 상수의 타입을 그 스키마와 호환되게 설계해 전환 비용을 낮춘다.
- 원본 공지 8건은 2023~24년 더미(설 연휴·리뉴얼 등) — 그대로 옮기지 않고 essesion 기준 실공지(서비스 오픈 안내, 수선 배송 안내 등)로 재작성한다. FAQ 18건은 도메인 명세(배송·수선·토큰·맞춤제작 정책)가 담겨 있으므로 내용을 보존하되 신규 스택과 어긋나는 문구만 손본다.

## 5. 하네스 매핑

| 원본 요소 | essesion | 근거 |
|---|---|---|
| MainLayout+PageLayout+UtilityPageIntro | `ContentLayout`(breadcrumbs만, 슬롯 없음) — 단일 중앙 컬럼 | 프롬프트 지정. my-info 선례 |
| shadcn Accordion(single collapsible) | shared `Accordion type="single" collapsible` + `AccordionItem/Trigger/Content` | 동일 패턴 존재 |
| 카테고리·중요 뱃지 | `Badge` | 정적 상태 태그 |
| PolicySection/PolicyList/PolicyInfoBox | `Article` + `Text`(textStyle) + 로컬 정책 빌딩블록(§8) — Box/VStack 조립 | shared 우선순위 사다리: shared 프리미티브 조립으로 충분 |
| PopupLayout + usePopup(window.open) | **미생성** — 일반 페이지(§3 D1) | 팝업 폐기 |
| applyTemplateTokens + useReformPricing | 동일 유틸 재작성 + `useQuery(getReformPricingOptions())` | 좋은 패턴 보존, Supabase 쿼리만 api-client로 교체 |
| 로딩/에러 시 금액 `—` + aria-live | 동일 재현 | 치환 실패해도 문서는 읽혀야 함 |

- 주의: 텍스트 위주 페이지라 임의값(`text-[13px]` 등) 유혹이 큼 — check-harness가 차단하므로 처음부터 `Text` textStyle·토큰만 사용.

## 6. 데이터 계약

| 용도 | 엔드포인트 | api-client | 상태 |
|---|---|---|---|
| 수선비 토큰 치환(FAQ·공지 각 1건) | GET /reform/pricing | `getReformPricingOptions` | 생성 완료, reform에서 사용 중 |

그 외 서버 통신 없음. **api 스펙 변경 없음 → codegen 불필요.**

## 7. 원본 대비 결정·개선 (실행 전 확정 제안)

| ID | 결정 | 근거 |
|---|---|---|
| D1 | 약관 팝업 → **일반 라우트 페이지** (§3) | 모바일·접근성·AppLayout 무변경·C12 분리 |
| D2 | 공지/FAQ **정적 상수** — 엔드포인트 신설 안 함 (§4) | 원본 실구현이 상수. 프롬프트 문구는 원본 구현과 불일치(조사로 확인) |
| D3 | 수선비 토큰 치환 패턴 보존, 데이터원만 `GET /reform/pricing`으로 교체 | 요금 변경 시 문서 자동 갱신 — 원본의 유일한 동적 요소 |
| D4 | `important` 공지 **상단 고정 정렬**(pinned 우선 → 날짜 내림차순) | 원본은 뱃지만 있고 수동 배열 순서 의존 — 정렬을 코드로 보장 |
| D5 | 약관 콘텐츠는 구조(섹션 체계)만 보존하고 **문구는 essesion 스택 기준으로 갱신** | 원본은 Supabase·GA·PostHog 위탁, 공개 회원가입 전제, 시행일 2024~26 혼재. 처리 위탁처(GCP·Toss·Solapi)·수집 항목·회원가입 조항을 실제와 일치시켜야 법적 문서로 유효 |
| D6 | 회사명 **"영선산업"**·상호명 **"ESSE SION"**·이메일 **"biblecookie@naver.com"**로 통일, **보호책임자·시행일은 placeholder + 운영 확인 항목**으로 | 사업자 정보는 Footer·약관·하네스에서 같은 값을 사용하고, 개인정보 보호책임자는 운영 확정 전 임의로 정하지 않음 |
| D7 | 로그인 화면 동의 문구의 약관 링크는 새 탭 라우트 링크로 배선(문구가 이미 있으면), 없으면 이연 | 원본 팝업 호출처의 대체. 착수 시 로그인 페이지 확인 후 결정 |

## 8. 파일 계획

```text
apps/store/src/
  pages/
    faq/index.tsx                 (신규 — ContentLayout + Accordion)
    faq/model/faq-data.ts         (신규 — FAQItem[] 상수, §4 스키마 호환 타입)
    notice/index.tsx              (신규 — ContentLayout + Accordion + 토큰 치환)
    notice/model/notice-data.ts   (신규 — NoticeItem[] 상수)
    privacy-policy/index.tsx      (신규 — 콘텐츠 컴포넌트 + 페이지 셸)
    terms-of-service/index.tsx    (신규)
    refund-policy/index.tsx       (신규)
  shared/
    ui/policy-blocks.tsx          (신규 — PolicySection/PolicyList/PolicyInfoBox 상당,
                                   shared Article·Text·Box 조립. 3개 약관 페이지 공유)
    lib/template-tokens.ts        (신규 — applyTemplateTokens 상당 + 토큰 키 타입)
  app/router/index.tsx            (라우트 5건 추가 — lazy, 공개 레벨)
```

- 약관 본문은 `<XxxPolicyContent />` 컴포넌트로 페이지 셸과 분리 — 이후 모달 재사용 대비(§3 대비책).
- feature 디렉터리는 만들지 않음 — 서버 상태·상호작용이 거의 없어 페이지 로컬로 충분.

## 9. 작업 순서

1. **정책 빌딩블록**(`policy-blocks.tsx`) + 약관 3종 페이지 — 콘텐츠는 D5·D6 기준으로 재작성.
2. **FAQ**: 상수 데이터(원본 18건 내용 보존·문구 검수) + Accordion 페이지 + 토큰 치환 유틸.
3. **공지**: 상수 데이터(essesion 기준 재작성, D4 정렬) + 페이지 + `getReformPricingOptions` 치환 배선.
4. **라우트 5건 추가** → 푸터 링크 동작 확인, 로그인 화면 동의 문구 확인(D7).
5. **검증**: `pnpm lint` → `pnpm turbo typecheck` → Aside 브라우저 왕복 —
   ① 푸터에서 5개 페이지 진입 ② FAQ/공지 아코디언 개폐·뱃지 ③ 공지 수선비 금액이 실서버 값으로 치환(api 중지 시 `—` 폴백) ④ 모바일 뷰포트 가독성 ⑤ 약관 3종 Header/Footer 정상 노출·브레드크럼.
6. `docs/CHECKLIST.md` store 재작성 항목에 C11 서술 추가, 본 문서 상태 갱신.

## 10. 이연·기록

- **공지/FAQ DB화 + admin CRUD**: 요구 생기면 별도 청크. 스키마 초안 — `notices(id, category, title, content, pinned, is_visible, published_at)` / `faqs(id, category, question, answer, sort_order, is_visible)`. 프론트 상수 타입을 이와 호환되게 두었으므로 전환 시 데이터 이동 + useQuery 교체만.
- **약관 버전 관리(시행일·개정 이력)**: 법적 요구가 구체화되면 DB화와 함께. 지금은 문서 하단 시행일 표기만.
- **약관 모달 재사용**: 결제 등에서 "이탈 없는 약관 확인"이 필요해지면 `<XxxPolicyContent />`를 ResponsiveModal에 배선(§3 대비책) — 지금은 미구현.
- **D6 확인 필요 항목**: 개인정보 보호책임자 이름·시행일 — 운영 확정값 수령 후 placeholder 교체.

## 11. 실행 결과 (2026-07-11)

- 공개 라우트 5건과 푸터 링크, 마이페이지 고객지원 링크를 연결했다.
- FAQ 18건·공지 8건을 정적 상수로 작성하고, 공지는 `pinned` 우선 → 날짜 내림차순 정렬을 테스트로 고정했다.
- FAQ·공지의 수선비 토큰은 기존 `getReformPricingOptions()`로 치환하며 로딩·오류 시 `—`와 `aria-live` 안내를 표시한다.
- 약관은 일반 `ContentLayout` 페이지와 재사용 가능한 콘텐츠 컴포넌트로 구현했다. 로그인 화면에는 기존 동의 문구가 없어 D7 링크 추가는 이연했다.
- 개인정보 보호책임자·시행일 및 수탁자 계약 상세는 임의로 확정하지 않고 공개 전 운영 확인 항목으로 표시했다.
- 회사명 `영선산업`·상호명 `ESSE SION`·이메일 `biblecookie@naver.com`을 Footer·약관·하네스에 통일했다.
- 검증 완료: `pnpm lint`, `pnpm turbo build typecheck test`, Aside 데스크톱·390px 모바일. 실제 API 요금(4,500원/5,000원) 치환과 브라우저 요청 차단 시 `—` 폴백을 모두 확인했다.

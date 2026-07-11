# store 마이페이지(C8) 구현 플랜

> YeongSeon `/my-page`(허브) + `/my-page/my-info*`(detail/email/notice/leave) + `/shipping`(팝업 목록·폼)을 essesion store로 재작성.
> **상태: 구현 완료 (2026-07-11)** — D1–D11 적용, API 계약·api-client·store 화면과 라우트·배송지 공용 폼까지 구현 및 검증 완료.
> 미배선 생성물: `updateProfileMutation` · `setNotificationPreferencesMutation` · `deleteAccountMutation` · `deleteAddressMutation` · `sendPhoneVerification`/`verifyPhone` — C8이 전부 소비.
> 원본 참고(복사 금지): `../git/YeongSeon/apps/store/src/pages/my-page/**`, `features/shipping/**`, `pages/shipping/form.tsx`.

## 1. 범위 (라우트)

| 경로 | 성격 | 내용 |
|---|---|---|
| `/my-page` | 기존 재구성 | 허브 — 프로필 요약 + 링크 목록 + 로그아웃. ContentLayout(sidebar) 전환 |
| `/my-page/my-info` | 신규 | 내 정보 조회·**수정**(이름·생년월일) + 휴대폰 인증 변경 + 이메일 read-only. 원본의 my-info 허브+detail을 한 페이지로 통합(D2) |
| `/my-page/my-info/notice` | 신규 | 알림 설정 — 서비스 알림 토글(휴대폰 인증 선행) + 마케팅 수신 동의 토글 |
| `/my-page/my-info/leave` | 신규 | 회원 탈퇴 — 유의사항 + 동의 체크 + AlertDialog 확인 |
| `/my-page/shipping` | 신규 | 배송지 관리 — 목록 페이지 + `ResponsiveModal` 폼(추가/수정) + AlertDialog 삭제 |
| `/my-page/my-info/detail`, `/my-page/my-info/email` | **미생성** | D2·D3 — detail은 my-info에 통합, email 변경은 소셜 로그인 체계상 서버 경로가 없어 제외 |

전부 기존 ProtectedRoute 그룹(`app/router/index.tsx`)에 lazy로 추가. `/my-page`는 이미 등록됨.

## 2. 원본 명세 요약 (보존 대상 = "무엇을 하는가")

- **허브**: 이름·이메일·휴대폰 요약, 상태 배지(휴대폰 인증/알림 수신/마케팅 동의), 링크 그룹(주문·내역 / 고객지원 / 설정), 로그아웃.
- **my-info**: 기본 정보(이름·생년월일·휴대폰·이메일) 표시, 배송지 관리·알림 설정 진입, 탈퇴 진입. 원본 detail은 read-only + "회원정보 변경 준비 중"(disabled CTA)인 죽은 화면.
- **notice**: 토글 2종 — ① 서비스 알림(카카오톡/문자, 켤 때 휴대폰 미인증이면 인증 먼저) ② 마케팅 수신 동의. 채널 통합("카카오톡/문자"), 이메일 알림 없음.
- **leave**: 유의사항 4블록(복구 불가·주문정보 5년 분리보관·재가입 제한·게시물 유지) → 동의 체크박스 → confirm 모달 → 탈퇴 → 로그아웃+홈.
- **배송지**: 카드 목록(이름+기본 배지, 전화, (우편번호) 주소, 배송 요청), 추가/수정 폼(받는 분·휴대폰·다음 우편번호 검색·상세주소·배송 요청 select+직접입력 메모 50자·기본 배송지 체크), 첫 배송지는 자동 기본, 기본 배송지 삭제 차단. 원본은 `window.open` 팝업(430×650)+`postMessage`.
- 원본에만 있는 허브 링크 중 1:1 문의·견적 요청·토큰 내역·FAQ·공지는 **다른 청크**(미구현 페이지) — 허브에는 구현된 대상만 노출하고 청크 완료 시 행 추가(§9).

## 3. 정보 구조 제안 (착수 전 제안 ①)

원본은 허브와 my-info 양쪽에 같은 링크(알림 설정 등)가 중복되고, detail이 죽은 화면이라 my-info → detail → (수정 불가) 3뎁스가 헛걸음이다. 아래처럼 **허브 1뎁스 + 실행 페이지 1뎁스**로 평탄화한다:

```text
/my-page ── ContentLayout(breadcrumbs, sidebar)
  본문
   ├ 프로필 헤더: 이름(title) · 이메일 · 휴대폰(미등록 안내)
   ├ [주문과 내역]  주문 내역 → /my-page/orders
   ├ [설정]        내 정보 → /my-page/my-info
   │               배송지 관리 → /my-page/shipping
   │               알림 설정 → /my-page/my-info/notice
   └ LogoutButton(AlertDialog 확인 — 기존 features/auth 재사용)
  sidebar(SummaryCard "계정 상태")
   └ 휴대폰 인증 / 알림 수신 / 마케팅 동의 배지 + 미인증 시 안내 문구

/my-page/my-info ── 조회+수정 단일 페이지 (원본 my-info+detail 통합)
   ├ 폼: 이름 · 생년월일 (TextField, PATCH /users/me 저장)
   ├ 휴대폰: 현재 번호 + 인증 배지 → [변경] = 인증 ResponsiveModal(번호 입력→발송→6자리 검증)
   ├ 이메일: read-only + "소셜 계정 이메일" 안내
   └ 하단: 탈퇴 진입 링크(→ /my-page/my-info/leave, critical 톤)
```

- 알림 설정·배송지 진입은 허브에만 둔다(원본의 이중 진입점 제거). my-info는 "내 정보" 그 자체만.
- 브레드크럼: 홈 › 마이페이지 › {내 정보|배송지 관리|알림 설정|회원 탈퇴}. notice/leave는 my-info 하위 경로를 유지해 원본 URL 구조와 도메인 의미(계정 설정 소속)를 보존.

## 4. 배송지 관리 흐름 제안 (착수 전 제안 ② — 팝업 → ResponsiveModal)

원본의 `window.open`+`postMessage`(origin 검증, 팝업 차단 폴백, 부모 쿼리 무효화 브릿지)는 전부 제거한다. 같은 SPA 안이므로 TanStack Query 캐시가 공유되어 브릿지 자체가 불필요하고, 모바일에서 팝업은 UX가 나쁘다. 선택(체크아웃)과 관리(마이페이지)를 분리:

```text
[선택 흐름 — C3 기존 그대로] 결제 페이지 → AddressSelectModal(ResponsiveModal: 목록 선택 + 간이 신규 폼)

[관리 흐름 — C8 신규] /my-page/shipping (페이지)
  ├ 목록: 주소 카드(이름·기본 Badge·전화·주소·배송 요청) — is_default desc, created_at desc(서버 정렬)
  │   ├ [수정]  → AddressFormModal(ResponsiveModal, 초기값 주입 → PUT upsert id 포함)
  │   ├ [삭제]  → AlertDialog 확인 → DELETE /users/me/addresses/{id} → invalidate
  │   └ [기본으로 설정] → PUT upsert(id, is_default: true) — 서버가 배타 처리
  ├ [새 배송지 등록] → AddressFormModal(신규 — 첫 배송지면 is_default 강제 true·해제 불가)
  └ 0건: ContentPlaceholder + 등록 액션
```

- **목록을 모달이 아닌 페이지로 두는 이유**: 관리에는 폼 모달·삭제 AlertDialog가 필요한데, 목록까지 모달이면 모달 위 모달(하네스 금지)이 된다. 삭제·기본 설정이 있는 목록은 상주 화면이 자연스럽다.
- **AddressFormModal**은 기존 `AddressSelectModal`의 폼 절반을 `features/shipping/ui/address-form-fields.tsx`(RHF 필드 묶음 + zod 스키마 + 다음 우편번호 검색)로 추출해 양쪽이 공유. 관리용 모달에만 추가되는 필드: `delivery_request`(ListPicker, 원본 옵션 보존 + "직접입력" 선택 시 `delivery_memo` TextAreaField 50자) · `is_default`(Checkbox). 체크아웃 간이 폼은 현행 유지(첫 배송지 자동 기본).
- 다음 우편번호 검색은 기존 `use-daum-postcode.ts` 재사용(우편번호/주소 readOnly, 검색으로만 입력 — 원본 보존).

## 5. 하네스 매핑

| 원본 요소 | essesion | 근거 |
|---|---|---|
| MainLayout+PageLayout+SummaryCard 자체 그리드 | `ContentLayout`(breadcrumbs·sidebar) — 전 페이지 공통 | 프롬프트 지정. orders.tsx·order-form.tsx 선례 |
| UtilityLinkList/Row 링크 목록 | `List`/`ListItem`(onClick)+`ListHeader` | 허브 링크 그룹 |
| 상태 배지(accountSignals) | sidebar `SummaryCard` 내 `Badge` | 정적 상태 태그 |
| PopupLayout + window.open | `ResponsiveModal`(폼) + 페이지(목록) | §4 |
| SelectField(배송 요청) | `ListPicker` | 옵션 6종+ — SelectBox 카드형은 과함 |
| Switch(알림 토글) | `Switch` | 즉시 반영 on/off — 하네스 정의 그대로 |
| confirm 모달(탈퇴)·삭제 확인 | `AlertDialog` | 파괴적 결정, 바깥 클릭으로 안 닫힘 |
| 전화 인증 Dialog | `ResponsiveModal` + `TextField`(6자리) | 임시 작업 폼 기본 패턴 |
| toast | `snackbar()` | 결과 알림 |
| 로딩/빈/에러 | `Skeleton` / `ContentPlaceholder` | 3상태 규칙. 허브·my-info는 me 캐시가 이미 있으므로 Skeleton은 배송지·최초 진입만 실질 노출 |

## 6. 데이터 계약 (전부 생성 완료 — 기본적으로 codegen 불필요, D6 채택 시에만 재생성)

| 용도 | 엔드포인트 | api-client | 상태 |
|---|---|---|---|
| 프로필 조회 | GET /auth/me | `getMeOptions` | 사용 중 |
| 프로필 수정(이름·생년월일·마케팅 동의) | PATCH /users/me | `updateProfileMutation` | **미배선** |
| 알림 설정 | POST /users/me/notification-preferences | `setNotificationPreferencesMutation` | **미배선** |
| 휴대폰 인증 발송/검증 | POST /auth/phone/send·verify | `sendPhoneVerification`/`verifyPhone` | **미배선** |
| 배송지 목록/업서트 | GET·PUT /users/me/addresses | `listAddressesOptions`/`upsertAddressMutation` | checkout 사용 중 |
| 배송지 삭제 | DELETE /users/me/addresses/{id} | `deleteAddressMutation` | **미배선** |
| 회원 탈퇴 | DELETE /users/me | `deleteAccountMutation` | **미배선** |
| 로그아웃 | POST /auth/logout | `logoutMutation`(`useLogout`) | 사용 중 |

- 프로필 계열 mutation 성공 시 `getMeQueryKey()` invalidate(서버가 MeResponse를 반환하므로 `setQueryData` 직접 반영도 가능 — 단순화를 위해 invalidate 기본).
- 탈퇴 성공 시: `useSession.clear()` + `queryClient.clear()` + snackbar + 홈 이동(로그아웃 API 호출 불필요 — 서버가 RefreshToken revoke).

## 7. 원본 대비 결정·개선 (실행 전 확정 제안)

| ID | 결정 | 근거 |
|---|---|---|
| D1 | 배송지 팝업(window.open+postMessage) → **페이지+ResponsiveModal** (§4) | SPA 내 캐시 공유로 통신 브릿지 불필요, 모바일 UX, 원본의 팝업 차단 폴백·origin 검증 코드 전부 삭제 |
| D2 | my-info+detail **한 페이지 통합 + 실제 수정 구현** | 원본 detail은 CTA disabled인 죽은 화면(문구-기능 불일치). `PATCH /users/me`가 이미 있으므로 이름·생년월일 수정을 실체화. 원본의 "회원정보 변경" 의도 복원 |
| D3 | 이메일 변경 페이지 **제외** — my-info에 read-only 표시 | 원본은 Supabase Auth OTP 의존. essesion 인증은 소셜 OAuth(+스태프 id/pw)로 이메일이 프로바이더 유래이며 서버에 변경 경로 없음. 필요해지면 별도 청크로 |
| D4 | 휴대폰 변경은 **인증 플로우로만** (send→verify, `verify_code`가 phone+phone_verified 원자 세팅) | 검증된 번호만 저장되는 유일 경로. 원본의 "휴대폰 수정 미구현" 갭을 인증 UX로 해소 |
| D5 | 로그아웃 AlertDialog 확인 유지(기존 LogoutButton) | 원본은 확인 없이 즉시 로그아웃(탈퇴와 비대칭·오클릭 위험) — 이미 개선돼 있어 유지 |
| D6 | **서버 개선**: `ProfileUpdateRequest`에서 `phone` 제거 | 현재 PATCH로 미검증 번호를 넣어도 `phone_verified`가 유지되는 정합성 구멍. D4가 유일 경로가 되도록 필드 삭제(사용처 없음 확인됨). api 변경 → `pnpm codegen` 동반 커밋 |
| D7 | 기본 배송지 삭제: **클라이언트에서 버튼 숨김**(원본 보존) + 서버 가드는 미추가 | 원본도 클라 전용 방어. 주문은 배송지 스냅샷이라 삭제 위험이 낮고, "기본을 지우려면 다른 주소를 먼저 기본으로" UX가 명확. 서버 가드는 admin 요구 생기면 |
| D8 | 서비스 알림 토글 1개가 `notification_consent`+`notification_enabled` 동시 세팅 | 원본이 항상 동일 값으로 세팅(사실상 한 값). 서버 감사 로그(NotificationPreferenceLog)가 두 필드를 기록하므로 API 계약은 유지, UI만 단일 토글 |
| D9 | 알림 토글은 낙관적 업데이트 없이 **mutation pending 동안 Switch disabled → 성공 시 invalidate** | 원본의 낙관적 업데이트+수동 롤백(refetch+복원+toast)은 코드 대비 이득이 없음(토글 빈도 극저) |
| D10 | 탈퇴는 원본의 이중 확인 보존: 동의 Checkbox → `criticalSolid` 버튼 → AlertDialog | 되돌릴 수 없는 작업. 유의사항 문구는 서버 실동작(이력 있으면 소프트 삭제+익명화·주문정보 분리보관, 없으면 하드 삭제)에 맞게 재작성 |
| D11 | 마케팅 동의 토글은 notice 페이지에서 `updateProfileMutation`(`marketing_kakao_sms_consent`)으로 | 서버가 프로필 필드로 분리해 둠 — 별도 엔드포인트 불필요 |

## 8. 파일 계획

```text
apps/store/src/
  pages/my-page/
    index.tsx            (재구성 — ContentLayout+허브 IA)
    my-info/index.tsx    (신규 — 프로필 폼)
    my-info/notice.tsx   (신규)
    my-info/leave.tsx    (신규)
    shipping.tsx         (신규 — 배송지 목록 페이지)
  features/my-page/      (신규 feature — 필요 시)
    ui/phone-verify-modal.tsx   (휴대폰 인증 ResponsiveModal — send/verify + 60초 재전송 쿨다운)
  features/shipping/
    ui/address-form-fields.tsx  (AddressSelectModal에서 폼 추출 — 공유)
    ui/address-form-modal.tsx   (관리용 폼 모달 — delivery_request·is_default 포함)
    model/delivery-request.ts   (배송 요청 옵션 상수 — 원본 라벨 보존)
  app/router/index.tsx   (라우트 4건 추가 — lazy)
```

- Header nav의 마이페이지 진입은 현행 유지. `features/my-page`는 페이지 전용 코드가 늘어나기 전까지 최소로(허브·폼은 페이지 로컬로 시작).

## 9. 작업 순서

1. **D6 서버 선행**: `ProfileUpdateRequest.phone` 제거 + 테스트 갱신 → `pnpm codegen` (같은 커밋).
2. **배송지**: `address-form-fields` 추출(AddressSelectModal 동작 불변 리팩터) → `address-form-modal` → `/my-page/shipping` 페이지(목록·삭제·기본 설정) → 라우트.
3. **my-info**: 프로필 폼(useZodForm, zProfileUpdateRequest 기반) + `phone-verify-modal` + 이메일 read-only.
4. **notice**: Switch 2종 배선(D8·D9·D11) — 서비스 알림 켤 때 미인증이면 phone-verify-modal 선행(원본 보존).
5. **leave**: 유의사항 + 동의 + AlertDialog + 탈퇴 후 세션 정리.
6. **허브 재구성**: §3 IA — 마지막에 해야 링크 대상이 전부 존재.
7. **검증**: `pnpm lint` → `pnpm turbo typecheck test` → Aside 브라우저 왕복 —
   ① 비로그인 `/my-page/*` 진입 → 로그인 유도·복귀 ② 배송지 추가(첫 배송지 기본 강제)→수정→기본 변경→삭제(기본은 삭제 버튼 없음), 체크아웃 AddressSelectModal 회귀 확인 ③ 이름 수정 → 허브 반영(캐시 invalidate) ④ 휴대폰 인증(DryRun Solapi — 코드 로그 확인)·재전송 쿨다운·오입력 에러 ⑤ 알림 토글 켬(미인증 시 인증 선행) ⑥ 탈퇴 이중 확인 → 홈·세션 정리 → 재로그인 시 이력 유저는 소프트 삭제 확인 ⑦ 모바일 뷰포트에서 ResponsiveModal=BottomSheet 전환.
8. `docs/CHECKLIST.md` store 재작성 C8 체크 갱신, 본 문서에 결정 상태 기록.

## 10. 이연·기록

- 허브의 1:1 문의·견적 요청·토큰 내역·FAQ·공지 링크 — 해당 청크 구현 시 List 행 추가만 하면 되는 구조로 §3을 설계.
- 탈퇴 유의사항의 "재가입 제한" — 서버에 재가입 차단 로직 없음(소셜 재로그인 시 신규/재활성 처리 확인 필요). 문구를 실동작에 맞추되, 제한이 실제 요구면 별도 서버 작업으로.
- 이메일 알림 채널·SMS 개별 토글 — 원본에 없음. 도입하려면 스키마부터(범위 밖).

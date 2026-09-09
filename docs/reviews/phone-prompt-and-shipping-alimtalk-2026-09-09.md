# 휴대폰 인증 유도 2단계 + 배송중 알림톡 — 2026-09-09

`docs/plans/phone-prompt-and-shipping-alimtalk.md` 실행 완료(코드·명세). 실 발송 확인과 카카오 채널 관리자센터
확인 2건은 배포 뒤 남아 있다(아래 미검증).

## 결과

| 항목 | 결과 |
|---|---|
| 인증 유도 문구 | `my-page/index.tsx`·`my-info/notice.tsx`·`phone-verify-modal.tsx` 3곳을 "인증하지 않으면 주문·배송 진행 상태를 카카오톡으로 받을 수 없다"로. |
| 인라인 유도 | `features/my-page/ui/phone-prompt-callout.tsx` 신규 — `!phone_verified`면 Callout + `인증하기`. 기존 `PhoneVerifyModal` 재사용, 인증 성공 시 `notification_consent`·`notification_enabled`를 함께 켠다. 저장 상태(카운터·닫기) 없음. |
| 노출 지점 | 주문서 배송지 카드 아래(`order-form.tsx`), 결제완료 성공 분기(`payment-success.tsx`). 결제 버튼은 미변경. |
| 배송 시작 알림톡 | `domains/orders/service.py` `_notify_shipping_started` — `admin_update_status`(배송중 전이 + 송장 완비)와 `admin_update_tracking`(배송중 + 송장 완비 false→true) 커밋 직후 best-effort. repair는 `company_*` 송장. 변수 `#{처리유형}`·`#{주문번호}`·`#{택배사}`·`#{송장번호}`. |
| 설정 | `solapi_template_shipping_started`(기본 `""`, `required`에 넣지 않음). prod는 `production.tfvars` `api_extra_env`에 `SOLAPI_TEMPLATE_SHIPPING_STARTED` 1줄 — gitignore라 배포자가 직접 넣는다(`production.tfvars.example` 주석). |
| 명세 | `money.md §8` 발송 조건 1줄, `domains.md §1` 템플릿·fallback. |

## 결정 사항

- **인라인 2곳으로, 로그인 직후 모달·결제 버튼 인터셉트·거절 카운터는 만들지 않았다.** 맥락 있는 지점의 인라인
  옵트인이 허용률이 높고, 저장 상태가 없어 되돌릴 것도 없다. 재론 조건은 플랜 원문(기각한 대안) 참조 —
  인라인만으로 인증률이 안 오르면 배너로.
- **송장 게이트는 `shipped_at`이 아니라 "택배사 AND 송장번호 완비"의 false→true 전이.** 택배사 없는 송장은
  빈 변수로 알림톡이 실패해 SMS 대체로 떨어지고, 뒤에 택배사를 채워도 `shipped_at`은 이미 값이라 영구 미발송이
  됐을 경로다.
- PFID 오버라이드(플랜 항목 6)는 넣지 않았다 — 기존 `solapi_pf_id`와 같다는 가정. 다르면 `send_alimtalk`에
  `pf_id` 인자를 더한다.
- 발송 이력 테이블 없음. 송장을 지웠다 다시 넣으면 재발송(의도).

## 검증

- `apps/api/tests/test_admin_orders.py` 5건 추가(송장→배송중 / 배송중→송장 / 택배사 지연 / 미수신·미설정 /
  repair company 송장). `test_admin_orders`·`test_config` 30 PASS. ruff·pyright PASS.
- `payment-success.test.tsx` 2건 추가(미인증 노출·인증 미노출). store typecheck·vitest·`pnpm lint` PASS.
- `pnpm architecture:check` PASS.
- **미검증**: (1) 카카오 채널 관리자센터에서 PFID 동일 여부와 버튼 유형(DS/WL 고정/WL 변수) 확인 — WL 변수면
  5번째 변수 추가 필요. (2) production 실 발송 1건 — 변수 4개 치환, 버튼 동작(DS면 택배사 인식), 알림톡/SMS
  대체 여부. (3) 브라우저 실측(Aside)은 하지 않았다 — 주문서 Callout 무시 시 결제 진행이 회귀 지점.
